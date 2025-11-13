// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (version annulations)
// 🔮 Prévisions et tendances des réservations ANNULÉES
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    // Récupération des données d'annulations futures
    const annulationsFutures = await db.query(`
      SELECT 
        datereservation,
        COUNT(*) as reservations_annulees,
        COALESCE(SUM(tarif), 0) as revenus_perdus,
        COUNT(DISTINCT numeroterrain) as terrains_concernes
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `);

    // Statistiques historiques pour comparaison
    const statsHistoriques = await db.query(`
      SELECT 
        ROUND(AVG(annulations_jour), 2) as annulations_moyennes,
        ROUND(AVG(revenus_perdus_jour), 2) as revenus_perdus_moyens,
        MAX(annulations_jour) as annulations_max,
        MIN(annulations_jour) as annulations_min
      FROM (
        SELECT 
          datereservation,
          COUNT(*) as annulations_jour,
          COALESCE(SUM(tarif), 0) as revenus_perdus_jour
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '1 day'
        GROUP BY datereservation
      ) historique
    `);

    // Calcul des tendances et prévisions
    const historiqueComplet = await db.query(`
      SELECT 
        datereservation,
        COUNT(*) as annulations,
        COALESCE(SUM(tarif), 0) as revenus_perdus
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE + INTERVAL '${periode} days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `);

    const statsHist = statsHistoriques.rows[0];
    
    // Formatage des données pour le frontend
    const donneesFormatees = annulationsFutures.rows.map((item, index) => {
      const tauxAnnulationPrevu = item.reservations_annulees > 0 ? 
        Math.min(40, Math.max(5, (item.reservations_annulees / 10) * 100)) : 5;
      
      let niveauRisque = 'risque_faible';
      if (tauxAnnulationPrevu > 25) niveauRisque = 'risque_eleve';
      else if (tauxAnnulationPrevu > 15) niveauRisque = 'risque_modere';

      let tendance = 'stable';
      if (item.reservations_annulees > statsHist.annulations_moyennes * 1.2) tendance = 'hausse_significative';
      else if (item.reservations_annulees > statsHist.annulations_moyennes) tendance = 'hausse_legere';
      else if (item.reservations_annulees < statsHist.annulations_moyennes * 0.8) tendance = 'baisse_significative';
      else if (item.reservations_annulees < statsHist.annulations_moyennes) tendance = 'baisse_legere';

      return {
        date_prediction: item.datereservation,
        date_formattee: new Date(item.datereservation).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'short'
        }),
        taux_annulation_prevu: Math.round(tauxAnnulationPrevu * 100) / 100,
        annulations_prevues: parseInt(item.reservations_annulees),
        pertes_prevues: parseInt(item.revenus_perdus),
        niveau_risque: niveauRisque,
        num_jour_semaine: new Date(item.datereservation).getDay(),
        tendance: tendance
      };
    });

    // Remplissage des jours sans données
    const aujourdhui = new Date();
    const donneesCompletes = [];
    
    for (let i = 1; i <= parseInt(periode); i++) {
      const date = new Date(aujourdhui);
      date.setDate(aujourdhui.getDate() + i);
      
      const dateStr = date.toISOString().split('T')[0];
      const donneeExistante = donneesFormatees.find(d => 
        new Date(d.date_prediction).toISOString().split('T')[0] === dateStr
      );
      
      if (donneeExistante) {
        donneesCompletes.push(donneeExistante);
      } else {
        // Jour sans annulation prévue
        const tauxBase = date.getDay() === 0 || date.getDay() === 6 ? 12 : 8;
        donneesCompletes.push({
          date_prediction: dateStr,
          date_formattee: date.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short'
          }),
          taux_annulation_prevu: tauxBase,
          annulations_prevues: 0,
          pertes_prevues: 0,
          niveau_risque: 'risque_faible',
          num_jour_semaine: date.getDay(),
          tendance: 'stable'
        });
      }
    }

    // Calcul des statistiques globales
    const stats = {
      periode_analyse: parseInt(periode),
      taux_moyen_prevu: Math.round(donneesCompletes.reduce((sum, item) => sum + item.taux_annulation_prevu, 0) / donneesCompletes.length * 100) / 100,
      annulations_total_prevues: donneesCompletes.reduce((sum, item) => sum + item.annulations_prevues, 0),
      pertes_total_prevues: donneesCompletes.reduce((sum, item) => sum + item.pertes_prevues, 0),
      jours_risque_eleve: donneesCompletes.filter(item => item.niveau_risque === 'risque_eleve').length,
      jours_risque_modere: donneesCompletes.filter(item => item.niveau_risque === 'risque_modere').length,
      jours_risque_faible: donneesCompletes.filter(item => item.niveau_risque === 'risque_faible').length,
      annulations_moyennes_historique: parseFloat(statsHist.annulations_moyennes) || 0,
      revenus_perdus_moyens_historique: parseFloat(statsHist.revenus_perdus_moyens) || 0
    };

    res.json({
      success: true,
      data: donneesCompletes,
      statistiques: stats,
      periode: parseInt(periode)
    });
  } catch (error) {
    console.error('❌ Erreur prévisions annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Analyse détaillée des annulations
router.get('/analyse-annulations', async (req, res) => {
  try {
    const [
      statsGlobales,
      annulationsParTerrain,
      annulationsParJourSemaine,
      annulationsParHoraire,
      evolutionMensuelle,
      comparatifStatuts
    ] = await Promise.all([
      // Statistiques globales des annulations
      db.query(`
        SELECT 
          COUNT(*) as total_annulations,
          COALESCE(SUM(tarif), 0) as revenus_perdus_total,
          ROUND(AVG(tarif), 2) as perte_moyenne_par_annulation,
          COUNT(DISTINCT numeroterrain) as terrains_affectes,
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days')
            ), 2
          ) as taux_annulation_global,
          MIN(datereservation) as premiere_annulation,
          MAX(datereservation) as derniere_annulation
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      `),

      // Annulations par terrain
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          typeterrain,
          COUNT(*) as annulations,
          COALESCE(SUM(tarif), 0) as revenus_perdus,
          ROUND(AVG(tarif), 2) as perte_moyenne,
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE numeroterrain = r.numeroterrain AND datereservation >= CURRENT_DATE - INTERVAL '30 days')
            ), 2
          ) as taux_annulation_terrain
        FROM reservation r
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain, nomterrain, typeterrain
        ORDER BY annulations DESC
      `),

      // Annulations par jour de la semaine
      db.query(`
        SELECT 
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          EXTRACT(DOW FROM datereservation) as jour_numero,
          COUNT(*) as nombre_annulations,
          COALESCE(SUM(tarif), 0) as revenus_perdus,
          ROUND(AVG(tarif), 2) as perte_moyenne
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY jour_semaine, jour_numero
        ORDER BY jour_numero
      `),

      // Annulations par créneau horaire
      db.query(`
        SELECT 
          heuredebut,
          heurefin,
          COUNT(*) as annulations,
          COALESCE(SUM(tarif), 0) as revenus_perdus,
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE heuredebut = r.heuredebut AND statut = 'annulée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days')
            ), 2
          ) as concentration_horaire
        FROM reservation r
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY heuredebut, heurefin
        ORDER BY annulations DESC
        LIMIT 10
      `),

      // Évolution mensuelle des annulations
      db.query(`
        WITH mois_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '11 months',
            CURRENT_DATE,
            '1 month'::interval
          )::date as mois
        )
        SELECT 
          TO_CHAR(ms.mois, 'YYYY-MM') as periode,
          TO_CHAR(ms.mois, 'Mon YYYY') as periode_affichage,
          COUNT(r.numeroreservations) as annulations,
          COALESCE(SUM(r.tarif), 0) as revenus_perdus,
          COUNT(DISTINCT r.numeroterrain) as terrains_affectes
        FROM mois_series ms
        LEFT JOIN reservation r ON 
          EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
          AND r.statut = 'annulée'
        GROUP BY ms.mois
        ORDER BY ms.mois ASC
      `),

      // Comparatif avec les autres statuts
      db.query(`
        SELECT 
          statut,
          COUNT(*) as nombre,
          COALESCE(SUM(tarif), 0) as revenus,
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days')
            ), 2
          ) as pourcentage
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY statut
        ORDER BY nombre DESC
      `)
    ]);

    res.json({
      success: true,
      data: {
        statistiques_globales: statsGlobales.rows[0],
        par_terrain: annulationsParTerrain.rows,
        par_jour_semaine: annulationsParJourSemaine.rows,
        par_horaire: annulationsParHoraire.rows,
        evolution_mensuelle: evolutionMensuelle.rows,
        comparatif_statuts: comparatifStatuts.rows
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;