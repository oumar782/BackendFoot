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
      
      // Clients actifs ce mois-ci (qui ont fait au moins une réservation confirmée)
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux de remplissage réel : créneaux réservés / créneaux disponibles
      db.query(`
        WITH jours_mois AS (
          SELECT COUNT(*) as nb_jours
          FROM generate_series(
            DATE_TRUNC('month', CURRENT_DATE),
            DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day',
            '1 day'::interval
          ) as jour
          WHERE EXTRACT(DAY FROM jour) <= EXTRACT(DAY FROM CURRENT_DATE)
        ),
        total_terrains AS (
          SELECT COUNT(DISTINCT numeroterrain) as nb_terrains
          FROM reservation
        )
        SELECT 
          CASE 
            WHEN (SELECT nb_jours * nb_terrains FROM jours_mois, total_terrains) = 0 THEN 0
            ELSE ROUND(
              (COUNT(*) * 100.0 / (SELECT nb_jours * nb_terrains FROM jours_mois, total_terrains)), 
              2
            )
          END as taux_remplissage
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as reservations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui
        FROM reservation
      `),
      
      // Revenus de l'année
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

// 📈 Évolution des revenus sur 12 mois
router.get('/evolution-revenus', async (req, res) => {
  try {
    const result = await db.query(`
      WITH mois_series AS (
        SELECT generate_series(
          DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months'),
          DATE_TRUNC('month', CURRENT_DATE),
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
        DATE_TRUNC('month', r.datereservation) = ms.mois
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
      WITH total_reservations AS (
        SELECT COUNT(*) as total
        FROM reservation 
        WHERE statut = 'confirmée' 
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      )
      SELECT 
        r.numeroterrain,
        r.nomterrain,
        r.typeterrain,
        COUNT(*) as total_reservations,
        COALESCE(SUM(r.tarif), 0) as revenus_generes,
        ROUND(AVG(r.tarif), 2) as revenu_moyen,
        COUNT(DISTINCT r.idclient) as clients_uniques,
        CASE 
          WHEN (SELECT total FROM total_reservations) = 0 THEN 0
          ELSE ROUND((COUNT(*) * 100.0 / (SELECT total FROM total_reservations)), 2)
        END as part_marche
      FROM reservation r
      WHERE r.statut = 'confirmée'
        AND r.datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY r.numeroterrain, r.nomterrain, r.typeterrain
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
      // Clients les plus fidèles (basé sur les réservations confirmées)
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
        ORDER BY total_reservations DESC, total_depense DESC
        LIMIT 10
      `),
      
      // Nouveaux clients du mois (première réservation ce mois-ci)
      db.query(`
        SELECT 
          c.idclient,
          c.nom,
          c.prenom,
          c.email,
          c.telephone,
          c.statut,
          COUNT(r.numeroreservations) as reservations_mois,
          MIN(r.datereservation) as premiere_reservation
        FROM clients c
        JOIN reservation r ON c.idclient = r.idclient
        WHERE r.statut = 'confirmée'
        AND NOT EXISTS (
          SELECT 1 FROM reservation r2 
          WHERE r2.idclient = c.idclient 
          AND r2.statut = 'confirmée'
          AND r2.datereservation < DATE_TRUNC('month', CURRENT_DATE)
        )
        AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
        ORDER BY reservations_mois DESC
      `),
      
      // Stats générales clients réelles
      db.query(`
        SELECT 
          COUNT(DISTINCT c.idclient) as total_clients,
          COUNT(DISTINCT CASE WHEN c.statut = 'actif' THEN c.idclient END) as clients_actifs,
          COUNT(DISTINCT CASE WHEN c.statut = 'inactif' THEN c.idclient END) as clients_inactifs,
          COALESCE(ROUND(AVG(res_count.nb_reservations), 2), 0) as reservations_moyennes
        FROM clients c
        LEFT JOIN (
          SELECT idclient, COUNT(*) as nb_reservations
          FROM reservation 
          WHERE statut = 'confirmée'
          GROUP BY idclient
        ) res_count ON c.idclient = res_count.idclient
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
    const periodeInt = parseInt(periode);
    
    // Validation de la période
    if (isNaN(periodeInt) || periodeInt < 1 || periodeInt > 365) {
      return res.status(400).json({
        success: false,
        message: 'Période invalide (doit être entre 1 et 365 jours)'
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
          AND datereservation > CURRENT_DATE
          AND datereservation <= CURRENT_DATE + $1::integer
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
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
            AND datereservation < CURRENT_DATE
          GROUP BY datereservation
        ) historique
      )
      SELECT 
        rf.datereservation,
        TO_CHAR(rf.datereservation, 'DD/MM/YYYY') as date_formattee,
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
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.reservations_prevues || 0), 0),
      revenus_total: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus || 0), 0),
      jours_avec_reservations: result.rows.length,
      revenu_moyen_par_jour: result.rows.length > 0 
        ? Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus || 0), 0) / result.rows.length)
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
      periode_analyse: periodeInt,
      message: result.rows.length === 0 ? 'Aucune réservation prévue pour cette période' : null
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
    // Statistiques du mois dernier
    const [lastMonthStats, lastMonthClients, lastMonthRemplissage] = await Promise.all([
      db.query(`
        SELECT 
          COALESCE(SUM(tarif), 0) as revenus_mois_dernier,
          COUNT(*) as reservations_mois_dernier
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
      `),
      
      // Clients actifs du mois dernier
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs_mois_dernier
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
      `),
      
      // Taux de remplissage du mois dernier
      db.query(`
        WITH jours_mois_dernier AS (
          SELECT COUNT(*) as nb_jours
          FROM generate_series(
            DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month'),
            DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day',
            '1 day'::interval
          )
        ),
        total_terrains AS (
          SELECT COUNT(DISTINCT numeroterrain) as nb_terrains
          FROM reservation
        )
        SELECT 
          CASE 
            WHEN (SELECT nb_jours * nb_terrains FROM jours_mois_dernier, total_terrains) = 0 THEN 0
            ELSE ROUND(
              (COUNT(*) * 100.0 / (SELECT nb_jours * nb_terrains FROM jours_mois_dernier, total_terrains)), 
              2
            )
          END as taux_remplissage_mois_dernier
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
      `)
    ]);

    const lastMonth = lastMonthStats.rows[0];
    const lastMonthClientsData = lastMonthClients.rows[0];
    const lastMonthRemplissageData = lastMonthRemplissage.rows[0];
    
    const trends = {
      revenus: {
        value: calculatePercentageChange(
          currentStats.revenus_mois, 
          parseFloat(lastMonth.revenus_mois_dernier || 0)
        ),
        isPositive: currentStats.revenus_mois >= parseFloat(lastMonth.revenus_mois_dernier || 0)
      },
      reservations: {
        value: calculatePercentageChange(
          currentStats.reservations_mois, 
          parseInt(lastMonth.reservations_mois_dernier || 0)
        ),
        isPositive: currentStats.reservations_mois >= parseInt(lastMonth.reservations_mois_dernier || 0)
      },
      clients: {
        value: calculatePercentageChange(
          currentStats.clients_actifs, 
          parseInt(lastMonthClientsData.clients_actifs_mois_dernier || 0)
        ),
        isPositive: currentStats.clients_actifs >= parseInt(lastMonthClientsData.clients_actifs_mois_dernier || 0)
      },
      remplissage: {
        value: calculatePercentageChange(
          currentStats.taux_remplissage,
          parseFloat(lastMonthRemplissageData.taux_remplissage_mois_dernier || 0)
        ),
        isPositive: currentStats.taux_remplissage >= parseFloat(lastMonthRemplissageData.taux_remplissage_mois_dernier || 0)
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends:', error);
    // En cas d'erreur, retourner des valeurs neutres plutôt que fake
    return {
      revenus: { value: 0, isPositive: true },
      reservations: { value: 0, isPositive: true },
      clients: { value: 0, isPositive: true },
      remplissage: { value: 0, isPositive: true }
    };
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;