// routes/stats.js
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
      terrainsAffectes,
      tauxAnnulation,
      statsTempsReel,
      revenusPerdusAnnee
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
      
      // Terrains affectés par les annulations ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_affectes
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux d'annulation moyen du mois
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
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as total_aujourdhui,
          ROUND(
            (COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END), 0)
            ), 2
          ) as taux_annulation_aujourdhui
        FROM reservation
      `),
      
      // Revenus perdus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `)
    ]);

    const stats = {
      revenus_perdus_mois: parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      terrains_affectes: parseInt(terrainsAffectes.rows[0]?.terrains_affectes || 0),
      taux_annulation: parseFloat(tauxAnnulation.rows[0]?.taux_annulation || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      total_aujourdhui: parseInt(statsTempsReel.rows[0]?.total_aujourdhui || 0),
      taux_annulation_aujourdhui: parseFloat(statsTempsReel.rows[0]?.taux_annulation_aujourdhui || 0),
      revenus_perdus_annee: parseFloat(revenusPerdusAnnee.rows[0]?.revenus_perdus_annee || 0)
    };

    // Calcul des trends d'annulation
    const trends = await calculateAnnulationTrends(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques annulations:', error);
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
        COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
        COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as confirmations,
        COUNT(r.numeroreservations) as total_reservations,
        COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(r.numeroreservations), 0)
          ), 2
        ) as taux_annulation_mensuel
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

// 🎯 Analyse des terrains les plus affectés par les annulations
router.get('/terrains-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_total,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_total,
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_terrain,
        -- Période avec le plus d'annulations
        (
          SELECT TO_CHAR(datereservation, 'YYYY-MM')
          FROM reservation r2 
          WHERE r2.numeroterrain = reservation.numeroterrain 
          AND r2.statut = 'annulée'
          GROUP BY TO_CHAR(datereservation, 'YYYY-MM')
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) as periode_max_annulations
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY numeroterrain, nomterrain, typeterrain
      HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
      ORDER BY annulations_total DESC, taux_annulation_terrain DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur analyse terrains annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📅 Analyse temporelle des annulations
router.get('/analyse-temporelle-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH stats_journalieres AS (
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          EXTRACT(DOW FROM datereservation) as num_jour_semaine,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
          COUNT(*) as total_reservations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY datereservation
      )
      SELECT 
        jour_semaine,
        num_jour_semaine,
        ROUND(AVG(annulations), 2) as annulations_moyennes,
        ROUND(AVG(confirmations), 2) as confirmations_moyennes,
        ROUND(AVG(total_reservations), 2) as reservations_moyennes,
        ROUND(AVG(revenus_perdus), 2) as revenus_perdus_moyens,
        ROUND(
          (SUM(annulations) * 100.0 / NULLIF(SUM(total_reservations), 0)
          ), 2
        ) as taux_annulation_jour,
        SUM(annulations) as annulations_total,
        SUM(confirmations) as confirmations_total
      FROM stats_journalieres
      GROUP BY jour_semaine, num_jour_semaine
      ORDER BY num_jour_semaine
    `);

    // Statistiques globales de la période
    const statsGlobales = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as total_revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_global
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
    `);

    res.json({
      success: true,
      data: {
        analyse_journaliere: result.rows,
        statistiques_globales: statsGlobales.rows[0],
        periode_analyse: parseInt(periode)
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse temporelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions des annulations futures AVEC DÉTAILS PAR JOUR
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    // 1. Obtenir les statistiques historiques par jour de la semaine
    const historiqueParJour = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_semaine,
        TO_CHAR(datereservation, 'Day') as nom_jour,
        COUNT(*) as total_reservations_historique,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_historique,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_historique,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_historique
      FROM reservation 
      WHERE datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE - INTERVAL '1 day'
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_semaine
    `);

    // 2. Obtenir les réservations confirmées futures par jour
    const reservationsFutures = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as num_jour_semaine,
        COUNT(*) as reservations_prevues,
        COALESCE(SUM(tarif), 0) as revenus_prevus
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `);

    // 3. Calculer les prévisions par jour
    const previsionsParJour = reservationsFutures.rows.map(jour => {
      const statsJour = historiqueParJour.rows.find(
        stat => stat.jour_semaine === jour.num_jour_semaine
      );
      
      const tauxAnnulationMoyen = statsJour ? parseFloat(statsJour.taux_annulation_historique) : 10.0; // Valeur par défaut 10%
      const annulationsPrevues = Math.round(jour.reservations_prevues * (tauxAnnulationMoyen / 100));
      const revenusRisquePerte = Math.round(jour.revenus_prevus * (tauxAnnulationMoyen / 100));
      
      return {
        date: jour.datereservation,
        jour_semaine: jour.jour_semaine.trim(),
        reservations_prevues: parseInt(jour.reservations_prevues),
        revenus_prevus: parseFloat(jour.revenus_prevus),
        taux_annulation_historique: tauxAnnulationMoyen,
        annulations_prevues: annulationsPrevues,
        revenus_risque_perte: revenusRisquePerte,
        niveau_risque: getNiveauRisque(tauxAnnulationMoyen)
      };
    });

    // 4. Statistiques globales des prévisions
    const statsGlobalesPrevisions = previsionsParJour.reduce((acc, jour) => ({
      reservations_prevues_total: acc.reservations_prevues_total + jour.reservations_prevues,
      revenus_prevus_total: acc.revenus_prevus_total + jour.revenus_prevus,
      annulations_prevues_total: acc.annulations_prevues_total + jour.annulations_prevues,
      revenus_risque_total: acc.revenus_risque_total + jour.revenus_risque_perte
    }), {
      reservations_prevues_total: 0,
      revenus_prevus_total: 0,
      annulations_prevues_total: 0,
      revenus_risque_total: 0
    });

    // 5. Taux d'annulation moyen prévu
    const tauxAnnulationMoyenPrevu = statsGlobalesPrevisions.reservations_prevues_total > 0 
      ? (statsGlobalesPrevisions.annulations_prevues_total / statsGlobalesPrevisions.reservations_prevues_total) * 100
      : 0;

    // 6. Jours à haut risque
    const joursHautRisque = previsionsParJour
      .filter(jour => jour.niveau_risque === 'Élevé')
      .sort((a, b) => b.annulations_prevues - a.annulations_prevues);

    // 7. Analyse des patterns d'annulation récents
    const patterns = await db.query(`
      SELECT 
        TO_CHAR(datereservation, 'YYYY-MM-DD') as date_annulation,
        COUNT(*) as annulations_ce_jour,
        COALESCE(SUM(tarif), 0) as revenus_perdus
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY datereservation
      ORDER BY datereservation DESC
    `);

    res.json({
      success: true,
      data: {
        previsions_globales: {
          ...statsGlobalesPrevisions,
          taux_annulation_moyen_prevu: Math.round(tauxAnnulationMoyenPrevu * 100) / 100,
          periode_analyse: parseInt(periode),
          niveau_risque_global: getNiveauRisque(tauxAnnulationMoyenPrevu)
        },
        previsions_par_jour: previsionsParJour,
        jours_haut_risque: joursHautRisque.slice(0, 5), // Top 5 jours à haut risque
        statistiques_historiques: historiqueParJour.rows,
        patterns_recents: patterns.rows,
        resume_hebdomadaire: calculerResumeHebdomadaire(previsionsParJour)
      }
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

// 🔮 NOUVELLE ROUTE : Prévisions détaillées par jour
router.get('/previsions-journalieres', async (req, res) => {
  try {
    const { jours = '14' } = req.query;
    
    // 1. Historique des taux d'annulation par jour de la semaine
    const historiqueTaux = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_semaine,
        TO_CHAR(datereservation, 'Day') as nom_jour,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_moyen,
        COUNT(*) as echantillon_reservations
      FROM reservation 
      WHERE datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE - INTERVAL '1 day'
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_semaine
    `);

    // 2. Réservations futures groupées par jour
    const reservationsParJour = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'DD/MM/YYYY') as date_formattee,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as num_jour_semaine,
        COUNT(*) as nb_reservations,
        COUNT(DISTINCT numeroterrain) as terrains_occupes,
        COALESCE(SUM(tarif), 0) as revenus_prevus,
        ROUND(AVG(tarif), 2) as tarif_moyen
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${jours} days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `);

    // 3. Calcul des prévisions détaillées par jour
    const previsionsDetaillees = reservationsParJour.rows.map(jour => {
      const statsJour = historiqueTaux.rows.find(
        stat => stat.jour_semaine === jour.num_jour_semaine
      );
      
      const tauxAnnulation = statsJour ? parseFloat(statsJour.taux_annulation_moyen) : 10.0;
      const annulationsPrevues = Math.ceil(jour.nb_reservations * (tauxAnnulation / 100));
      const revenusRisque = Math.round(jour.revenus_prevus * (tauxAnnulation / 100));
      
      return {
        date: jour.datereservation,
        date_affichage: jour.date_formattee,
        jour_semaine: jour.jour_semaine.trim(),
        reservations_prevues: parseInt(jour.nb_reservations),
        terrains_occupes: parseInt(jour.terrains_occupes),
        revenus_prevus: parseFloat(jour.revenus_prevus),
        tarif_moyen: parseFloat(jour.tarif_moyen),
        taux_annulation_historique: tauxAnnulation,
        annulations_prevues: annulationsPrevues,
        revenus_risque_perte: revenusRisque,
        revenus_prevus_apres_annulation: parseFloat(jour.revenus_prevus) - revenusRisque,
        niveau_risque: getNiveauRisque(tauxAnnulation),
        confiance_prevision: Math.min(100, Math.max(50, statsJour ? statsJour.echantillon_reservations : 0))
      };
    });

    // 4. Métriques globales
    const metriquesGlobales = previsionsDetaillees.reduce((acc, jour) => ({
      total_reservations: acc.total_reservations + jour.reservations_prevues,
      total_revenus_prevus: acc.total_revenus_prevus + jour.revenus_prevus,
      total_annulations_prevues: acc.total_annulations_prevues + jour.annulations_prevues,
      total_revenus_risque: acc.total_revenus_risque + jour.revenus_risque_perte
    }), {
      total_reservations: 0,
      total_revenus_prevus: 0,
      total_annulations_prevues: 0,
      total_revenus_risque: 0
    });

    metriquesGlobales.taux_annulation_moyen = metriquesGlobales.total_reservations > 0 
      ? Math.round((metriquesGlobales.total_annulations_prevues / metriquesGlobales.total_reservations) * 100 * 100) / 100
      : 0;

    metriquesGlobales.revenus_prevus_net = metriquesGlobales.total_revenus_prevus - metriquesGlobales.total_revenus_risque;

    res.json({
      success: true,
      data: {
        periode_analyse: parseInt(jours),
        metriques_globales: metriquesGlobales,
        previsions_journalieres: previsionsDetaillees,
        jours_critiques: previsionsDetaillees
          .filter(j => j.niveau_risque === 'Élevé')
          .sort((a, b) => b.revenus_risque_perte - a.revenus_risque_perte),
        meilleurs_jours: previsionsDetaillees
          .filter(j => j.niveau_risque === 'Faible')
          .sort((a, b) => b.revenus_prevus_apres_annulation - a.revenus_prevus_apres_annulation)
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur prévisions journalières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Tableau de bord complet annulations
router.get('/synthese-annulations', async (req, res) => {
  try {
    const [
      statsMois,
      topTerrains,
      evolutionMensuelle,
      analyseRecent
    ] = await Promise.all([
      // Statistiques du mois actuel
      db.query(`
        SELECT 
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_mois,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_mois
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Top 5 terrains avec le plus d'annulations
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '3 months'
        GROUP BY numeroterrain, nomterrain
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY annulations DESC
        LIMIT 5
      `),
      
      // Évolution sur 6 mois
      db.query(`
        WITH mois_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '5 months',
            CURRENT_DATE,
            '1 month'::interval
          )::date as mois
        )
        SELECT 
          TO_CHAR(ms.mois, 'Mon YYYY') as periode,
          COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(r.numeroreservations), 0)
            ), 2
          ) as taux_annulation
        FROM mois_series ms
        LEFT JOIN reservation r ON 
          EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
        GROUP BY ms.mois
        ORDER BY ms.mois ASC
      `),
      
      // Analyse des 7 derniers jours
      db.query(`
        SELECT 
          TO_CHAR(datereservation, 'DD/MM') as date_jour,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `)
    ]);

    res.json({
      success: true,
      data: {
        stats_mois: statsMois.rows[0],
        top_terrains_annulations: topTerrains.rows,
        evolution_6_mois: evolutionMensuelle.rows,
        analyse_7_jours: analyseRecent.rows
      }
    });
  } catch (error) {
    console.error('❌ Erreur synthèse annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends d'annulation
async function calculateAnnulationTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois_dernier,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois_dernier
      FROM reservation 
      WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    const trends = {
      annulations: {
        value: calculatePercentageChange(currentStats.annulations_mois, lastMonth.annulations_mois_dernier),
        isPositive: currentStats.annulations_mois < lastMonth.annulations_mois_dernier // Moins d'annulations = positif
      },
      revenus_perdus: {
        value: calculatePercentageChange(currentStats.revenus_perdus_mois, lastMonth.revenus_perdus_mois_dernier),
        isPositive: currentStats.revenus_perdus_mois < lastMonth.revenus_perdus_mois_dernier // Moins de revenus perdus = positif
      },
      taux_annulation: {
        value: calculatePercentageChange(currentStats.taux_annulation, 
          (lastMonth.annulations_mois_dernier * 100.0 / (lastMonth.annulations_mois_dernier + currentStats.confirmes_aujourdhui)) || 0),
        isPositive: currentStats.taux_annulation < ((lastMonth.annulations_mois_dernier * 100.0 / (lastMonth.annulations_mois_dernier + currentStats.confirmes_aujourdhui)) || 0)
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends annulations:', error);
    return {};
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

// Fonction pour déterminer le niveau de risque
function getNiveauRisque(tauxAnnulation) {
  if (tauxAnnulation > 20) return 'Élevé';
  if (tauxAnnulation > 10) return 'Modéré';
  return 'Faible';
}

// Fonction pour calculer le résumé hebdomadaire
function calculerResumeHebdomadaire(previsionsParJour) {
  const resume = {};
  
  previsionsParJour.forEach(jour => {
    if (!resume[jour.jour_semaine]) {
      resume[jour.jour_semaine] = {
        reservations_prevues: 0,
        annulations_prevues: 0,
        revenus_risque_perte: 0,
        nombre_jours: 0
      };
    }
    
    resume[jour.jour_semaine].reservations_prevues += jour.reservations_prevues;
    resume[jour.jour_semaine].annulations_prevues += jour.annulations_prevues;
    resume[jour.jour_semaine].revenus_risque_perte += jour.revenus_risque_perte;
    resume[jour.jour_semaine].nombre_jours += 1;
  });
  
  // Convertir en tableau et calculer les moyennes
  return Object.entries(resume).map(([jour, stats]) => ({
    jour_semaine: jour,
    reservations_prevues_moyennes: Math.round(stats.reservations_prevues / stats.nombre_jours),
    annulations_prevues_moyennes: Math.round(stats.annulations_prevues / stats.nombre_jours),
    revenus_risque_moyens: Math.round(stats.revenus_risque_perte / stats.nombre_jours),
    taux_annulation_moyen: Math.round((stats.annulations_prevues / stats.reservations_prevues) * 100 * 100) / 100
  })).sort((a, b) => b.taux_annulation_moyen - a.taux_annulation_moyen);
}

export default router;