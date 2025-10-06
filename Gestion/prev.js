// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'month' } = req.query;

    // Déterminer l'intervalle en fonction de la période
    let intervalCondition = '';
    let dateTrunc = 'month';
    
    switch(periode) {
      case 'day':
        intervalCondition = `AND datereservation >= CURRENT_DATE`;
        dateTrunc = 'day';
        break;
      case 'week':
        intervalCondition = `AND datereservation >= DATE_TRUNC('week', CURRENT_DATE)`;
        dateTrunc = 'week';
        break;
      case 'month':
      default:
        intervalCondition = `AND datereservation >= DATE_TRUNC('month', CURRENT_DATE)`;
        dateTrunc = 'month';
    }

    // Requêtes parallèles pour meilleures performances
    const [
      revenusResult,
      reservationsResult,
      clientsResult,
      terrainsResult,
      tempsReelResult,
      tendancesResult
    ] = await Promise.all([
      // Revenus totaux
      db.query(`
        SELECT 
          COALESCE(SUM(tarif), 0) as revenu_total,
          COUNT(*) as nb_reservations,
          ROUND(AVG(tarif), 2) as revenu_moyen,
          MAX(tarif) as revenu_max,
          MIN(tarif) as revenu_min
        FROM reservation 
        WHERE statut = 'confirmée'
          ${intervalCondition}
      `),

      // Réservations par statut
      db.query(`
        SELECT 
          statut,
          COUNT(*) as count,
          ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM reservation WHERE datereservation >= DATE_TRUNC('${dateTrunc}', CURRENT_DATE)), 0), 2) as percentage
        FROM reservation 
        WHERE datereservation >= DATE_TRUNC('${dateTrunc}', CURRENT_DATE)
        GROUP BY statut
      `),

      // Clients actifs
      db.query(`
        SELECT 
          COUNT(*) as total_clients,
          COUNT(CASE WHEN statut = 'actif' THEN 1 END) as clients_actifs,
          COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as clients_inactifs
        FROM clients
      `),

      // Occupation des terrains
      db.query(`
        SELECT 
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          COUNT(*) as total_reservations,
          COALESCE(SUM(tarif), 0) as revenu_total
        FROM reservation 
        WHERE statut = 'confirmée'
          ${intervalCondition}
      `),

      // Données temps réel
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as reservations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annulations_aujourdhui,
          COALESCE(SUM(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN tarif ELSE 0 END), 0) as revenu_aujourdhui,
          COUNT(DISTINCT CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN numeroterrain END) as terrains_occupes_aujourdhui
        FROM reservation
      `),

      // Tendances vs période précédente
      db.query(`
        WITH current_period AS (
          SELECT 
            COUNT(*) as reservations_courantes,
            COALESCE(SUM(tarif), 0) as revenu_courant
          FROM reservation 
          WHERE statut = 'confirmée'
            ${intervalCondition}
        ),
        previous_period AS (
          SELECT 
            COUNT(*) as reservations_precedentes,
            COALESCE(SUM(tarif), 0) as revenu_precedent
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= DATE_TRUNC('${dateTrunc}', CURRENT_DATE - INTERVAL '1 ${dateTrunc}')
            AND datereservation < DATE_TRUNC('${dateTrunc}', CURRENT_DATE)
        )
        SELECT 
          cp.reservations_courantes,
          cp.revenu_courant,
          pp.reservations_precedentes,
          pp.revenu_precedent,
          CASE 
            WHEN pp.reservations_precedentes > 0 THEN
              ROUND(((cp.reservations_courantes - pp.reservations_precedentes)::decimal / pp.reservations_precedentes * 100), 2)
            ELSE 100
          END as evolution_reservations,
          CASE 
            WHEN pp.revenu_precedent > 0 THEN
              ROUND(((cp.revenu_courant - pp.revenu_precedent)::decimal / pp.revenu_precedent * 100), 2)
            ELSE 100
          END as evolution_revenus
        FROM current_period cp, previous_period pp
      `)
    ]);

    const stats = {
      periode: periode,
      date_actualisation: new Date().toISOString(),
      
      // Métriques principales
      revenus: {
        total: parseFloat(revenusResult.rows[0].revenu_total),
        moyen: parseFloat(revenusResult.rows[0].revenu_moyen),
        max: parseFloat(revenusResult.rows[0].revenu_max),
        min: parseFloat(revenusResult.rows[0].revenu_min),
        reservations: parseInt(revenusResult.rows[0].nb_reservations)
      },

      reservations: {
        par_statut: reservationsResult.rows,
        total: reservationsResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0)
      },

      clients: {
        total: parseInt(clientsResult.rows[0].total_clients),
        actifs: parseInt(clientsResult.rows[0].clients_actifs),
        inactifs: parseInt(clientsResult.rows[0].clients_inactifs),
        taux_activation: clientsResult.rows[0].total_clients > 0 ? 
          Math.round((parseInt(clientsResult.rows[0].clients_actifs) / parseInt(clientsResult.rows[0].total_clients)) * 100) : 0
      },

      terrains: {
        utilises: parseInt(terrainsResult.rows[0].terrains_utilises),
        total_reservations: parseInt(terrainsResult.rows[0].total_reservations),
        revenu_total: parseFloat(terrainsResult.rows[0].revenu_total)
      },

      temps_reel: {
        reservations_aujourdhui: parseInt(tempsReelResult.rows[0].reservations_aujourdhui),
        annulations_aujourdhui: parseInt(tempsReelResult.rows[0].annulations_aujourdhui),
        revenu_aujourdhui: parseFloat(tempsReelResult.rows[0].revenu_aujourdhui),
        terrains_occupes_aujourdhui: parseInt(tempsReelResult.rows[0].terrains_occupes_aujourdhui)
      },

      tendances: {
        evolution_reservations: parseFloat(tendancesResult.rows[0].evolution_reservations) || 0,
        evolution_revenus: parseFloat(tendancesResult.rows[0].evolution_revenus) || 0,
        reservations_courantes: parseInt(tendancesResult.rows[0].reservations_courantes),
        reservations_precedentes: parseInt(tendancesResult.rows[0].reservations_precedentes)
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Erreur dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Statistiques détaillées par période
router.get('/periodiques', async (req, res) => {
  try {
    const { type = 'day', limite = 30 } = req.query;

    let sql = '';
    
    switch (type) {
      case 'day':
        sql = `
          SELECT 
            datereservation as date,
            TO_CHAR(datereservation, 'DD/MM') as date_formattee,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as revenu,
            COUNT(DISTINCT numeroterrain) as terrains_utilises,
            COUNT(DISTINCT idclient) as clients_uniques,
            ROUND(AVG(tarif), 2) as revenu_moyen
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '${limite} days'
          GROUP BY datereservation
          ORDER BY datereservation DESC
          LIMIT ${limite}
        `;
        break;

      case 'week':
        sql = `
          SELECT 
            DATE_TRUNC('week', datereservation) as date_debut_semaine,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as revenu,
            COUNT(DISTINCT numeroterrain) as terrains_utilises,
            COUNT(DISTINCT idclient) as clients_uniques,
            ROUND(AVG(tarif), 2) as revenu_moyen
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '${limite * 7} days'
          GROUP BY DATE_TRUNC('week', datereservation)
          ORDER BY date_debut_semaine DESC
          LIMIT ${limite}
        `;
        break;

      case 'month':
      default:
        sql = `
          SELECT 
            DATE_TRUNC('month', datereservation) as date_debut_mois,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as revenu,
            COUNT(DISTINCT numeroterrain) as terrains_utilises,
            COUNT(DISTINCT idclient) as clients_uniques,
            ROUND(AVG(tarif), 2) as revenu_moyen
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '${limite * 30} days'
          GROUP BY DATE_TRUNC('month', datereservation)
          ORDER BY date_debut_mois DESC
          LIMIT ${limite}
        `;
    }

    const result = await db.query(sql);

    res.json({
      success: true,
      type: type,
      limite: parseInt(limite),
      data: result.rows,
      statistiques: {
        total_revenu: result.rows.reduce((sum, row) => sum + parseFloat(row.revenu), 0),
        total_reservations: result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations), 0),
        moyenne_revenu: result.rows.length > 0 ? 
          Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenu), 0) / result.rows.length) : 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur stats périodiques:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🎯 Statistiques KPI basiques
router.get('/kpi', async (req, res) => {
  try {
    const [
      tauxOccupationResult,
      clientsFrequentsResult,
      performanceTerrainsResult
    ] = await Promise.all([

      // Taux d'occupation basique
      db.query(`
        SELECT 
          COUNT(*) as total_reservations,
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          COUNT(DISTINCT datereservation) as jours_occupes,
          COALESCE(SUM(tarif), 0) as revenu_total
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      `),

      // Clients fréquents
      db.query(`
        SELECT 
          COUNT(DISTINCT idclient) as clients_total,
          COUNT(CASE WHEN nb_reservations >= 2 THEN 1 END) as clients_frequents
        FROM (
          SELECT 
            idclient,
            COUNT(*) as nb_reservations
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY idclient
        ) as reservations_par_client
      `),

      // Performance par terrain
      db.query(`
        SELECT 
          numeroterrain,
          COUNT(*) as nb_reservations,
          COALESCE(SUM(tarif), 0) as revenu_total,
          ROUND(AVG(tarif), 2) as revenu_moyen
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain
        ORDER BY revenu_total DESC
        LIMIT 10
      `)
    ]);

    const totalReservations = parseInt(tauxOccupationResult.rows[0].total_reservations);
    const joursOccupes = parseInt(tauxOccupationResult.rows[0].jours_occupes);
    const tauxOccupation = joursOccupes > 0 ? (totalReservations / joursOccupes).toFixed(1) : 0;

    const kpis = {
      occupation: {
        reservations_total: totalReservations,
        terrains_utilises: parseInt(tauxOccupationResult.rows[0].terrains_utilises),
        jours_occupes: joursOccupes,
        taux_occupation_moyen: parseFloat(tauxOccupation),
        revenu_total: parseFloat(tauxOccupationResult.rows[0].revenu_total)
      },
      clients: {
        total: parseInt(clientsFrequentsResult.rows[0].clients_total),
        frequents: parseInt(clientsFrequentsResult.rows[0].clients_frequents),
        taux_fidelisation: clientsFrequentsResult.rows[0].clients_total > 0 ?
          Math.round((parseInt(clientsFrequentsResult.rows[0].clients_frequents) / parseInt(clientsFrequentsResult.rows[0].clients_total)) * 100) : 0
      },
      terrains: performanceTerrainsResult.rows
    };

    res.json({
      success: true,
      data: kpis
    });

  } catch (error) {
    console.error('❌ Erreur KPI stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;