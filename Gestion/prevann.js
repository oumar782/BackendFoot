// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (version annulations)
router.get('/dashboard-annulations', async (req, res) => {
  try {
    // Récupérer les statistiques d'annulation en parallèle
    const [
      annulationsMois,
      revenusPerdusMois,
      tauxAnnulationMois,
      annulationsSemaine,
      motifsAnnulation,
      statsTempsReel,
      evolutionAnnulations
    ] = await Promise.all([
      // Annulations du mois actuel
      db.query(`
        SELECT COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Revenus perdus du mois
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_mois
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
          ) as taux_annulation_mois
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Annulations de la semaine (7 derniers jours)
      db.query(`
        SELECT 
          COUNT(*) as annulations_semaine,
          COUNT(DISTINCT DATE(datereservation)) as jours_avec_annulations
        FROM reservation 
        WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
      `),
      
      // Motifs d'annulation les plus fréquents
      db.query(`
        SELECT 
          motif_annulation,
          COUNT(*) as nombre_annulations,
          ROUND((COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM reservation WHERE statut = 'annulée'), 0)), 2) as pourcentage
        FROM reservation 
        WHERE statut = 'annulée'
        AND motif_annulation IS NOT NULL
        GROUP BY motif_annulation
        ORDER BY nombre_annulations DESC
        LIMIT 10
      `),
      
      // Statistiques temps réel des annulations
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annulations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE - INTERVAL '1 day' AND statut = 'annulée' THEN 1 END) as annulations_hier,
          COUNT(CASE WHEN statut = 'annulée' AND datereservation >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as annulations_7jours
        FROM reservation
      `),
      
      // Évolution des annulations sur 6 mois
      db.query(`
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          EXTRACT(YEAR FROM datereservation) as annee,
          COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY EXTRACT(YEAR FROM datereservation), EXTRACT(MONTH FROM datereservation)
        ORDER BY annee, mois
      `)
    ]);

    const stats = {
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      revenus_perdus_mois: parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
      taux_annulation_mois: parseFloat(tauxAnnulationMois.rows[0]?.taux_annulation_mois || 0),
      annulations_semaine: parseInt(annulationsSemaine.rows[0]?.annulations_semaine || 0),
      jours_avec_annulations: parseInt(annulationsSemaine.rows[0]?.jours_avec_annulations || 0),
      annulations_aujourdhui: parseInt(statsTempsReel.rows[0]?.annulations_aujourdhui || 0),
      annulations_hier: parseInt(statsTempsReel.rows[0]?.annulations_hier || 0),
      annulations_7jours: parseInt(statsTempsReel.rows[0]?.annulations_7jours || 0),
      motifs_annulation: motifsAnnulation.rows,
      evolution_annulations: evolutionAnnulations.rows
    };

    // Calcul des trends et alertes
    const analysis = await analyzeCancellationPatterns(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        analysis
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

// 📈 Évolution détaillée des annulations sur 12 mois
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
        COALESCE(COUNT(r.numeroreservations), 0) as annulations,
        COALESCE(SUM(r.tarif), 0) as revenus_perdus,
        ROUND(
          (COUNT(r.numeroreservations) * 100.0 / NULLIF(
            (SELECT COUNT(*) FROM reservation r2 
             WHERE EXTRACT(YEAR FROM r2.datereservation) = EXTRACT(YEAR FROM ms.mois)
             AND EXTRACT(MONTH FROM r2.datereservation) = EXTRACT(MONTH FROM ms.mois)), 0)
          ), 2
        ) as taux_annulation_mois,
        COUNT(DISTINCT r.numeroterrain) as terrains_affectes
      FROM mois_series ms
      LEFT JOIN reservation r ON 
        EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
        AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
        AND r.statut = 'annulée'
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
        COUNT(*) as total_annulations,
        COALESCE(SUM(tarif), 0) as revenus_perdus,
        ROUND(AVG(tarif), 2) as perte_moyenne,
        ROUND(
          (COUNT(*) * 100.0 / NULLIF(
            (SELECT COUNT(*) FROM reservation r2 
             WHERE r2.numeroterrain = reservation.numeroterrain 
             AND r2.datereservation >= CURRENT_DATE - INTERVAL '90 days'), 0)
          ), 2
        ) as taux_annulation_terrain,
        MIN(datereservation) as premiere_annulation,
        MAX(datereservation) as derniere_annulation
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY total_annulations DESC, revenus_perdus DESC
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
router.get('/analyse-temporelle', async (req, res) => {
  try {
    const [
      annulationsParJour,
      annulationsParMois,
      annulationsParHeure,
      annulationsParJourSemaine
    ] = await Promise.all([
      // Annulations par jour de la semaine
      db.query(`
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          TO_CHAR(datereservation, 'Day') as nom_jour,
          COUNT(*) as nombre_annulations,
          ROUND(AVG(tarif), 2) as perte_moyenne
        FROM reservation 
        WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
        ORDER BY jour_semaine
      `),
      
      // Annulations par mois
      db.query(`
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          TO_CHAR(datereservation, 'Month') as nom_mois,
          COUNT(*) as nombre_annulations,
          ROUND(AVG(tarif), 2) as perte_moyenne
        FROM reservation 
        WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '365 days'
        GROUP BY EXTRACT(MONTH FROM datereservation), TO_CHAR(datereservation, 'Month')
        ORDER BY mois
      `),
      
      // Annulations par heure de la journée
      db.query(`
        SELECT 
          EXTRACT(HOUR FROM heure_reservation) as heure,
          COUNT(*) as nombre_annulations,
          ROUND(AVG(tarif), 2) as perte_moyenne
        FROM reservation 
        WHERE statut = 'annulée'
        AND heure_reservation IS NOT NULL
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY EXTRACT(HOUR FROM heure_reservation)
        ORDER BY heure
      `),
      
      // Tendances par jour de la semaine
      db.query(`
        SELECT 
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY TO_CHAR(datereservation, 'Day'), EXTRACT(DOW FROM datereservation)
        ORDER BY EXTRACT(DOW FROM datereservation)
      `)
    ]);

    res.json({
      success: true,
      data: {
        par_jour_semaine: annulationsParJour.rows,
        par_mois: annulationsParMois.rows,
        par_heure: annulationsParHeure.rows,
        tendances_jour_semaine: annulationsParJourSemaine.rows
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

// 🔮 Prévisions des annulations futures
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH historique_annulations AS (
        -- Analyse des patterns historiques d'annulation
        SELECT 
          COUNT(*) as annulations_total,
          ROUND(AVG(tarif), 2) as perte_moyenne,
          COUNT(DISTINCT numeroterrain) as terrains_affectes,
          ROUND(
            (COUNT(*) * 100.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation 
               WHERE datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE), 0)
            ), 2
          ) as taux_annulation_historique
        FROM reservation 
        WHERE statut = 'annulée'
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE
      ),
      reservations_futures AS (
        -- Réservations futures avec risque d'annulation
        SELECT 
          numeroreservations,
          numeroterrain,
          datereservation,
          tarif,
          -- Calcul du score de risque basé sur l'historique du terrain
          (
            SELECT COUNT(*) * 1.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation r2 
               WHERE r2.numeroterrain = r.numeroterrain 
               AND r2.datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE), 1
            )
            FROM reservation r3 
            WHERE r3.numeroterrain = r.numeroterrain 
            AND r3.statut = 'annulée'
            AND r3.datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE
          ) as score_risque,
          -- Jour de la semaine
          EXTRACT(DOW FROM datereservation) as jour_semaine
        FROM reservation r
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      ),
      predictions AS (
        SELECT 
          rf.*,
          CASE 
            WHEN rf.score_risque > 0.3 THEN 'Élevé'
            WHEN rf.score_risque > 0.1 THEN 'Moyen'
            ELSE 'Faible'
          END as niveau_risque,
          ha.taux_annulation_historique,
          ha.perte_moyenne
        FROM reservations_futures rf
        CROSS JOIN historique_annulations ha
        WHERE rf.score_risque IS NOT NULL
      )
      SELECT 
        niveau_risque,
        COUNT(*) as reservations_a_risque,
        SUM(tarif) as perte_potentielle,
        ROUND(AVG(score_risque * 100), 2) as probabilite_moyenne,
        COUNT(DISTINCT numeroterrain) as terrains_concernes,
        MIN(datereservation) as premiere_date_risque,
        MAX(datereservation) as derniere_date_risque
      FROM predictions
      GROUP BY niveau_risque
      ORDER BY 
        CASE niveau_risque
          WHEN 'Élevé' THEN 1
          WHEN 'Moyen' THEN 2
          WHEN 'Faible' THEN 3
        END
    `);

    // Statistiques détaillées des prévisions
    const statsPrevisions = await db.query(`
      SELECT 
        COUNT(*) as total_reservations_futures,
        SUM(CASE WHEN risque_calcule > 0.1 THEN 1 ELSE 0 END) as reservations_risque,
        ROUND(
          (SUM(CASE WHEN risque_calcule > 0.1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0)
          ), 2
        ) as pourcentage_risque,
        SUM(CASE WHEN risque_calcule > 0.1 THEN tarif ELSE 0 END) as perte_potentielle_totale
      FROM (
        SELECT 
          tarif,
          (
            SELECT COUNT(*) * 1.0 / NULLIF(
              (SELECT COUNT(*) FROM reservation r2 
               WHERE r2.numeroterrain = r.numeroterrain 
               AND r2.datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE), 1
            )
            FROM reservation r3 
            WHERE r3.numeroterrain = r.numeroterrain 
            AND r3.statut = 'annulée'
            AND r3.datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE
          ) as risque_calcule
        FROM reservation r
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      ) risques
    `);

    res.json({
      success: true,
      data: {
        previsions_par_risque: result.rows,
        statistiques_generales: statsPrevisions.rows[0],
        periode_analyse: parseInt(periode),
        date_generation: new Date().toISOString()
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

// 📋 Détail des annulations récentes
router.get('/annulations-recentes', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const result = await db.query(`
      SELECT 
        numeroreservations,
        numeroterrain,
        datereservation,
        heure_reservation,
        tarif,
        motif_annulation,
        date_annulation,
        EXTRACT(EPOCH FROM (date_annulation - datereservation)) / 3600 as heures_avant_annulation
      FROM reservation 
      WHERE statut = 'annulée'
      ORDER BY date_annulation DESC
      LIMIT $1
    `, [limit]);

    res.json({
      success: true,
      data: result.rows,
      total: result.rowCount
    });
  } catch (error) {
    console.error('❌ Erreur annulations récentes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour analyser les patterns d'annulation
async function analyzeCancellationPatterns(stats) {
  try {
    const analysis = {
      alertes: [],
      recommendations: [],
      tendances: {}
    };

    // Alertes basées sur les seuils
    if (stats.taux_annulation_mois > 20) {
      analysis.alertes.push({
        niveau: 'CRITIQUE',
        message: `Taux d'annulation élevé: ${stats.taux_annulation_mois}% ce mois-ci`,
        action: 'Revoyez votre politique d annulation'
      });
    }

    if (stats.revenus_perdus_mois > 1000) {
      analysis.alertes.push({
        niveau: 'ÉLEVÉ',
        message: `Perte financière importante: ${stats.revenus_perdus_mois}€ ce mois-ci`,
        action: 'Analysez les motifs d annulation récurrents'
      });
    }

    if (stats.annulations_aujourdhui > 5) {
      analysis.alertes.push({
        niveau: 'URGENT',
        message: `${stats.annulations_aujourdhui} annulations aujourd'hui`,
        action: 'Vérifiez les problèmes potentiels'
      });
    }

    // Recommendations
    if (stats.motifs_annulation.length > 0) {
      const motifPrincipal = stats.motifs_annulation[0];
      analysis.recommendations.push({
        type: 'MOTIF_PRINCIPAL',
        message: `Motif d'annulation principal: "${motifPrincipal.motif_annulation}" (${motifPrincipal.pourcentage}%)`,
        suggestion: 'Mettez en place des actions correctives'
      });
    }

    // Analyse de tendance
    if (stats.evolution_annulations.length >= 2) {
      const dernierMois = stats.evolution_annulations[stats.evolution_annulations.length - 1];
      const avantDernierMois = stats.evolution_annulations[stats.evolution_annulations.length - 2];
      
      const evolution = ((dernierMois.annulations_mois - avantDernierMois.annulations_mois) / avantDernierMois.annulations_mois) * 100;
      
      analysis.tendances.evolution_mensuelle = {
        valeur: Math.round(evolution),
        direction: evolution > 0 ? 'HAUSSE' : 'BAISSE'
      };
    }

    return analysis;
  } catch (error) {
    console.error('Erreur analyse patterns:', error);
    return { alertes: [], recommendations: [], tendances: {} };
  }
}

export default router;