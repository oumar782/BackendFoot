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

    // Calcul du taux de remplissage (nécessite la table terrain)
    const totalTerrainsResult = await db.query('SELECT COUNT(*) as total FROM terrain');
    const totalTerrains = parseInt(totalTerrainsResult.rows[0]?.total || 1); // éviter division par 0
    const joursDansMois = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const capaciteTotale = totalTerrains * joursDansMois;

    const reservationsRemplissage = await db.query(`
      SELECT COUNT(*) as occupees
      FROM reservation 
      WHERE statut = 'confirmée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
    `);
    const occupees = parseInt(reservationsRemplissage.rows[0]?.occupees || 0);
    const taux_remplissage = capaciteTotale > 0 ? parseFloat(((occupees * 100.0) / capaciteTotale).toFixed(2)) : 0;

    const stats = {
      revenus_mois: parseFloat(revenusMois.rows[0]?.revenus_mois || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      clients_actifs: parseInt(clientsActifs.rows[0]?.clients_actifs || 0),
      taux_remplissage,
      reservations_aujourdhui: parseInt(statsTempsReel.rows[0]?.reservations_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      revenus_annee: parseFloat(revenusAnnee.rows[0]?.revenus_annee || 0)
    };

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
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months',
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
        DATE_TRUNC('month', r.datereservation) = DATE_TRUNC('month', ms.mois)
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

// 🎯 Performance des terrains (30 derniers jours)
router.get('/performance-terrains', async (req, res) => {
  try {
    const totalReservations30Jours = await db.query(`
      SELECT COUNT(*) as total
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
    `);
    const totalGlobal = parseInt(totalReservations30Jours.rows[0]?.total || 1);

    const result = await db.query(`
      SELECT 
        t.numeroterrain,
        t.nomterrain,
        t.typeterrain,
        COUNT(r.numeroreservations) as total_reservations,
        COALESCE(SUM(r.tarif), 0) as revenus_generes,
        ROUND(AVG(r.tarif), 2) as revenu_moyen,
        COUNT(DISTINCT r.idclient) as clients_uniques
      FROM terrain t
      LEFT JOIN reservation r ON t.numeroterrain = r.numeroterrain
        AND r.statut = 'confirmée'
        AND r.datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY t.numeroterrain, t.nomterrain, t.typeterrain
      ORDER BY revenus_generes DESC
    `);

    const data = result.rows.map(row => ({
      ...row,
      part_marche: totalGlobal > 0 ? parseFloat(((row.total_reservations * 100.0) / totalGlobal).toFixed(2)) : 0
    }));

    res.json({
      success: true,
      data
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
      // Clients les plus fidèles (top 10)
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
      
      // VRAIS nouveaux clients du mois (n'ont jamais réservé avant ce mois)
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
          AND NOT EXISTS (
            SELECT 1 FROM reservation r2 
            WHERE r2.idclient = c.idclient 
              AND r2.statut = 'confirmée'
              AND (
                EXTRACT(YEAR FROM r2.datereservation) < EXTRACT(YEAR FROM CURRENT_DATE)
                OR (
                  EXTRACT(YEAR FROM r2.datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
                  AND EXTRACT(MONTH FROM r2.datereservation) < EXTRACT(MONTH FROM CURRENT_DATE)
                )
              )
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
            c.idclient,
            c.statut,
            COUNT(r.numeroreservations) as reservations_par_client
          FROM clients c
          JOIN reservation r ON c.idclient = r.idclient
          WHERE r.statut = 'confirmée'
          GROUP BY c.idclient, c.statut
        ) stats_clients
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_fideles: clientsFideles.rows,
        nouveaux_clients: nouveauxClients.rows,
        statistiques: statsReservations.rows[0] || {
          total_clients: 0,
          clients_actifs: 0,
          clients_inactifs: 0,
          reservations_moyennes: 0
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

// 🔮 Prévisions et tendances
router.get('/previsions-tendances', async (req, res) => {
  try {
    let periode = parseInt(req.query.periode) || 30;
    if (periode < 1 || periode > 90) periode = 30; // sécurité

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

    const stats = {
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.reservations_prevues || 0), 0),
      revenus_total: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus || 0), 0),
      jours_avec_reservations: result.rows.length,
      revenu_moyen_par_jour: result.rows.length > 0 
        ? Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_prevus || 0), 0) / result.rows.length)
        : 0,
      jours_superieurs_moyenne: result.rows.filter(row => row.tendance_revenus === 'supérieur').length
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
      periode_analyse: periode
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

// 🔁 Fonction utilitaire pour calculer les trends (réels)
async function calculateTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenus_mois_dernier,
        COUNT(*) as reservations_mois_dernier,
        COUNT(DISTINCT idclient) as clients_mois_dernier
      FROM reservation 
      WHERE statut = 'confirmée'
      AND datereservation >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
      AND datereservation < DATE_TRUNC('month', CURRENT_DATE)
    `);

    const lastMonth = lastMonthStats.rows[0] || {
      revenus_mois_dernier: 0,
      reservations_mois_dernier: 0,
      clients_mois_dernier: 0
    };

    // Taux de remplissage du mois dernier
    const totalTerrainsResult = await db.query('SELECT COUNT(*) as total FROM terrain');
    const totalTerrains = parseInt(totalTerrainsResult.rows[0]?.total || 1);
    const joursMoisDernier = new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate();
    const capaciteMoisDernier = totalTerrains * joursMoisDernier;

    const occupeesDernier = await db.query(`
      SELECT COUNT(*) as occupees
      FROM reservation 
      WHERE statut = 'confirmée'
      AND datereservation >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
      AND datereservation < DATE_TRUNC('month', CURRENT_DATE)
    `);
    const occupees = parseInt(occupeesDernier.rows[0]?.occupees || 0);
    const tauxRemplissageDernier = capaciteMoisDernier > 0 ? (occupees * 100.0) / capaciteMoisDernier : 0;

    return {
      revenus: {
        value: calculatePercentageChange(currentStats.revenus_mois, parseFloat(lastMonth.revenus_mois_dernier)),
        isPositive: currentStats.revenus_mois > parseFloat(lastMonth.revenus_mois_dernier)
      },
      reservations: {
        value: calculatePercentageChange(currentStats.reservations_mois, parseInt(lastMonth.reservations_mois_dernier)),
        isPositive: currentStats.reservations_mois > parseInt(lastMonth.reservations_mois_dernier)
      },
      clients: {
        value: calculatePercentageChange(currentStats.clients_actifs, parseInt(lastMonth.clients_mois_dernier)),
        isPositive: currentStats.clients_actifs > parseInt(lastMonth.clients_mois_dernier)
      },
      remplissage: {
        value: calculatePercentageChange(currentStats.taux_remplissage, tauxRemplissageDernier),
        isPositive: currentStats.taux_remplissage > tauxRemplissageDernier
      }
    };
  } catch (error) {
    console.error('Erreur calcul trends:', error);
    return {};
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;