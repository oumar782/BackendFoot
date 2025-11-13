// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (version annulations)
router.get('/dashboard', async (req, res) => {
  try {
    // Récupérer les statistiques en parallèle pour plus de performance
    const [
      pertesMois,
      annulationsMois,
      clientsImpactes,
      tauxAnnulation,
      statsTempsReel,
      pertesAnnee
    ] = await Promise.all([
      // Pertes du mois actuel dues aux annulations
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as pertes_mois
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
      
      // Clients impactés par les annulations ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_impactes
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux d'annulation moyen du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE))
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel des annulations
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annulations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as total_aujourdhui
        FROM reservation
      `),
      
      // Pertes de l'année pour le trend
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as pertes_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `)
    ]);

    const stats = {
      pertes_mois: parseFloat(pertesMois.rows[0]?.pertes_mois || 0),
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      clients_impactes: parseInt(clientsImpactes.rows[0]?.clients_impactes || 0),
      taux_annulation: parseFloat(tauxAnnulation.rows[0]?.taux_annulation || 0),
      annulations_aujourdhui: parseInt(statsTempsReel.rows[0]?.annulations_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      total_aujourdhui: parseInt(statsTempsReel.rows[0]?.total_aujourdhui || 0),
      pertes_annee: parseFloat(pertesAnnee.rows[0]?.pertes_annee || 0)
    };

    // Calcul des trends pour les annulations
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
    console.error('❌ Erreur statistiques dashboard annulations:', error);
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
        COALESCE(SUM(r.tarif), 0) as pertes,
        COUNT(r.numeroreservations) as annulations,
        COUNT(DISTINCT r.idclient) as clients_impactes,
        ROUND(
          (COUNT(r.numeroreservations) * 100.0 / 
          NULLIF((
            SELECT COUNT(*) 
            FROM reservation r2 
            WHERE EXTRACT(YEAR FROM r2.datereservation) = EXTRACT(YEAR FROM ms.mois)
            AND EXTRACT(MONTH FROM r2.datereservation) = EXTRACT(MONTH FROM ms.mois)
          ), 0)
          ), 2
        ) as taux_annulation_mensuel
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

// 🎯 Analyse des terrains avec le plus d'annulations
router.get('/analyse-annulations-terrains', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(*) as total_annulations,
        COALESCE(SUM(tarif), 0) as pertes_totales,
        ROUND(AVG(tarif), 2) as perte_moyenne,
        COUNT(DISTINCT idclient) as clients_impactes,
        ROUND(
          (COUNT(*) * 100.0 / 
          (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days')
          ), 2
        ) as part_annulations
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY total_annulations DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur analyse annulations terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 👥 Analyse des clients avec le plus d'annulations
router.get('/analyse-annulations-clients', async (req, res) => {
  try {
    const [
      clientsFrequentsAnnulations,
      statsAnnulations
    ] = await Promise.all([
      // Clients avec le plus d'annulations
      db.query(`
        SELECT 
          c.idclient,
          c.nom,
          c.prenom,
          c.email,
          COUNT(r.numeroreservations) as total_annulations,
          COALESCE(SUM(r.tarif), 0) as pertes_totales,
          MAX(r.datereservation) as derniere_annulation,
          ROUND(
            (COUNT(r.numeroreservations) * 100.0 / 
            NULLIF((
              SELECT COUNT(*) 
              FROM reservation r2 
              WHERE r2.idclient = c.idclient
            ), 0)
            ), 2
          ) as taux_annulation_personnel
        FROM clients c
        JOIN reservation r ON c.idclient = r.idclient
        WHERE r.statut = 'annulée'
        GROUP BY c.idclient, c.nom, c.prenom, c.email
        ORDER BY total_annulations DESC
        LIMIT 15
      `),
      
      // Stats générales annulations clients
      db.query(`
        SELECT 
          COUNT(DISTINCT idclient) as total_clients_annulations,
          ROUND(AVG(annulations_par_client), 2) as annulations_moyennes,
          MAX(annulations_par_client) as annulations_max,
          COUNT(DISTINCT CASE WHEN annulations_par_client >= 3 THEN idclient END) as clients_recurrents_annulations
        FROM (
          SELECT 
            idclient,
            COUNT(*) as annulations_par_client
          FROM reservation 
          WHERE statut = 'annulée'
          GROUP BY idclient
        ) stats_annulations
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_frequents_annulations: clientsFrequentsAnnulations.rows,
        statistiques_annulations: statsAnnulations.rows[0]
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse annulations clients:', error);
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
      WITH annulations_historiques AS (
        SELECT 
          datereservation,
          COUNT(*) as annulations_jour,
          COALESCE(SUM(tarif), 0) as pertes_jour,
          COUNT(DISTINCT numeroterrain) as terrains_impactes,
          COUNT(DISTINCT idclient) as clients_impactes
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '1 day'
        GROUP BY datereservation
      ),
      stats_annulations AS (
        SELECT 
          ROUND(AVG(annulations_jour), 2) as annulations_moyennes,
          ROUND(AVG(pertes_jour), 2) as pertes_moyennes,
          ROUND(STDDEV(annulations_jour), 2) as ecart_type_annulations,
          MAX(annulations_jour) as annulations_max
        FROM annulations_historiques
      ),
      reservations_futures AS (
        SELECT 
          datereservation,
          COUNT(*) as reservations_total,
          COALESCE(SUM(tarif), 0) as revenus_potentiels
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
        GROUP BY datereservation
      )
      SELECT 
        rf.datereservation,
        TO_CHAR(rf.datereservation, 'DD/MM') as date_formattee,
        rf.reservations_total,
        rf.revenus_potentiels,
        sa.annulations_moyennes,
        sa.pertes_moyennes,
        sa.ecart_type_annulations,
        sa.annulations_max,
        -- Prévision basée sur la moyenne historique
        ROUND(sa.annulations_moyennes) as annulations_prevues,
        ROUND(sa.pertes_moyennes) as pertes_prevues,
        -- Risque d'annulation (en pourcentage)
        ROUND(
          (sa.annulations_moyennes * 100.0 / NULLIF(rf.reservations_total, 0)), 
          2
        ) as risque_annulation_pourcentage,
        -- Niveau d'alerte
        CASE 
          WHEN (sa.annulations_moyennes + sa.ecart_type_annulations) > (rf.reservations_total * 0.3) THEN 'élevé'
          WHEN (sa.annulations_moyennes + sa.ecart_type_annulations) > (rf.reservations_total * 0.15) THEN 'modéré'
          ELSE 'faible'
        END as niveau_alerte
      FROM reservations_futures rf
      CROSS JOIN stats_annulations sa
      ORDER BY rf.datereservation ASC
    `);

    // Calcul des statistiques de prévision
    const stats = {
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.reservations_total), 0),
      annulations_total_prevues: result.rows.reduce((sum, row) => sum + parseInt(row.annulations_prevues), 0),
      pertes_total_prevues: result.rows.reduce((sum, row) => sum + parseFloat(row.pertes_prevues), 0),
      jours_avec_risque_eleve: result.rows.filter(row => row.niveau_alerte === 'élevé').length,
      jours_avec_risque_modere: result.rows.filter(row => row.niveau_alerte === 'modéré').length,
      taux_annulation_moyen: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.risque_annulation_pourcentage), 0) / result.rows.length)
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
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

// Fonction utilitaire pour calculer les trends des annulations
async function calculateTrendsAnnulations(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as pertes_mois_dernier,
        COUNT(*) as annulations_mois_dernier,
        COUNT(DISTINCT idclient) as clients_impactes_mois_dernier
      FROM reservation 
      WHERE statut = 'annulée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    const trends = {
      pertes: {
        value: calculatePercentageChange(currentStats.pertes_mois, lastMonth.pertes_mois_dernier),
        isPositive: currentStats.pertes_mois < lastMonth.pertes_mois_dernier // Moins de pertes = positif
      },
      annulations: {
        value: calculatePercentageChange(currentStats.annulations_mois, lastMonth.annulations_mois_dernier),
        isPositive: currentStats.annulations_mois < lastMonth.annulations_mois_dernier // Moins d'annulations = positif
      },
      clients_impactes: {
        value: calculatePercentageChange(currentStats.clients_impactes, lastMonth.clients_impactes_mois_dernier),
        isPositive: currentStats.clients_impactes < lastMonth.clients_impactes_mois_dernier // Moins de clients impactés = positif
      },
      taux_annulation: {
        value: 0, // À calculer selon votre logique métier
        isPositive: currentStats.taux_annulation < 10 // Taux d'annulation bas = positif
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