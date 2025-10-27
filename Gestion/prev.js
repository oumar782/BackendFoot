import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [
      revenusMois,
      reservationsMois,
      clientsActifs,
      tauxRemplissage,
      statsTempsReel,
      revenusAnnee,
      totalTerrains
    ] = await Promise.all([
      // Revenus du mois actuel (confirmées uniquement)
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Réservations confirmées du mois
      db.query(`
        SELECT COUNT(*) as reservations_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Clients actifs ce mois (avec réservations confirmées)
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux de remplissage réel du mois
      db.query(`
        SELECT 
          CASE 
            WHEN total_slots > 0 THEN ROUND((reservations_confirmees * 100.0 / total_slots), 2)
            ELSE 0
          END as taux_remplissage
        FROM (
          SELECT 
            COUNT(*) FILTER (WHERE statut = 'confirmée') as reservations_confirmees,
            COUNT(DISTINCT numeroterrain) * EXTRACT(DAY FROM DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day') as total_slots
          FROM reservation 
          WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
        ) calc
      `),
      
      // Statistiques temps réel (confirmées uniquement)
      db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE datereservation = CURRENT_DATE AND statut = 'confirmée') as confirmes_aujourdhui,
          COUNT(*) FILTER (WHERE datereservation = CURRENT_DATE AND statut = 'en attente') as en_attente_aujourdhui,
          COUNT(*) FILTER (WHERE datereservation = CURRENT_DATE AND statut = 'annulée') as annules_aujourdhui
        FROM reservation
        WHERE datereservation = CURRENT_DATE
      `),
      
      // Revenus de l'année (confirmées uniquement)
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_annee
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Nombre total de terrains
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as total_terrains
        FROM reservation
      `)
    ]);

    const stats = {
      revenus_mois: parseFloat(revenusMois.rows[0]?.revenus_mois || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      clients_actifs: parseInt(clientsActifs.rows[0]?.clients_actifs || 0),
      taux_remplissage: parseFloat(tauxRemplissage.rows[0]?.taux_remplissage || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      en_attente_aujourdhui: parseInt(statsTempsReel.rows[0]?.en_attente_aujourdhui || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      revenus_annee: parseFloat(revenusAnnee.rows[0]?.revenus_annee || 0),
      total_terrains: parseInt(totalTerrains.rows[0]?.total_terrains || 0)
    };

    // Calcul des trends RÉELS
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

// 📈 Évolution des revenus sur 12 mois (confirmées uniquement)
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

// 🎯 Performance des terrains (confirmées uniquement)
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
          (COUNT(*) * 100.0 / NULLIF(
            (SELECT COUNT(*) FROM reservation WHERE statut = 'confirmée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days'), 
            0)
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

// 👥 Statistiques clients (confirmées uniquement)
router.get('/statistiques-clients', async (req, res) => {
  try {
    const [
      clientsFideles,
      nouveauxClients,
      statsReservations
    ] = await Promise.all([
      // Clients les plus fidèles (réservations confirmées)
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
        HAVING COUNT(r.numeroreservations) > 0
        ORDER BY total_reservations DESC
        LIMIT 10
      `),
      
      // Nouveaux clients du mois (avec réservations confirmées)
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
        INNER JOIN reservation r ON c.idclient = r.idclient 
        WHERE r.statut = 'confirmée'
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
        ORDER BY reservations_mois DESC
        LIMIT 20
      `),
      
      // Stats générales clients (confirmées uniquement)
      db.query(`
        SELECT 
          COUNT(DISTINCT c.idclient) as total_clients_actifs,
          COUNT(DISTINCT CASE WHEN c.statut = 'actif' THEN c.idclient END) as clients_statut_actif,
          COUNT(DISTINCT CASE WHEN c.statut = 'inactif' THEN c.idclient END) as clients_statut_inactif,
          COALESCE(ROUND(AVG(stats.reservations_par_client), 2), 0) as reservations_moyennes,
          COALESCE(ROUND(AVG(stats.depense_par_client), 2), 0) as depense_moyenne
        FROM clients c
        LEFT JOIN (
          SELECT 
            idclient,
            COUNT(*) as reservations_par_client,
            SUM(tarif) as depense_par_client
          FROM reservation 
          WHERE statut = 'confirmée'
          GROUP BY idclient
        ) stats ON c.idclient = stats.idclient
        WHERE stats.idclient IS NOT NULL
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_fideles: clientsFideles.rows,
        nouveaux_clients: nouveauxClients.rows,
        statistiques: statsReservations.rows[0] || {
          total_clients_actifs: 0,
          clients_statut_actif: 0,
          clients_statut_inactif: 0,
          reservations_moyennes: 0,
          depense_moyenne: 0
        }
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

// 🔮 Prévisions et tendances (confirmées uniquement)
router.get('/previsions-tendances', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    const periodeInt = parseInt(periode);
    
    if (isNaN(periodeInt) || periodeInt < 1 || periodeInt > 365) {
      return res.status(400).json({
        success: false,
        message: 'Période invalide (1-365 jours)'
      });
    }
    
    const result = await db.query(`
      WITH reservations_futures AS (
        SELECT 
          datereservation,
          COUNT(*) as reservations_prevues,
          COALESCE(SUM(tarif), 0) as revenus_prevus,
          COUNT(DISTINCT numeroterrain) as terrains_occupes
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::integer
        GROUP BY datereservation
      ),
      stats_historiques AS (
        SELECT 
          COALESCE(ROUND(AVG(reservations_jour), 2), 0) as reservations_moyennes,
          COALESCE(ROUND(AVG(revenus_jour), 2), 0) as revenus_moyens
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
    `, [periodeInt]);

    // Calcul des totaux et moyennes RÉELS
    const stats = result.rows.length > 0 ? {
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.reservations_prevues), 0),
      revenus_total: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus), 0),
      jours_avec_reservations: result.rows.length,
      revenu_moyen_par_jour: result.rows.length > 0 
        ? Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus), 0) / result.rows.length)
        : 0,
      jours_superieurs_moyenne: result.rows.filter(row => row.tendance_revenus === 'supérieur').length
    } : {
      reservations_total: 0,
      revenus_total: 0,
      jours_avec_reservations: 0,
      revenu_moyen_par_jour: 0,
      jours_superieurs_moyenne: 0
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
      periode_analyse: periodeInt
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

// Fonction utilitaire pour calculer les trends RÉELS
async function calculateTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenus_mois_dernier,
        COUNT(*) as reservations_mois_dernier,
        COUNT(DISTINCT idclient) as clients_mois_dernier
      FROM reservation 
      WHERE statut = 'confirmée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    const trends = {
      revenus: {
        value: calculatePercentageChange(
          currentStats.revenus_mois, 
          parseFloat(lastMonth.revenus_mois_dernier)
        ),
        isPositive: currentStats.revenus_mois >= parseFloat(lastMonth.revenus_mois_dernier)
      },
      reservations: {
        value: calculatePercentageChange(
          currentStats.reservations_mois, 
          parseInt(lastMonth.reservations_mois_dernier)
        ),
        isPositive: currentStats.reservations_mois >= parseInt(lastMonth.reservations_mois_dernier)
      },
      clients: {
        value: calculatePercentageChange(
          currentStats.clients_actifs, 
          parseInt(lastMonth.clients_mois_dernier)
        ),
        isPositive: currentStats.clients_actifs >= parseInt(lastMonth.clients_mois_dernier)
      },
      remplissage: {
        value: Math.abs(currentStats.taux_remplissage),
        isPositive: currentStats.taux_remplissage > 0
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends:', error);
    return {
      revenus: { value: 0, isPositive: false },
      reservations: { value: 0, isPositive: false },
      clients: { value: 0, isPositive: false },
      remplissage: { value: 0, isPositive: false }
    };
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
}

export default router;