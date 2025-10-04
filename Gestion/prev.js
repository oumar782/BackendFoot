import express from 'express';
import db from '../db.js';

const router = express.Router();

// Middleware CORS
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Route de test
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API Prévisions fonctionne correctement',
    timestamp: new Date().toISOString()
  });
});

// 📊 REVENUS TOTAUX (en DH)
router.get('/revenus-totaux', async (req, res) => {
  try {
    const { periode = 'mois', date_debut, date_fin } = req.query;
    
    let sql = '';
    let params = [];
    
    let periodeCondition = '';
    if (date_debut && date_fin) {
      periodeCondition = `AND datereservation BETWEEN $1 AND $2`;
      params = [date_debut, date_fin];
    } else {
      switch (periode) {
        case 'jour':
          periodeCondition = `AND datereservation = CURRENT_DATE`;
          break;
        case 'semaine':
          periodeCondition = `AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`;
          break;
        case 'mois':
        default:
          periodeCondition = `AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`;
      }
    }

    sql = `
      SELECT 
        COALESCE(SUM(tarif), 0) AS revenu_total,
        COUNT(*) AS nb_reservations,
        COUNT(DISTINCT datereservation) AS nb_jours_avec_reservations,
        ROUND(AVG(tarif), 2) AS revenu_moyen_par_reservation,
        MAX(tarif) AS revenu_max,
        MIN(tarif) AS revenu_min
      FROM reservation 
      WHERE statut = 'confirmée'
      ${periodeCondition}
    `;

    const result = await db.query(sql, params);

    res.json({
      success: true,
      periode: periode,
      date_debut: date_debut || new Date().toISOString().split('T')[0],
      date_fin: date_fin || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur récupération revenus totaux:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 PRÉVISIONS DE REVENUS (journalier, hebdomadaire, mensuel)
router.get('/previsions/revenus', async (req, res) => {
  try {
    const { type = 'mensuel' } = req.query;

    let sql = '';
    
    switch (type) {
      case 'journalier':
        sql = `
          WITH dates_series AS (
            SELECT generate_series(
              CURRENT_DATE, 
              CURRENT_DATE + INTERVAL '30 days', 
              '1 day'::interval
            )::date AS date_jour
          ),
          revenus_jour AS (
            SELECT 
              datereservation,
              COALESCE(SUM(tarif), 0) AS revenu_journalier,
              COUNT(*) AS nb_reservations
            FROM reservation
            WHERE statut = 'confirmée'
              AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            GROUP BY datereservation
          )
          SELECT 
            ds.date_jour AS date,
            TO_CHAR(ds.date_jour, 'DD/MM') AS date_formattee,
            EXTRACT(DOW FROM ds.date_jour) AS jour_semaine,
            COALESCE(rj.revenu_journalier, 0) AS revenu_prevue,
            COALESCE(rj.nb_reservations, 0) AS reservations_prevues,
            CASE 
              WHEN COALESCE(rj.revenu_journalier, 0) >= 1000 THEN 'Élevé'
              WHEN COALESCE(rj.revenu_journalier, 0) >= 500 THEN 'Moyen'
              ELSE 'Faible'
            END AS niveau_revenu
          FROM dates_series ds
          LEFT JOIN revenus_jour rj ON ds.date_jour = rj.datereservation
          ORDER BY ds.date_jour ASC
        `;
        break;

      case 'hebdomadaire':
        sql = `
          WITH semaines_series AS (
            SELECT 
              date_trunc('week', generate_series(
                CURRENT_DATE, 
                CURRENT_DATE + INTERVAL '12 weeks', 
                '1 week'::interval
              )) AS debut_semaine
          ),
          revenus_semaine AS (
            SELECT 
              date_trunc('week', datereservation) AS debut_semaine,
              COALESCE(SUM(tarif), 0) AS revenu_hebdomadaire,
              COUNT(*) AS nb_reservations,
              COUNT(DISTINCT datereservation) AS jours_occupes
            FROM reservation
            WHERE statut = 'confirmée'
              AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '84 days'
            GROUP BY date_trunc('week', datereservation)
          )
          SELECT 
            ss.debut_semaine AS date_debut_semaine,
            (ss.debut_semaine + INTERVAL '6 days')::date AS date_fin_semaine,
            TO_CHAR(ss.debut_semaine, 'DD/MM') || ' - ' || TO_CHAR(ss.debut_semaine + INTERVAL '6 days', 'DD/MM') AS periode_semaine,
            COALESCE(rs.revenu_hebdomadaire, 0) AS revenu_prevue,
            COALESCE(rs.nb_reservations, 0) AS reservations_prevues,
            COALESCE(rs.jours_occupes, 0) AS jours_occupes,
            ROUND(COALESCE(rs.revenu_hebdomadaire / NULLIF(rs.jours_occupes, 0), 0), 2) AS revenu_moyen_par_jour
          FROM semaines_series ss
          LEFT JOIN revenus_semaine rs ON ss.debut_semaine = rs.debut_semaine
          ORDER BY ss.debut_semaine ASC
        `;
        break;

      case 'mensuel':
      default:
        sql = `
          WITH mois_series AS (
            SELECT 
              date_trunc('month', generate_series(
                CURRENT_DATE, 
                CURRENT_DATE + INTERVAL '12 months', 
                '1 month'::interval
              )) AS debut_mois
          ),
          revenus_mois AS (
            SELECT 
              date_trunc('month', datereservation) AS debut_mois,
              COALESCE(SUM(tarif), 0) AS revenu_mensuel,
              COUNT(*) AS nb_reservations,
              COUNT(DISTINCT datereservation) AS jours_occupes,
              ROUND(AVG(tarif), 2) AS revenu_moyen_par_reservation
            FROM reservation
            WHERE statut = 'confirmée'
              AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '365 days'
            GROUP BY date_trunc('month', datereservation)
          )
          SELECT 
            ms.debut_mois AS date_debut_mois,
            (ms.debut_mois + INTERVAL '1 month - 1 day')::date AS date_fin_mois,
            TO_CHAR(ms.debut_mois, 'MM/YYYY') AS periode_mois,
            TO_CHAR(ms.debut_mois, 'Month YYYY') AS periode_mois_complet,
            COALESCE(rm.revenu_mensuel, 0) AS revenu_prevue,
            COALESCE(rm.nb_reservations, 0) AS reservations_prevues,
            COALESCE(rm.jours_occupes, 0) AS jours_occupes,
            COALESCE(rm.revenu_moyen_par_reservation, 0) AS revenu_moyen_par_reservation,
            ROUND(COALESCE(rm.revenu_mensuel / NULLIF(rm.jours_occupes, 0), 0), 2) AS revenu_moyen_par_jour
          FROM mois_series ms
          LEFT JOIN revenus_mois rm ON ms.debut_mois = rm.debut_mois
          ORDER BY ms.debut_mois ASC
        `;
    }

    const result = await db.query(sql);

    // Calcul des statistiques
    const stats = {
      revenu_total_prevue: result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_prevue), 0),
      reservations_total_prevues: result.rows.reduce((sum, row) => sum + parseInt(row.reservations_prevues), 0),
      moyenne_revenu_par_periode: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_prevue), 0) / result.rows.length),
      periode_max_revenu: result.rows.reduce((max, row) => parseFloat(row.revenu_prevue) > parseFloat(max.revenu_prevue) ? row : max, result.rows[0]),
      periode_min_revenu: result.rows.reduce((min, row) => parseFloat(row.revenu_prevue) < parseFloat(min.revenu_prevue) ? row : min, result.rows[0])
    };

    res.json({
      success: true,
      type_prevision: type,
      data: result.rows,
      statistiques: stats,
      metriques: {
        nombre_periodes: result.rows.length,
        date_generation: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions revenus:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 TAUX DE REMPLISSAGE (journalier, hebdomadaire, mensuel)
router.get('/taux-remplissage', async (req, res) => {
  try {
    const { type = 'mensuel' } = req.query;

    let sql = '';
    
    switch (type) {
      case 'journalier':
        sql = `
          WITH dates_series AS (
            SELECT generate_series(
              CURRENT_DATE, 
              CURRENT_DATE + INTERVAL '30 days', 
              '1 day'::interval
            )::date AS date_jour
          ),
          occupation_jour AS (
            SELECT 
              datereservation,
              COUNT(DISTINCT numeroterrain) AS nb_terrains_utilises,
              COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_reservees,
              COALESCE(COUNT(DISTINCT numeroterrain) * 12, 0) AS heures_disponibles,
              ROUND(
                (COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0)
                 /
                 NULLIF(COUNT(DISTINCT numeroterrain) * 12, 0)
                ) * 100, 2
              ) AS taux_remplissage
            FROM reservation
            WHERE statut = 'confirmée'
              AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            GROUP BY datereservation
          )
          SELECT 
            ds.date_jour AS date,
            TO_CHAR(ds.date_jour, 'DD/MM') AS date_formattee,
            EXTRACT(DOW FROM ds.date_jour) AS jour_semaine,
            COALESCE(oj.nb_terrains_utilises, 0) AS terrains_occupes,
            COALESCE(oj.taux_remplissage, 0) AS taux_remplissage,
            COALESCE(oj.heures_reservees, 0) AS heures_reservees,
            COALESCE(oj.heures_disponibles, 12) AS heures_disponibles,
            CASE 
              WHEN COALESCE(oj.taux_remplissage, 0) >= 80 THEN 'Élevé'
              WHEN COALESCE(oj.taux_remplissage, 0) >= 50 THEN 'Moyen'
              ELSE 'Faible'
            END AS niveau_remplissage
          FROM dates_series ds
          LEFT JOIN occupation_jour oj ON ds.date_jour = oj.datereservation
          ORDER BY ds.date_jour ASC
        `;
        break;

      case 'hebdomadaire':
        sql = `
          WITH semaines_series AS (
            SELECT 
              date_trunc('week', generate_series(
                CURRENT_DATE, 
                CURRENT_DATE + INTERVAL '12 weeks', 
                '1 week'::interval
              )) AS debut_semaine
          ),
          occupation_semaine AS (
            SELECT 
              date_trunc('week', datereservation) AS debut_semaine,
              ROUND(AVG(
                (COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0)
                 /
                 NULLIF(COUNT(DISTINCT numeroterrain) * 12, 0)
                ) * 100
              ), 2) AS taux_remplissage_moyen,
              COUNT(DISTINCT datereservation) AS jours_occupes,
              AVG(COUNT(DISTINCT numeroterrain)) AS terrains_moyen_par_jour
            FROM reservation
            WHERE statut = 'confirmée'
              AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '84 days'
            GROUP BY date_trunc('week', datereservation)
          )
          SELECT 
            ss.debut_semaine AS date_debut_semaine,
            (ss.debut_semaine + INTERVAL '6 days')::date AS date_fin_semaine,
            TO_CHAR(ss.debut_semaine, 'DD/MM') || ' - ' || TO_CHAR(ss.debut_semaine + INTERVAL '6 days', 'DD/MM') AS periode_semaine,
            COALESCE(os.taux_remplissage_moyen, 0) AS taux_remplissage,
            COALESCE(os.jours_occupes, 0) AS jours_occupes,
            COALESCE(os.terrains_moyen_par_jour, 0) AS terrains_moyen_par_jour
          FROM semaines_series ss
          LEFT JOIN occupation_semaine os ON ss.debut_semaine = os.debut_semaine
          ORDER BY ss.debut_semaine ASC
        `;
        break;

      case 'mensuel':
      default:
        sql = `
          WITH mois_series AS (
            SELECT 
              date_trunc('month', generate_series(
                CURRENT_DATE, 
                CURRENT_DATE + INTERVAL '12 months', 
                '1 month'::interval
              )) AS debut_mois
          ),
          occupation_mois AS (
            SELECT 
              date_trunc('month', datereservation) AS debut_mois,
              ROUND(AVG(
                (COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0)
                 /
                 NULLIF(COUNT(DISTINCT numeroterrain) * 12, 0)
                ) * 100
              ), 2) AS taux_remplissage_moyen,
              COUNT(DISTINCT datereservation) AS jours_occupes,
              AVG(COUNT(DISTINCT numeroterrain)) AS terrains_moyen_par_jour,
              MAX(COUNT(DISTINCT numeroterrain)) AS terrains_max_par_jour
            FROM reservation
            WHERE statut = 'confirmée'
              AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '365 days'
            GROUP BY date_trunc('month', datereservation)
          )
          SELECT 
            ms.debut_mois AS date_debut_mois,
            (ms.debut_mois + INTERVAL '1 month - 1 day')::date AS date_fin_mois,
            TO_CHAR(ms.debut_mois, 'MM/YYYY') AS periode_mois,
            TO_CHAR(ms.debut_mois, 'Month YYYY') AS periode_mois_complet,
            COALESCE(om.taux_remplissage_moyen, 0) AS taux_remplissage,
            COALESCE(om.jours_occupes, 0) AS jours_occupes,
            COALESCE(om.terrains_moyen_par_jour, 0) AS terrains_moyen_par_jour,
            COALESCE(om.terrains_max_par_jour, 0) AS terrains_max_par_jour
          FROM mois_series ms
          LEFT JOIN occupation_mois om ON ms.debut_mois = om.debut_mois
          ORDER BY ms.debut_mois ASC
        `;
    }

    const result = await db.query(sql);

    // Calcul des statistiques
    const stats = {
      taux_remplissage_moyen: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.taux_remplissage), 0) / result.rows.length),
      periode_max_remplissage: result.rows.reduce((max, row) => parseFloat(row.taux_remplissage) > parseFloat(max.taux_remplissage) ? row : max, result.rows[0]),
      periode_min_remplissage: result.rows.reduce((min, row) => parseFloat(row.taux_remplissage) < parseFloat(min.taux_remplissage) ? row : min, result.rows[0]),
      jours_occupes_total: result.rows.reduce((sum, row) => sum + parseInt(row.jours_occupes || 0), 0)
    };

    res.json({
      success: true,
      type_remplissage: type,
      data: result.rows,
      statistiques: stats,
      metriques: {
        nombre_periodes: result.rows.length,
        date_generation: new Date().toISOString()
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

// 📊 STATISTIQUES TEMPS RÉEL
router.get('/statistiques-temps-reel', async (req, res) => {
  try {
    // Nombre de terrains occupés en ce moment
    const terrainsOccupesSql = `
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_occupes_actuels
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heurereservation <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
    `;

    // Nombre d'annulations dans la semaine
    const annulationsSemaineSql = `
      SELECT COUNT(*) AS annulations_semaine
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE
    `;

    // Total des terrains actifs dans la semaine
    const terrainsActifsSql = `
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_actifs_semaine
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE
    `;

    // Réservations confirmées aujourd'hui
    const reservationsAujourdhuiSql = `
      SELECT COUNT(*) AS reservations_aujourdhui,
             COALESCE(SUM(tarif), 0) AS revenu_aujourdhui
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
    `;

    // Clients actifs ce mois-ci
    const clientsActifsSql = `
      SELECT COUNT(DISTINCT idclient) AS clients_actifs_mois
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE
    `;

    // Exécution de toutes les requêtes en parallèle
    const [
      terrainsOccupesResult,
      annulationsResult,
      terrainsActifsResult,
      reservationsAujourdhuiResult,
      clientsActifsResult
    ] = await Promise.all([
      db.query(terrainsOccupesSql),
      db.query(annulationsSemaineSql),
      db.query(terrainsActifsSql),
      db.query(reservationsAujourdhuiSql),
      db.query(clientsActifsSql)
    ]);

    const stats = {
      terrains_occupes_actuels: terrainsOccupesResult.rows[0]?.terrains_occupes_actuels || 0,
      annulations_semaine: annulationsResult.rows[0]?.annulations_semaine || 0,
      terrains_actifs_semaine: terrainsActifsResult.rows[0]?.terrains_actifs_semaine || 0,
      reservations_aujourdhui: reservationsAujourdhuiResult.rows[0]?.reservations_aujourdhui || 0,
      revenu_aujourdhui: reservationsAujourdhuiResult.rows[0]?.revenu_aujourdhui || 0,
      clients_actifs_mois: clientsActifsResult.rows[0]?.clients_actifs_mois || 0,
      date_actualisation: new Date().toISOString()
    };

    res.json({
      success: true,
      data: stats,
      metriques: {
        periode: 'temps_réel',
        heure_serveur: new Date().toLocaleTimeString('fr-FR')
      }
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

// 📈 PRÉVISIONS D'OCCUPATION DÉTAILLÉES
router.get('/previsions/occupation', async (req, res) => {
  try {
    const { jours = 14 } = req.query;
    const joursNumber = parseInt(jours);

    const sql = `
      WITH reservations_jour AS (
        SELECT 
          datereservation,
          COUNT(DISTINCT numeroterrain) AS nb_terrains_utilises,
          COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_reservees,
          COALESCE(COUNT(DISTINCT numeroterrain) * 12, 0) AS heures_disponibles,
          ROUND(
            (COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0)
             /
             NULLIF(COUNT(DISTINCT numeroterrain) * 12, 0)
            ) * 100, 2
          ) AS taux_occupation_prevu,
          COALESCE(SUM(tarif), 0) AS revenu_attendu,
          COUNT(*) AS nb_reservations
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE
          AND datereservation <= CURRENT_DATE + INTERVAL '${joursNumber} days'
        GROUP BY datereservation
      )
      SELECT 
        *,
        TO_CHAR(datereservation, 'DD Mon') AS date_formattee,
        EXTRACT(DOW FROM datereservation) AS jour_semaine
      FROM reservations_jour
      ORDER BY datereservation ASC
    `;

    const result = await db.query(sql);

    // Calcul des statistiques
    const stats = {
      moyenne_occupation: 0,
      jour_plus_charge: null,
      revenu_total_attendu: 0,
      reservations_total: 0
    };

    if (result.rows.length > 0) {
      stats.moyenne_occupation = Math.round(
        result.rows.reduce((sum, row) => sum + parseFloat(row.taux_occupation_prevu || 0), 0) / result.rows.length
      );
      
      stats.jour_plus_charge = result.rows.reduce(
        (max, row) => parseFloat(row.taux_occupation_prevu || 0) > parseFloat(max.taux_occupation_prevu || 0) ? row : max,
        result.rows[0]
      );
      
      stats.revenu_total_attendu = result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_attendu || 0), 0);
      stats.reservations_total = result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations || 0), 0);
    }

    res.json({
      success: true,
      data: result.rows,
      periode: joursNumber,
      statistiques: stats,
      date_debut: new Date().toISOString().split('T')[0],
      date_fin: new Date(Date.now() + joursNumber * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

  } catch (error) {
    console.error('❌ Erreur prévisions occupation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;