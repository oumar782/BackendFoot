// routes/stats.js - VERSION RÉSERVATIONS ANNULÉES
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (ANNULATIONS)
router.get('/dashboard-annulations', async (req, res) => {
  try {
    // Récupérer les statistiques d'annulation en parallèle
    const [
      revenusPerdusMois,
      annulationsMois,
      clientsImpactes,
      tauxAnnulation,
      statsTempsReel,
      revenusPerdusAnnee,
      motifsAnnulation
    ] = await Promise.all([
      // Revenus perdus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Annulations du mois
      db.query(`
        SELECT COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Clients impactés par des annulations ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_impactes
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux d'annulation du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel des annulations
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE - INTERVAL '1 day' AND statut = 'annulée' THEN 1 END) as annules_hier,
          COUNT(CASE WHEN datereservation >= CURRENT_DATE - INTERVAL '7 days' AND statut = 'annulée' THEN 1 END) as annulations_semaine
        FROM reservation
      `),
      
      // Revenus perdus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Motifs d'annulation les plus fréquents
      db.query(`
        SELECT 
          motifannulation,
          COUNT(*) as nombre_annulations,
          ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM reservation WHERE statut = 'annulée'), 0)), 2) as pourcentage
        FROM reservation 
        WHERE statut = 'annulée'
        AND motifannulation IS NOT NULL
        GROUP BY motifannulation
        ORDER BY nombre_annulations DESC
        LIMIT 5
      `)
    ]);

    const stats = {
      revenus_perdus_mois: parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      clients_impactes: parseInt(clientsImpactes.rows[0]?.clients_impactes || 0),
      taux_annulation: parseFloat(tauxAnnulation.rows[0]?.taux_annulation || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      annules_hier: parseInt(statsTempsReel.rows[0]?.annules_hier || 0),
      annulations_semaine: parseInt(statsTempsReel.rows[0]?.annulations_semaine || 0),
      revenus_perdus_annee: parseFloat(revenusPerdusAnnee.rows[0]?.revenus_perdus_annee || 0),
      motifs_annulation: motifsAnnulation.rows
    };

    // Calcul des trends spécifiques aux annulations
    const trends = await calculateTrendsAnnulations(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques annulations dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Évolution des annulations sur 12 mois
router.get('/evolution-annulations', async (req, res) => {
  try {
    const result = await db.query(`
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
        COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
        COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
        COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as reservations_confirmees,
        ROUND(
          (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(r.numeroreservations), 0)
          ), 2
        ) as taux_annulation_mensuel,
        COUNT(DISTINCT CASE WHEN r.statut = 'annulée' THEN r.idclient END) as clients_impactes
      FROM mois_series ms
      LEFT JOIN reservation r ON 
        EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
        AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
      GROUP BY ms.mois
      ORDER BY ms.mois ASC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur évolution annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🎯 Analyse des terrains les plus impactés par les annulations
router.get('/impact-terrains-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(*) as total_annulations,
        COALESCE(SUM(tarif), 0) as revenus_perdus,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as reservations_confirmees,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_terrain,
        ROUND(AVG(tarif), 2) as valeur_moyenne_annulation,
        MAX(datereservation) as derniere_annulation
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
      ORDER BY total_annulations DESC, revenus_perdus DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur analyse terrains impactés:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 👥 Analyse des clients avec annulations répétées
router.get('/clients-annulations-repetees', async (req, res) => {
  try {
    const [
      clientsAnnulationsRepetees,
      statsAnnulationsClients,
      periodeSensible
    ] = await Promise.all([
      // Clients avec le plus d'annulations
      db.query(`
        SELECT 
          c.idclient,
          c.nom,
          c.prenom,
          c.email,
          c.telephone,
          COUNT(r.numeroreservations) as total_annulations,
          COALESCE(SUM(r.tarif), 0) as total_revenus_perdus,
          COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as reservations_confirmees,
          ROUND(
            (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(r.numeroreservations), 0)
            ), 2
          ) as taux_annulation_client,
          MAX(r.datereservation) as derniere_annulation
        FROM clients c
        JOIN reservation r ON c.idclient = r.idclient
        WHERE r.statut = 'annulée'
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone
        HAVING COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) >= 2
        ORDER BY total_annulations DESC, total_revenus_perdus DESC
        LIMIT 15
      `),
      
      // Statistiques générales des annulations par client
      db.query(`
        SELECT 
          COUNT(DISTINCT idclient) as total_clients_annulations,
          ROUND(AVG(nombre_annulations), 2) as annulations_moyennes_par_client,
          MAX(nombre_annulations) as annulations_max_client,
          COUNT(CASE WHEN nombre_annulations >= 3 THEN 1 END) as clients_annulations_repetees
        FROM (
          SELECT 
            idclient,
            COUNT(*) as nombre_annulations
          FROM reservation 
          WHERE statut = 'annulée'
          GROUP BY idclient
        ) stats_annulations
      `),
      
      // Période de l'année la plus sensible aux annulations
      db.query(`
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          TO_CHAR(datereservation, 'Month') as nom_mois,
          COUNT(*) as annulations_mois,
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée')
            ), 2
          ) as pourcentage_annulations
        FROM reservation 
        WHERE statut = 'annulée'
        GROUP BY EXTRACT(MONTH FROM datereservation), TO_CHAR(datereservation, 'Month')
        ORDER BY annulations_mois DESC
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_annulations_repetees: clientsAnnulationsRepetees.rows,
        statistiques_generales: statsAnnulationsClients.rows[0],
        periode_sensible_annulations: periodeSensible.rows
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse clients annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions et tendances des annulations
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH historique_annulations AS (
        -- Analyse des annulations passées pour établir des patterns
        SELECT 
          datereservation,
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          EXTRACT(MONTH FROM datereservation) as mois,
          COUNT(*) as annulations_jour,
          COALESCE(SUM(tarif), 0) as revenus_perdus_jour,
          COUNT(DISTINCT numeroterrain) as terrains_impactes
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE - INTERVAL '1 day'
        GROUP BY datereservation, EXTRACT(DOW FROM datereservation), EXTRACT(MONTH FROM datereservation)
      ),
      patterns_semaine AS (
        -- Pattern d'annulations par jour de la semaine
        SELECT 
          jour_semaine,
          ROUND(AVG(annulations_jour), 2) as annulations_moyennes_jour,
          ROUND(AVG(revenus_perdus_jour), 2) as revenus_moyens_perdus
        FROM historique_annulations
        GROUP BY jour_semaine
      ),
      reservations_futures AS (
        -- Réservations futures à risque d'annulation
        SELECT 
          r.datereservation,
          EXTRACT(DOW FROM r.datereservation) as jour_semaine,
          COUNT(*) as reservations_prevues,
          COALESCE(SUM(r.tarif), 0) as revenus_en_jeu,
          COUNT(DISTINCT r.idclient) as clients_concernees
        FROM reservation r
        WHERE r.statut = 'confirmée'
          AND r.datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
        GROUP BY r.datereservation, EXTRACT(DOW FROM r.datereservation)
      )
      SELECT 
        rf.datereservation,
        TO_CHAR(rf.datereservation, 'DD/MM') as date_formattee,
        TO_CHAR(rf.datereservation, 'Day') as jour_semaine,
        rf.reservations_prevues,
        rf.revenus_en_jeu,
        rf.clients_concernees,
        ps.annulations_moyennes_jour as annulations_moyennes_ce_jour,
        ps.revenus_moyens_perdus as revenus_moyens_perdus_ce_jour,
        ROUND(
          (ps.annulations_moyennes_jour * 100.0 / NULLIF(rf.reservations_prevues, 0)
          ), 2
        ) as risque_annulation_pourcentage,
        CASE 
          WHEN (ps.annulations_moyennes_jour * 100.0 / NULLIF(rf.reservations_prevues, 0)) > 20 THEN 'Élevé'
          WHEN (ps.annulations_moyennes_jour * 100.0 / NULLIF(rf.reservations_prevues, 0)) > 10 THEN 'Modéré'
          ELSE 'Faible'
        END as niveau_risque
      FROM reservations_futures rf
      LEFT JOIN patterns_semaine ps ON rf.jour_semaine = ps.jour_semaine
      ORDER BY rf.datereservation ASC, niveau_risque DESC
    `);

    // Calcul des statistiques de risque
    const statsRisque = {
      jours_analyse: result.rows.length,
      jours_risque_eleve: result.rows.filter(row => row.niveau_risque === 'Élevé').length,
      jours_risque_modere: result.rows.filter(row => row.niveau_risque === 'Modéré').length,
      revenus_totaux_en_jeu: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_en_jeu), 0),
      revenus_moyens_risque: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_moyens_perdus_ce_jour), 0) / result.rows.length,
      periode_plus_risque: result.rows.reduce((max, row) => 
        parseFloat(row.risque_annulation_pourcentage) > parseFloat(max.risque_annulation_pourcentage) ? row : result.rows[0]
      )
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques_risque: statsRisque,
      periode_analyse: parseInt(periode)
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

// 📅 Analyse détaillée des motifs d'annulation
router.get('/analyse-motifs-annulation', async (req, res) => {
  try {
    const { date_debut, date_fin } = req.query;
    
    let dateCondition = '';
    if (date_debut && date_fin) {
      dateCondition = `AND datereservation BETWEEN '${date_debut}' AND '${date_fin}'`;
    }

    const result = await db.query(`
      SELECT 
        motifannulation,
        COUNT(*) as nombre_annulations,
        COALESCE(SUM(tarif), 0) as revenus_perdus,
        ROUND(AVG(tarif), 2) as valeur_moyenne_annulation,
        ROUND(
          (COUNT(*) * 100.0 / 
          NULLIF((SELECT COUNT(*) FROM reservation WHERE statut = 'annulée' ${dateCondition}), 0)
          ), 2
        ) as pourcentage_total,
        -- Analyse temporelle des motifs
        COUNT(CASE WHEN EXTRACT(DOW FROM datereservation) IN (0,6) THEN 1 END) as annulations_weekend,
        COUNT(CASE WHEN EXTRACT(DOW FROM datereservation) BETWEEN 1 AND 5 THEN 1 END) as annulations_semaine,
        -- Impact client
        COUNT(DISTINCT idclient) as clients_impactes,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (datereservation - CURRENT_DATE)) / 86400
        ), 1) as delai_moyen_avant_reservation
      FROM reservation 
      WHERE statut = 'annulée'
      ${dateCondition}
      GROUP BY motifannulation
      ORDER BY nombre_annulations DESC, revenus_perdus DESC
    `);

    // Statistiques globales des motifs
    const statsGlobales = {
      total_annulations: result.rows.reduce((sum, row) => sum + parseInt(row.nombre_annulations), 0),
      total_revenus_perdus: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_perdus), 0),
      motifs_uniques: result.rows.length,
      motif_principal: result.rows[0]?.motifannulation || 'Aucun',
      pourcentage_motif_principal: result.rows[0]?.pourcentage_total || 0
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques_globales: statsGlobales,
      periode_analyse: date_debut && date_fin ? `${date_debut} à ${date_fin}` : 'Toute période'
    });
  } catch (error) {
    console.error('❌ Erreur analyse motifs annulation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends des annulations
async function calculateTrendsAnnulations(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenus_perdus_mois_dernier,
        COUNT(*) as annulations_mois_dernier,
        COUNT(DISTINCT idclient) as clients_impactes_mois_dernier
      FROM reservation 
      WHERE statut = 'annulée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    const trends = {
      revenus_perdus: {
        value: calculatePercentageChange(currentStats.revenus_perdus_mois, lastMonth.revenus_perdus_mois_dernier),
        isPositive: currentStats.revenus_perdus_mois < lastMonth.revenus_perdus_mois_dernier // Positive si baisse des pertes
      },
      annulations: {
        value: calculatePercentageChange(currentStats.annulations_mois, lastMonth.annulations_mois_dernier),
        isPositive: currentStats.annulations_mois < lastMonth.annulations_mois_dernier // Positive si baisse des annulations
      },
      clients_impactes: {
        value: calculatePercentageChange(currentStats.clients_impactes, lastMonth.clients_impactes_mois_dernier),
        isPositive: currentStats.clients_impactes < lastMonth.clients_impactes_mois_dernier
      },
      taux_annulation: {
        value: 0, // Serait calculé séparément
        isPositive: currentStats.taux_annulation < 10 // Positive si taux inférieur à 10%
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends annulations:', error);
    return {};
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;