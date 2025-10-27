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
      revenusAnnee,
      lastMonthStats
    ] = await Promise.all([
      // Revenus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE)
      `),
      
      // Réservations du mois
      db.query(`
        SELECT COUNT(*) as reservations_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE)
      `),
      
      // Clients actifs ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE)
      `),
      
      // Statistiques temps réel
      db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE datereservation = CURRENT_DATE) as reservations_aujourdhui,
          COUNT(*) FILTER (WHERE datereservation = CURRENT_DATE AND statut = 'confirmée') as confirmes_aujourdhui,
          COUNT(*) FILTER (WHERE datereservation = CURRENT_DATE AND statut = 'annulée') as annules_aujourdhui
        FROM reservation
      `),
      
      // Revenus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_annee
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),

      // Stats du mois dernier (pour trends)
      db.query(`
        SELECT 
          COALESCE(SUM(tarif), 0) as revenus_mois_dernier,
          COUNT(*) as reservations_mois_dernier
        FROM reservation 
        WHERE statut = 'confirmée'
        AND DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
      `)
    ]);

    const current = {
      revenus_mois: parseFloat(revenusMois.rows[0]?.revenus_mois || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      clients_actifs: parseInt(clientsActifs.rows[0]?.clients_actifs || 0),
      reservations_aujourdhui: parseInt(statsTempsReel.rows[0]?.reservations_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      revenus_annee: parseFloat(revenusAnnee.rows[0]?.revenus_annee || 0)
    };

    const last = lastMonthStats.rows[0] || { revenus_mois_dernier: 0, reservations_mois_dernier: 0 };

    // Calcul des tendances réelles (sans fake)
    const calculateChange = (current, previous) => {
      if (previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / previous) * 100);
    };

    const trends = {
      revenus: {
        value: calculateChange(current.revenus_mois, parseFloat(last.revenus_mois_dernier || 0)),
        isPositive: current.revenus_mois > parseFloat(last.revenus_mois_dernier || 0)
      },
      reservations: {
        value: calculateChange(current.reservations_mois, parseInt(last.reservations_mois_dernier || 0)),
        isPositive: current.reservations_mois > parseInt(last.reservations_mois_dernier || 0)
      }
      // Pas de fake pour clients/remplissage → on les omet
    };

    res.json({
      success: true,
      data: {
        ...current,
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

// 📈 Évolution des revenus sur 12 mois → ✅ OK, inchangé
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

// 🎯 Performance des terrains → ✅ OK (mais sans part de marché si pas fiable)
router.get('/performance-terrains', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        -- nomterrain et typeterrain ne sont pas dans reservation → à supprimer ou joindre
        COUNT(*) as total_reservations,
        COALESCE(SUM(tarif), 0) as revenus_generes,
        ROUND(AVG(tarif), 2) as revenu_moyen,
        COUNT(DISTINCT idclient) as clients_uniques
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY numeroterrain
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

// 👥 Statistiques clients → CORRIGÉ pour nouveaux clients
router.get('/statistiques-clients', async (req, res) => {
  try {
    const [
      clientsFideles,
      nouveauxClients,
      statsReservations
    ] = await Promise.all([
      // Clients fidèles
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
      
      // VRAIS nouveaux clients du mois : première réservation ce mois-ci
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
          AND DATE_TRUNC('month', r.datereservation) = DATE_TRUNC('month', CURRENT_DATE)
          AND NOT EXISTS (
            SELECT 1 FROM reservation r2 
            WHERE r2.idclient = c.idclient 
              AND r2.statut = 'confirmée'
              AND r2.datereservation < DATE_TRUNC('month', CURRENT_DATE)
          )
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
        ORDER BY reservations_mois DESC
      `),
      
      // Stats générales
      db.query(`
        SELECT 
          COUNT(DISTINCT idclient) as total_clients,
          COUNT(DISTINCT CASE WHEN c.statut = 'actif' THEN c.idclient END) as clients_actifs,
          COUNT(DISTINCT CASE WHEN c.statut = 'inactif' THEN c.idclient END) as clients_inactifs,
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
        JOIN clients c ON stats_clients.idclient = c.idclient
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_fideles: clientsFideles.rows,
        nouveaux_clients: nouveauxClients.rows,
        statistiques: statsReservations.rows[0] || {}
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

// 🔮 Prévisions → ✅ OK, mais attention à l'injection SQL
router.get('/previsions-tendances', async (req, res) => {
  try {
    const periode = parseInt(req.query.periode) || 30;
    if (periode < 1 || periode > 90) {
      return res.status(400).json({ success: false, message: 'Période doit être entre 1 et 90 jours' });
    }

    // Utiliser une variable bindée pour éviter l'injection (mais INTERVAL ne supporte pas les params)
    // Donc on valide fortement periode comme ci-dessus
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

export default router;