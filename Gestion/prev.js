// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    // Récupérer les statistiques en parallèle pour plus de performance
    const [
      revenusMois,
      reservationsMois,
      clientsActifs,
      tauxRemplissage,
      statsTempsReel,
      revenusAnnee
    ] = await Promise.all([
      // Revenus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Réservations du mois
      db.query(`
        SELECT COUNT(*) as reservations_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Clients actifs ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux de remplissage moyen du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(DISTINCT numeroterrain) * 30 FROM reservation WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE))
            ), 2
          ) as taux_remplissage
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as reservations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui
        FROM reservation
      `),
      
      // Revenus de l'année pour le trend
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_annee
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `)
    ]);

    const stats = {
      revenus_mois: parseFloat(revenusMois.rows[0]?.revenus_mois || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      clients_actifs: parseInt(clientsActifs.rows[0]?.clients_actifs || 0),
      taux_remplissage: parseFloat(tauxRemplissage.rows[0]?.taux_remplissage || 0),
      reservations_aujourdhui: parseInt(statsTempsReel.rows[0]?.reservations_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      revenus_annee: parseFloat(revenusAnnee.rows[0]?.revenus_annee || 0)
    };

    // Calcul des trends
    const trends = await calculateTrends(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Évolution des revenus sur 12 mois
router.get('/evolution-revenus', async (req, res) => {
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
        COALESCE(SUM(r.tarif), 0) as revenus,
        COUNT(r.numeroreservations) as reservations,
        COUNT(DISTINCT r.idclient) as clients_uniques
      FROM mois_series ms
      LEFT JOIN reservation r ON 
        EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
        AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
        AND r.statut = 'confirmée'
      GROUP BY ms.mois
      ORDER BY ms.mois ASC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur évolution revenus:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🎯 Performance des terrains
router.get('/performance-terrains', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(*) as total_reservations,
        COALESCE(SUM(tarif), 0) as revenus_generes,
        ROUND(AVG(tarif), 2) as revenu_moyen,
        COUNT(DISTINCT idclient) as clients_uniques,
        ROUND(
          (COUNT(*) * 100.0 / 
          (SELECT COUNT(*) FROM reservation WHERE statut = 'confirmée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days')
          ), 2
        ) as part_marche
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY revenus_generes DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur performance terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 👥 Statistiques clients
router.get('/statistiques-clients', async (req, res) => {
  try {
    const [
      clientsFideles,
      nouveauxClients,
      statsReservations
    ] = await Promise.all([
      // Clients les plus fidèles
      db.query(`
        SELECT 
          c.idclient,
          c.nom,
          c.prenom,
          c.email,
          COUNT(r.numeroreservations) as total_reservations,
          COALESCE(SUM(r.tarif), 0) as total_depense,
          MAX(r.datereservation) as derniere_reservation
        FROM clients c
        JOIN reservation r ON c.idclient = r.idclient
        WHERE r.statut = 'confirmée'
        GROUP BY c.idclient, c.nom, c.prenom, c.email
        ORDER BY total_reservations DESC
        LIMIT 10
      `),
      
      // Nouveaux clients du mois
      db.query(`
        SELECT 
          c.idclient,
          c.nom,
          c.prenom,
          c.email,
          c.telephone,
          c.statut,
          COUNT(r.numeroreservations) as reservations_mois
        FROM clients c
        LEFT JOIN reservation r ON c.idclient = r.idclient 
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND r.statut = 'confirmée'
        WHERE c.idclient IN (
          SELECT DISTINCT idclient 
          FROM reservation 
          WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        )
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
        ORDER BY reservations_mois DESC
      `),
      
      // Stats générales clients
      db.query(`
        SELECT 
          COUNT(DISTINCT idclient) as total_clients,
          COUNT(DISTINCT CASE WHEN statut = 'actif' THEN idclient END) as clients_actifs,
          COUNT(DISTINCT CASE WHEN statut = 'inactif' THEN idclient END) as clients_inactifs,
          ROUND(AVG(reservations_par_client), 2) as reservations_moyennes
        FROM (
          SELECT 
            idclient,
            statut,
            COUNT(*) as reservations_par_client
          FROM reservation 
          WHERE statut = 'confirmée'
          GROUP BY idclient, statut
        ) stats_clients
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_fideles: clientsFideles.rows,
        nouveaux_clients: nouveauxClients.rows,
        statistiques: statsReservations.rows[0]
      }
    });
  } catch (error) {
    console.error('❌ Erreur statistiques clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions et tendances
router.get('/previsions-tendances', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH reservations_futures AS (
        SELECT 
          datereservation,
          COUNT(*) as reservations_prevues,
          COALESCE(SUM(tarif), 0) as revenus_prevus,
          COUNT(DISTINCT numeroterrain) as terrains_occupes
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
        GROUP BY datereservation
      ),
      stats_historiques AS (
        SELECT 
          ROUND(AVG(reservations_jour), 2) as reservations_moyennes,
          ROUND(AVG(revenus_jour), 2) as revenus_moyens
        FROM (
          SELECT 
            datereservation,
            COUNT(*) as reservations_jour,
            COALESCE(SUM(tarif), 0) as revenus_jour
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE - INTERVAL '1 day'
          GROUP BY datereservation
        ) historique
      )
      SELECT 
        rf.datereservation,
        TO_CHAR(rf.datereservation, 'DD/MM') as date_formattee,
        rf.reservations_prevues,
        rf.revenus_prevus,
        rf.terrains_occupes,
        sh.reservations_moyennes,
        sh.revenus_moyens,
        CASE 
          WHEN rf.reservations_prevues > sh.reservations_moyennes THEN 'supérieur'
          WHEN rf.reservations_prevues < sh.reservations_moyennes THEN 'inférieur'
          ELSE 'identique'
        END as tendance_reservations,
        CASE 
          WHEN rf.revenus_prevus > sh.revenus_moyens THEN 'supérieur'
          WHEN rf.revenus_prevus < sh.revenus_moyens THEN 'inférieur'
          ELSE 'identique'
        END as tendance_revenus
      FROM reservations_futures rf
      CROSS JOIN stats_historiques sh
      ORDER BY rf.datereservation ASC
    `);

    // Calcul des totaux et moyennes
    const stats = {
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.reservations_prevues), 0),
      revenus_total: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus), 0),
      jours_avec_reservations: result.rows.length,
      revenu_moyen_par_jour: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus), 0) / result.rows.length),
      jours_superieurs_moyenne: result.rows.filter(row => row.tendance_revenus === 'supérieur').length
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
      periode_analyse: parseInt(periode)
    });
  } catch (error) {
    console.error('❌ Erreur prévisions:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends
async function calculateTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenus_mois_dernier,
        COUNT(*) as reservations_mois_dernier
      FROM reservation 
      WHERE statut = 'confirmée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    const trends = {
      revenus: {
        value: calculatePercentageChange(currentStats.revenus_mois, lastMonth.revenus_mois_dernier),
        isPositive: currentStats.revenus_mois > lastMonth.revenus_mois_dernier
      },
      reservations: {
        value: calculatePercentageChange(currentStats.reservations_mois, lastMonth.reservations_mois_dernier),
        isPositive: currentStats.reservations_mois > lastMonth.reservations_mois_dernier
      },
      clients: {
        value: 5, // Valeur par défaut, à adapter selon vos besoins
        isPositive: true
      },
      remplissage: {
        value: 2, // Valeur par défaut
        isPositive: currentStats.taux_remplissage > 70
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends:', error);
    return {};
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return 100;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;