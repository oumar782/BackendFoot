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
      statsTempsReel,
      revenusAnnee
    ] = await Promise.all([
      // Revenus du mois actuel (uniquement réservations confirmées)
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
      
      // Clients actifs ce mois-ci (ayant au moins une réservation confirmée)
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel (uniquement données existantes)
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as reservations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui
        FROM reservation
        WHERE datereservation = CURRENT_DATE
      `),
      
      // Revenus de l'année (uniquement réservations confirmées)
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_annee
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `)
    ]);

    // Calcul du taux de remplissage basé sur les données réelles
    const tauxRemplissage = await db.query(`
      WITH terrains_total AS (
        SELECT COUNT(DISTINCT numeroterrain) as total_terrains
        FROM terrain
        WHERE statut = 'actif'
      ),
      reservations_mois AS (
        SELECT COUNT(DISTINCT numeroterrain) as terrains_occupes
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      )
      SELECT 
        CASE 
          WHEN tt.total_terrains > 0 THEN 
            ROUND((rm.terrains_occupes * 100.0 / tt.total_terrains), 2)
          ELSE 0 
        END as taux_remplissage
      FROM terrains_total tt, reservations_mois rm
    `);

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

    // Calcul des trends basés sur les données réelles du mois précédent
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
      data: result.rows.map(row => ({
        ...row,
        revenus: parseFloat(row.revenus),
        reservations: parseInt(row.reservations),
        clients_uniques: parseInt(row.clients_uniques)
      }))
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
        t.numeroterrain,
        t.nomterrain,
        t.typeterrain,
        COUNT(r.numeroreservations) as total_reservations,
        COALESCE(SUM(r.tarif), 0) as revenus_generes,
        CASE 
          WHEN COUNT(r.numeroreservations) > 0 THEN ROUND(COALESCE(SUM(r.tarif), 0) / COUNT(r.numeroreservations), 2)
          ELSE 0 
        END as revenu_moyen,
        COUNT(DISTINCT r.idclient) as clients_uniques
      FROM terrain t
      LEFT JOIN reservation r ON t.numeroterrain = r.numeroterrain 
        AND r.statut = 'confirmée'
        AND r.datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY t.numeroterrain, t.nomterrain, t.typeterrain
      ORDER BY revenus_generes DESC
    `);

    // Calcul de la part de marché basée sur les revenus réels
    const totalRevenus = result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_generes), 0);

    const dataAvecPartMarche = result.rows.map(row => {
      const revenus = parseFloat(row.revenus_generes);
      const partMarche = totalRevenus > 0 ? Math.round((revenus / totalRevenus) * 100 * 100) / 100 : 0;
      
      return {
        ...row,
        total_reservations: parseInt(row.total_reservations),
        revenus_generes: revenus,
        revenu_moyen: parseFloat(row.revenu_moyen),
        clients_uniques: parseInt(row.clients_uniques),
        part_marche: partMarche
      };
    });

    res.json({
      success: true,
      data: dataAvecPartMarche
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
      // Clients les plus fidèles (avec réservations confirmées)
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
      
      // Nouveaux clients du mois (ayant fait au moins une réservation confirmée)
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
        JOIN reservation r ON c.idclient = r.idclient 
        WHERE r.statut = 'confirmée'
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
        ORDER BY reservations_mois DESC
      `),
      
      // Stats générales clients (basées sur les réservations confirmées)
      db.query(`
        SELECT 
          COUNT(DISTINCT idclient) as total_clients,
          ROUND(AVG(reservations_par_client), 2) as reservations_moyennes,
          MAX(reservations_par_client) as reservations_max,
          MIN(reservations_par_client) as reservations_min
        FROM (
          SELECT 
            idclient,
            COUNT(*) as reservations_par_client
          FROM reservation 
          WHERE statut = 'confirmée'
          GROUP BY idclient
        ) stats_clients
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_fideles: clientsFideles.rows.map(row => ({
          ...row,
          total_reservations: parseInt(row.total_reservations),
          total_depense: parseFloat(row.total_depense)
        })),
        nouveaux_clients: nouveauxClients.rows.map(row => ({
          ...row,
          reservations_mois: parseInt(row.reservations_mois)
        })),
        statistiques: statsReservations.rows[0] ? {
          total_clients: parseInt(statsReservations.rows[0].total_clients),
          reservations_moyennes: parseFloat(statsReservations.rows[0].reservations_moyennes),
          reservations_max: parseInt(statsReservations.rows[0].reservations_max),
          reservations_min: parseInt(statsReservations.rows[0].reservations_min)
        } : {
          total_clients: 0,
          reservations_moyennes: 0,
          reservations_max: 0,
          reservations_min: 0
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

// 🔮 Prévisions et tendances (basées sur les réservations confirmées futures)
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
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '1 day'
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

    // Calcul des totaux et moyennes basés sur les données réelles
    const rows = result.rows;
    const stats = {
      reservations_total: rows.reduce((sum, row) => sum + parseInt(row.reservations_prevues || 0), 0),
      revenus_total: rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus || 0), 0),
      jours_avec_reservations: rows.length,
      revenu_moyen_par_jour: rows.length > 0 ? 
        Math.round(rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus || 0), 0) / rows.length) : 0,
      jours_superieurs_moyenne: rows.filter(row => row.tendance_revenus === 'supérieur').length
    };

    res.json({
      success: true,
      data: rows.map(row => ({
        ...row,
        reservations_prevues: parseInt(row.reservations_prevues || 0),
        revenus_prevus: parseFloat(row.revenus_prevus || 0),
        terrains_occupes: parseInt(row.terrains_occupes || 0),
        reservations_moyennes: parseFloat(row.reservations_moyennes || 0),
        revenus_moyens: parseFloat(row.revenus_moyens || 0)
      })),
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

// Fonction utilitaire pour calculer les trends basés sur les données réelles
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
    
    // Calcul du taux de remplissage du mois précédent
    const tauxRemplissageLastMonth = await db.query(`
      WITH terrains_total AS (
        SELECT COUNT(DISTINCT numeroterrain) as total_terrains
        FROM terrain
        WHERE statut = 'actif'
      ),
      reservations_mois_dernier AS (
        SELECT COUNT(DISTINCT numeroterrain) as terrains_occupes
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
      )
      SELECT 
        CASE 
          WHEN tt.total_terrains > 0 THEN 
            ROUND((rm.terrains_occupes * 100.0 / tt.total_terrains), 2)
          ELSE 0 
        END as taux_remplissage_mois_dernier
      FROM terrains_total tt, reservations_mois_dernier rm
    `);

    const tauxRemplissageLastMonthValue = parseFloat(tauxRemplissageLastMonth.rows[0]?.taux_remplissage_mois_dernier || 0);

    const trends = {
      revenus: {
        value: calculatePercentageChange(currentStats.revenus_mois, parseFloat(lastMonth.revenus_mois_dernier || 0)),
        isPositive: currentStats.revenus_mois > parseFloat(lastMonth.revenus_mois_dernier || 0)
      },
      reservations: {
        value: calculatePercentageChange(currentStats.reservations_mois, parseInt(lastMonth.reservations_mois_dernier || 0)),
        isPositive: currentStats.reservations_mois > parseInt(lastMonth.reservations_mois_dernier || 0)
      },
      clients: {
        value: calculatePercentageChange(currentStats.clients_actifs, parseInt(lastMonth.clients_mois_dernier || 0)),
        isPositive: currentStats.clients_actifs > parseInt(lastMonth.clients_mois_dernier || 0)
      },
      remplissage: {
        value: calculatePercentageChange(currentStats.taux_remplissage, tauxRemplissageLastMonthValue),
        isPositive: currentStats.taux_remplissage > tauxRemplissageLastMonthValue
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends:', error);
    // Retourne des trends neutres en cas d'erreur
    return {
      revenus: { value: 0, isPositive: true },
      reservations: { value: 0, isPositive: true },
      clients: { value: 0, isPositive: true },
      remplissage: { value: 0, isPositive: true }
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