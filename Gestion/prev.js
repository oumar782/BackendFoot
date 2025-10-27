// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (remplace votre endpoint actuel)
router.get('/dashboard', async (req, res) => {
  try {
    // Récupérer les statistiques en parallèle pour plus de performance
    const [
      revenusMois,
      revenusAujourdhui,
      reservationsMois,
      reservationsAujourdhui,
      clientsActifs,
      tauxRemplissage,
      terrainsOccupes,
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
      
      // Revenus d'aujourd'hui
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_aujourdhui
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
      `),
      
      // Réservations du mois
      db.query(`
        SELECT COUNT(*) as reservations_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Réservations d'aujourd'hui
      db.query(`
        SELECT COUNT(*) as reservations_aujourdhui
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
      `),
      
      // Clients actifs cette semaine
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
      `),
      
      // Taux de remplissage moyen du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM terrain) / 30 * 8 -- Estimation: 30 jours, 8 créneaux/jour
            ), 2
          ) as taux_remplissage
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Terrains occupés actuellement
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_occupes
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heuredebut <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
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
      revenus_aujourdhui: parseFloat(revenusAujourdhui.rows[0]?.revenus_aujourdhui || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      reservations_aujourdhui: parseInt(reservationsAujourdhui.rows[0]?.reservations_aujourdhui || 0),
      clients_actifs: parseInt(clientsActifs.rows[0]?.clients_actifs || 0),
      taux_remplissage: parseFloat(tauxRemplissage.rows[0]?.taux_remplissage || 0),
      terrains_occupes_actuels: parseInt(terrainsOccupes.rows[0]?.terrains_occupes || 0),
      revenus_annee: parseFloat(revenusAnnee.rows[0]?.revenus_annee || 0)
    };

    // Calcul des trends basés sur le mois précédent
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

// 🔄 Statistiques temps réel (nouvel endpoint)
router.get('/statistiques-temps-reel', async (req, res) => {
  try {
    const [
      revenusMois,
      revenusAujourdhui,
      reservationsMois,
      reservationsAujourdhui,
      terrainsOccupes,
      terrainsActifs
    ] = await Promise.all([
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenu_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenu_aujourdhui
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
      `),
      
      db.query(`
        SELECT COUNT(*) as reservations_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      db.query(`
        SELECT COUNT(*) as reservations_aujourdhui
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
      `),
      
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_occupes_actuels
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heuredebut <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
      `),
      
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_actifs_semaine
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
      `)
    ]);

    const data = {
      revenu_mois: parseFloat(revenusMois.rows[0]?.revenu_mois || 0),
      revenu_aujourdhui: parseFloat(revenusAujourdhui.rows[0]?.revenu_aujourdhui || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      reservations_aujourdhui: parseInt(reservationsAujourdhui.rows[0]?.reservations_aujourdhui || 0),
      terrains_occupes_actuels: parseInt(terrainsOccupes.rows[0]?.terrains_occupes_actuels || 0),
      terrains_actifs_semaine: parseInt(terrainsActifs.rows[0]?.terrains_actifs_semaine || 0)
    };

    res.json({
      success: true,
      data,
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques temps réel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 💰 Revenus totaux par période
router.get('/revenus-totaux', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    
    let whereClause = '';
    switch (periode) {
      case 'jour':
        whereClause = "AND datereservation = CURRENT_DATE";
        break;
      case 'semaine':
        whereClause = "AND datereservation >= CURRENT_DATE - INTERVAL '7 days'";
        break;
      case 'mois':
        whereClause = "AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)";
        break;
      case 'annee':
        whereClause = "AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)";
        break;
    }

    const result = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenu_total,
        COUNT(*) as total_reservations,
        COUNT(DISTINCT idclient) as clients_uniques,
        ROUND(AVG(tarif), 2) as revenu_moyen
      FROM reservation 
      WHERE statut = 'confirmée'
      ${whereClause}
    `);

    res.json({
      success: true,
      data: result.rows[0],
      periode
    });

  } catch (error) {
    console.error('❌ Erreur revenus totaux:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Taux de remplissage
router.get('/taux-remplissage', async (req, res) => {
  try {
    const { type = 'mensuel' } = req.query;
    
    let query = '';
    switch (type) {
      case 'quotidien':
        query = `
          SELECT 
            datereservation as date,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM terrain) / 8
              ), 2
            ) as taux_remplissage
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY datereservation
          ORDER BY datereservation DESC
          LIMIT 30
        `;
        break;
      case 'mensuel':
      default:
        query = `
          SELECT 
            TO_CHAR(datereservation, 'YYYY-MM') as mois,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM terrain) / 30 / 8
              ), 2
            ) as taux_remplissage
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '12 months'
          GROUP BY TO_CHAR(datereservation, 'YYYY-MM')
          ORDER BY mois DESC
          LIMIT 12
        `;
    }

    const result = await db.query(query);
    
    // Calcul du taux moyen
    const tauxMoyen = result.rows.length > 0 
      ? result.rows.reduce((sum, row) => sum + parseFloat(row.taux_remplissage), 0) / result.rows.length
      : 0;

    res.json({
      success: true,
      data: result.rows,
      statistiques: {
        taux_remplissage_moyen: Math.round(tauxMoyen),
        periode_analyse: type
      }
    });

  } catch (error) {
    console.error('❌ Erreur taux remplissage:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions détaillées
router.get('/previsions/detaillees', async (req, res) => {
  try {
    const { jours = 30 } = req.query;
    
    const result = await db.query(`
      WITH reservations_futures AS (
        SELECT 
          datereservation,
          COUNT(*) as reservations_prevues,
          COALESCE(SUM(tarif), 0) as revenus_prevus
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${jours} days'
        GROUP BY datereservation
      ),
      stats_historiques AS (
        SELECT 
          ROUND(AVG(reservations_jour), 2) as reservations_moyennes,
          ROUND(AVG(revenus_jour), 2) as revenus_moyens,
          ROUND(AVG(taux_occupation), 2) as moyenne_occupation
        FROM (
          SELECT 
            datereservation,
            COUNT(*) as reservations_jour,
            COALESCE(SUM(tarif), 0) as revenus_jour,
            ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM terrain) / 8), 2) as taux_occupation
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE - INTERVAL '1 day'
          GROUP BY datereservation
        ) historique
      )
      SELECT 
        COUNT(*) as jours_avec_reservations,
        COALESCE(SUM(reservations_prevues), 0) as total_reservations,
        COALESCE(SUM(revenus_prevus), 0) as total_revenus,
        ROUND(AVG(reservations_prevues), 2) as reservations_moyennes_prevues,
        ROUND(AVG(revenus_prevus), 2) as revenus_moyens_prevus,
        sh.moyenne_occupation,
        sh.reservations_moyennes,
        sh.revenus_moyens
      FROM reservations_futures rf
      CROSS JOIN stats_historiques sh
    `);

    const stats = result.rows[0];

    res.json({
      success: true,
      statistiques: {
        jours_avec_reservations: parseInt(stats.jours_avec_reservations),
        total_reservations: parseInt(stats.total_reservations),
        total_revenus: parseFloat(stats.total_revenus),
        reservations_moyennes_prevues: parseFloat(stats.reservations_moyennes_prevues),
        revenus_moyens_prevus: parseFloat(stats.revenus_moyens_prevus),
        moyenne_occupation: parseFloat(stats.moyenne_occupation),
        reservations_moyennes_passe: parseFloat(stats.reservations_moyennes),
        revenus_moyens_passe: parseFloat(stats.revenus_moyens)
      },
      periode_jours: parseInt(jours)
    });

  } catch (error) {
    console.error('❌ Erreur prévisions détaillées:', error);
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
        value: calculatePercentageChange(currentStats.revenus_mois, lastMonth.revenus_mois_dernier),
        isPositive: currentStats.revenus_mois > lastMonth.revenus_mois_dernier
      },
      reservations: {
        value: calculatePercentageChange(currentStats.reservations_mois, lastMonth.reservations_mois_dernier),
        isPositive: currentStats.reservations_mois > lastMonth.reservations_mois_dernier
      },
      clients: {
        value: calculatePercentageChange(currentStats.clients_actifs, lastMonth.clients_mois_dernier),
        isPositive: currentStats.clients_actifs > lastMonth.clients_mois_dernier
      },
      remplissage: {
        value: currentStats.taux_remplissage > 70 ? 5 : -2,
        isPositive: currentStats.taux_remplissage > 70
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
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;