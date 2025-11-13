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

// 🔮 Prévisions des annulations futures
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH historique_annulations AS (
        SELECT 
          COUNT(*) as annulations_total,
          ROUND(AVG(annulations_jour), 2) as annulations_moyennes_jour,
          ROUND(AVG(taux_annulation_jour), 2) as taux_annulation_moyen
        FROM (
          SELECT 
            datereservation,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_jour,
            COUNT(*) as total_jour,
            ROUND(
              (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
              NULLIF(COUNT(*), 0)
              ), 2
            ) as taux_annulation_jour
          FROM reservation 
          WHERE datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '1 day'
          GROUP BY datereservation
        ) stats_jour
      ),
      reservations_futures AS (
        SELECT 
          COUNT(*) as reservations_prevues,
          COALESCE(SUM(tarif), 0) as revenus_prevus
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      )
      SELECT 
        ha.annulations_moyennes_jour,
        ha.taux_annulation_moyen,
        rf.reservations_prevues,
        rf.revenus_prevus,
        -- Prévisions basées sur la moyenne historique
        ROUND(ha.annulations_moyennes_jour * ${periode}) as annulations_prevues,
        ROUND(rf.revenus_prevus * (ha.taux_annulation_moyen / 100)) as revenus_risque_perte,
        -- Niveau d'alerte
        CASE 
          WHEN ha.taux_annulation_moyen > 20 THEN 'Élevé'
          WHEN ha.taux_annulation_moyen > 10 THEN 'Modéré'
          ELSE 'Faible'
        END as niveau_risque_annulations
      FROM historique_annulations ha, reservations_futures rf
    `);

    // Analyse des patterns d'annulation récents
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
        previsions: result.rows[0],
        patterns_recents: patterns.rows,
        periode_analyse: parseInt(periode)
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

export default router;