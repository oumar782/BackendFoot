import express from 'express';
import db from '../db.js';
import { sendReservationConfirmation, checkEmailConfiguration } from '../services/emailService.js';
const router = express.Router();

// 📊 STATISTIQUES ET ANALYTIQUES

// 📌 Route pour récupérer les revenus totaux
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
          periodeCondition = `AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`;
          break;
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

// 📌 Route pour les prévisions de revenus
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

// 📌 Route pour le taux de remplissage
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

// 📌 Route pour les statistiques en temps réel
router.get('/statistiques-temps-reel', async (req, res) => {
  try {
    const terrainsOccupesSql = `
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_occupes_actuels
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heurereservation <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
    `;
    const annulationsSemaineSql = `
      SELECT COUNT(*) AS annulations_semaine
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    `;
    const terrainsActifsSql = `
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_actifs_semaine
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    `;
    const reservationsAujourdhuiSql = `
      SELECT COUNT(*) AS reservations_aujourdhui,
             COALESCE(SUM(tarif), 0) AS revenu_aujourdhui
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
    `;
    const reservationsMoisSql = `
      SELECT COUNT(*) AS reservations_mois,
             COALESCE(SUM(tarif), 0) AS revenu_mois
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= date_trunc('month', CURRENT_DATE)
        AND datereservation < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
    `;

    const [
      terrainsOccupesResult,
      annulationsResult,
      terrainsActifsResult,
      reservationsAujourdhuiResult,
      reservationsMoisResult
    ] = await Promise.all([
      db.query(terrainsOccupesSql),
      db.query(annulationsSemaineSql),
      db.query(terrainsActifsSql),
      db.query(reservationsAujourdhuiResult),
      db.query(reservationsMoisSql)
    ]);

    const stats = {
      terrains_occupes_actuels: terrainsOccupesResult.rows[0]?.terrains_occupes_actuels || 0,
      annulations_semaine: annulationsResult.rows[0]?.annulations_semaine || 0,
      terrains_actifs_semaine: terrainsActifsResult.rows[0]?.terrains_actifs_semaine || 0,
      reservations_aujourdhui: reservationsAujourdhuiResult.rows[0]?.reservations_aujourdhui || 0,
      revenu_aujourdhui: reservationsAujourdhuiResult.rows[0]?.revenu_aujourdhui || 0,
      reservations_mois: reservationsMoisResult.rows[0]?.reservations_mois || 0,
      revenu_mois: reservationsMoisResult.rows[0]?.revenu_mois || 0,
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

// 📌 Route pour récupérer les prévisions de réservations
router.get('/previsions/occupation', async (req, res) => {
  try {
    const { jours = 14, top } = req.query;
    const joursNumber = parseInt(jours);
    let sql = `
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
    `;
    if (top) {
      sql += ` ORDER BY taux_occupation_prevu DESC, heures_reservees DESC LIMIT $1`;
    } else {
      sql += ` ORDER BY datereservation ASC`;
    }
    const result = await db.query(sql, top ? [parseInt(top)] : []);

    const stats = {
      moyenne_occupation: 0,
      jour_plus_charge: null,
      revenu_total_attendu: 0,
      reservations_total: 0
    };
    if (result.rows.length > 0) {
      stats.moyenne_occupation = Math.round(
        result.rows.reduce((sum, row) => sum + parseFloat(row.taux_occupation_prevu), 0) / result.rows.length
      );
      stats.jour_plus_charge = result.rows.reduce(
        (max, row) => parseFloat(row.taux_occupation_prevu) > parseFloat(max.taux_occupation_prevu) ? row : max,
        result.rows[0]
      );
      stats.revenu_total_attendu = result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_attendu), 0);
      stats.reservations_total = result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations), 0);
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
    console.error('❌ Erreur récupération prévisions:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour les prévisions détaillées avec tendances
router.get('/previsions/detaillees', async (req, res) => {
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
          COUNT(*) AS nb_reservations,
          STRING_AGG(DISTINCT typeterrain, ', ') AS terrains_types
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE
          AND datereservation <= CURRENT_DATE + INTERVAL '${joursNumber} days'
        GROUP BY datereservation
      ),
      tendances AS (
        SELECT 
          datereservation,
          taux_occupation_prevu,
          LAG(taux_occupation_prevu) OVER (ORDER BY datereservation) AS occupation_precedente,
          CASE 
            WHEN LAG(taux_occupation_prevu) OVER (ORDER BY datereservation) IS NULL THEN 'stable'
            WHEN taux_occupation_prevu > LAG(taux_occupation_prevu) OVER (ORDER BY datereservation) THEN 'up'
            WHEN taux_occupation_prevu < LAG(taux_occupation_prevu) OVER (ORDER BY datereservation) THEN 'down'
            ELSE 'stable'
          END AS tendance
        FROM reservations_jour
      )
      SELECT 
        rj.*,
        t.tendance,
        TO_CHAR(rj.datereservation, 'DD Mon') AS date_formattee,
        EXTRACT(DOW FROM rj.datereservation) AS jour_semaine,
        CASE 
          WHEN rj.taux_occupation_prevu >= 80 THEN 'Élevée'
          WHEN rj.taux_occupation_prevu >= 50 THEN 'Moyenne'
          ELSE 'Faible'
        END AS niveau_occupation
      FROM reservations_jour rj
      LEFT JOIN tendances t ON rj.datereservation = t.datereservation
      ORDER BY rj.datereservation ASC
    `;
    const result = await db.query(sql);

    const today = new Date();
    const dateFin = new Date(today);
    dateFin.setDate(today.getDate() + joursNumber);

    const toutesLesDates = [];
    const dateCourante = new Date(today);
    while (dateCourante <= dateFin) {
      const dateStr = dateCourante.toISOString().split('T')[0];
      const dateFormatee = dateCourante.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const jourSemaine = dateCourante.getDay();
      const reservationExistante = result.rows.find(row => 
        row.datereservation.toISOString().split('T')[0] === dateStr
      );
      if (reservationExistante) {
        toutesLesDates.push(reservationExistante);
      } else {
        toutesLesDates.push({
          datereservation: dateStr,
          taux_occupation_prevu: 0,
          heures_reservees: 0,
          revenu_attendu: 0,
          nb_reservations: 0,
          tendance: 'stable',
          date_formattee: dateFormatee,
          jour_semaine: jourSemaine,
          niveau_occupation: 'Faible',
          nb_terrains_utilises: 0,
          heures_disponibles: 12,
          terrains_types: 'Aucun'
        });
      }
      dateCourante.setDate(dateCourante.getDate() + 1);
    }

    const stats = {
      moyenne_occupation: Math.round(
        toutesLesDates.reduce((sum, row) => sum + parseFloat(row.taux_occupation_prevu), 0) / toutesLesDates.length
      ),
      jour_plus_charge: toutesLesDates.reduce(
        (max, row) => parseFloat(row.taux_occupation_prevu) > parseFloat(max.taux_occupation_prevu) ? row : max,
        toutesLesDates[0]
      ),
      jour_moins_charge: toutesLesDates.reduce(
        (min, row) => parseFloat(row.taux_occupation_prevu) < parseFloat(min.taux_occupation_prevu) ? row : min,
        toutesLesDates[0]
      ),
      revenu_total_attendu: toutesLesDates.reduce((sum, row) => sum + parseFloat(row.revenu_attendu), 0),
      reservations_total: toutesLesDates.reduce((sum, row) => sum + parseInt(row.nb_reservations), 0),
      jours_eleves: toutesLesDates.filter(row => parseFloat(row.taux_occupation_prevu) >= 80).length,
      jours_moyens: toutesLesDates.filter(row => parseFloat(row.taux_occupation_prevu) >= 50 && parseFloat(row.taux_occupation_prevu) < 80).length,
      jours_faibles: toutesLesDates.filter(row => parseFloat(row.taux_occupation_prevu) < 50).length
    };

    res.json({
      success: true,
      data: toutesLesDates,
      periode: joursNumber,
      statistiques: stats,
      metriques: {
        jours_analyse: toutesLesDates.length,
        date_debut: today.toISOString().split('T')[0],
        date_fin: dateFin.toISOString().split('T')[0],
        terrains_moyen: Math.round(toutesLesDates.reduce((sum, row) => sum + parseInt(row.nb_terrains_utilises), 0) / toutesLesDates.length)
      }
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

// 📧 GESTION DES EMAILS - VERSION AMÉLIORÉE

// 📌 Route pour vérifier la configuration email
router.get('/email/config', async (req, res) => {
  try {
    const config = await checkEmailConfiguration();
    res.json({
      success: true,
      configuration: config,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification de la configuration email',
      error: error.message
    });
  }
});

// 📌 Route pour tester l'envoi d'email - VERSION SIMPLIFIÉE
router.post('/email/test', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email de test requis'
      });
    }
    if (!email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'Format d\'email invalide'
      });
    }

    const testReservation = {
      id: 'test-' + Date.now(),
      datereservation: new Date().toISOString().split('T')[0],
      heurereservation: '14:00',
      heurefin: '16:00',
      statut: 'confirmée',
      numeroterrain: 1,
      nomclient: 'Test',
      prenom: 'Utilisateur',
      email: email,
      telephone: '0123456789',
      typeterrain: 'Synthétique',
      tarif: 150,
      nomterrain: 'Stade Principal'
    };

    console.log('🧪 TEST EMAIL MANUEL vers:', email);
    const result = await sendReservationConfirmation(testReservation);
    if (result.success) {
      res.json({
        success: true,
        message: '✅ Email de test envoyé avec succès',
        email: email,
        messageId: result.messageId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        message: '❌ Échec de l\'envoi de l\'email',
        error: result.error,
        details: result.details,
        email: email
      });
    }
  } catch (error) {
    console.error('❌ Erreur test email manuel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du test d\'email',
      error: error.message
    });
  }
});

// 🎯 GESTION DES RÉSERVATIONS - AVEC GESTION EMAIL AMÉLIORÉE

// 📌 Route pour récupérer les réservations (avec ou sans filtres)
router.get('/', async (req, res) => {
  try {
    const { nom, email, statut, date, page = 1, limit = 10 } = req.query;
    let sql = `
      SELECT 
        numeroreservations as id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        numeroterrain,
        nomclient,
        prenom,
        email,
        telephone,
        typeterrain,
        tarif,
        surface,
        heurefin,
        nomterrain
      FROM reservation 
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (nom) {
      paramCount++;
      sql += ` AND nomclient ILIKE $${paramCount}`;
      params.push(`%${nom}%`);
    }
    if (email) {
      paramCount++;
      sql += ` AND email ILIKE $${paramCount}`;
      params.push(`%${email}%`);
    }
    if (statut) {
      paramCount++;
      sql += ` AND statut = $${paramCount}`;
      params.push(statut);
    }
    if (date) {
      paramCount++;
      sql += ` AND datereservation = $${paramCount}`;
      params.push(date);
    }

    // Comptage total pour la pagination
    const countSql = `SELECT COUNT(*) as total_count FROM (${sql}) as subquery`;
    const countResult = await db.query(countSql, params);
    const totalCount = parseInt(countResult.rows[0].total_count);

    // Pagination
    const offset = (page - 1) * limit;
    sql += ` ORDER BY datereservation DESC, heurereservation DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), offset);

    const result = await db.query(sql, params);
    res.json({
      success: true,
      count: result.rows.length,
      total: totalCount,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / limit),
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour récupérer une réservation spécifique par ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT 
        numeroreservations as id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        numeroterrain,
        nomclient,
        prenom,
        email,
        telephone,
        typeterrain,
        tarif,
        surface,
        heurefin,
        nomterrain
      FROM reservation 
      WHERE numeroreservations = $1
    `;
    const result = await db.query(sql, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour créer une nouvelle réservation
router.post('/', async (req, res) => {
  try {
    const {
      datereservation,
      heurereservation,
      statut,
      numeroterrain,
      nomclient,
      prenom,
      email,
      telephone,
      typeterrain,
      tarif,
      surface,
      heurefin,
      nomterrain
    } = req.body;

    // Validation des champs requis
    if (!datereservation || !heurereservation || !statut || !numeroterrain) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants: date, heure, statut et numeroterrain sont obligatoires.'
      });
    }

    const sql = `
      INSERT INTO reservation (
        datereservation, heurereservation, statut, numeroterrain,
        nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING numeroreservations as id, *
    `;
    const params = [
      datereservation, heurereservation, statut, numeroterrain,
      nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain
    ];

    const result = await db.query(sql, params);
    const newReservation = result.rows[0];

    // ✅ GESTION AMÉLIORÉE DE L'ENVOI D'EMAIL
    let emailResult = null;
    const shouldSendEmail = statut === 'confirmée' && email && email.includes('@');
    if (shouldSendEmail) {
      try {
        console.log(`📧 Tentative d'envoi d'email de confirmation à: ${email}`);
        console.log(`🏟️ Réservation pour: ${nomterrain || 'Terrain ' + numeroterrain}`);
        emailResult = await sendReservationConfirmation(newReservation);
        if (emailResult.success) {
          console.log('✅ Email envoyé avec succès!');
        } else {
          console.error('❌ Erreur lors de l\'envoi de l\'email:', emailResult.error);
        }
      } catch (emailError) {
        console.error('❌ Erreur critique lors de l\'envoi d\'email:', emailError);
        emailResult = { success: false, error: emailError.message };
      }
    } else {
      console.log('ℹ️  Aucun email envoyé - Raisons:',
        statut !== 'confirmée' ? 'Statut non confirmé' : '',
        !email ? 'Email manquant' : '',
        !email.includes('@') ? 'Email invalide' : ''
      );
      emailResult = { sent: false, reason: 'Non requis' };
    }

    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès' + (emailResult.success ? ' et email de confirmation envoyé' : ''),
      data: newReservation,
      email: emailResult
    });
  } catch (error) {
    console.error('❌ Erreur création réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour une réservation
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      datereservation,
      heurereservation,
      statut,
      numeroterrain,
      nomclient,
      prenom,
      email,
      telephone,
      typeterrain,
      tarif,
      surface,
      heurefin,
      nomterrain
    } = req.body;

    const oldReservationResult = await db.query(
      'SELECT statut, email FROM reservation WHERE numeroreservations = $1',
      [id]
    );
    if (oldReservationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    const oldReservation = oldReservationResult.rows[0];
    const oldStatus = oldReservation.statut;

    const sql = `
      UPDATE reservation 
      SET 
        datereservation = $1,
        heurereservation = $2,
        statut = $3,
        numeroterrain = $4,
        nomclient = $5,
        prenom = $6,
        email = $7,
        telephone = $8,
        typeterrain = $9,
        tarif = $10,
        surface = $11,
        heurefin = $12,
        nomterrain = $13
      WHERE numeroreservations = $14
      RETURNING numeroreservations as id, *
    `;
    const params = [
      datereservation, heurereservation, statut, numeroterrain,
      nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain, id
    ];

    const result = await db.query(sql, params);
    const updatedReservation = result.rows[0];

    let emailResult = null;
    const becameConfirmed = oldStatus !== 'confirmée' && statut === 'confirmée';
    const hasValidEmail = email && email.includes('@');
    const shouldSendEmail = becameConfirmed && hasValidEmail;
    if (shouldSendEmail) {
      try {
        console.log(`📧 Envoi d'email de confirmation (mise à jour) à: ${email}`);
        emailResult = await sendReservationConfirmation(updatedReservation);
        if (emailResult.success) {
          console.log('✅ Email envoyé avec succès!');
        } else {
          console.error('❌ Erreur lors de l\'envoi de l\'email:', emailResult.error);
        }
      } catch (emailError) {
        console.error('❌ Erreur critique lors de l\'envoi d\'email:', emailError);
        emailResult = { success: false, error: emailError.message };
      }
    } else {
      console.log('ℹ️  Aucun email envoyé pour mise à jour');
      emailResult = { sent: false, reason: 'Non requis' };
    }

    res.json({
      success: true,
      message: 'Réservation mise à jour avec succès' + (emailResult.success ? ' et email de confirmation envoyé' : ''),
      data: updatedReservation,
      email: emailResult
    });
  } catch (error) {
    console.error('❌ Erreur mise à jour réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour supprimer une réservation
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const sql = 'DELETE FROM reservation WHERE numeroreservations = $1 RETURNING numeroreservations as id, *';
    const result = await db.query(sql, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    res.json({
      success: true,
      message: 'Réservation supprimée avec succès.',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur suppression réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour mettre à jour le statut d'une réservation
router.put('/:id/statut', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;
    if (!statut || !['confirmée', 'annulée', 'en attente', 'terminée'].includes(statut)) {
      return res.status(400).json({
        success: false,
        message: 'Statut invalide. Utilisez: confirmée, annulée, en attente, ou terminée.'
      });
    }

    const oldReservationResult = await db.query(
      'SELECT statut, email FROM reservation WHERE numeroreservations = $1',
      [id]
    );
    if (oldReservationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }
    const oldReservation = oldReservationResult.rows[0];
    const oldStatus = oldReservation.statut;

    const sql = `
      UPDATE reservation 
      SET statut = $1
      WHERE numeroreservations = $2
      RETURNING numeroreservations as id, *
    `;
    const result = await db.query(sql, [statut, id]);
    const reservation = result.rows[0];

    let emailResult = null;
    const becameConfirmed = oldStatus !== 'confirmée' && statut === 'confirmée';
    const hasValidEmail = reservation.email && reservation.email.includes('@');
    const shouldSendEmail = becameConfirmed && hasValidEmail;
    if (shouldSendEmail) {
      try {
        console.log(`📧 Envoi d'email de confirmation (changement statut) à: ${reservation.email}`);
        emailResult = await sendReservationConfirmation(reservation);
        if (emailResult.success) {
          console.log('✅ Email envoyé avec succès!');
        } else {
          console.error('❌ Erreur lors de l\'envoi de l\'email:', emailResult.error);
        }
      } catch (emailError) {
        console.error('❌ Erreur critique lors de l\'envoi d\'email:', emailError);
        emailResult = { success: false, error: emailError.message };
      }
    } else {
      console.log('ℹ️  Aucun email envoyé pour changement statut');
      emailResult = { sent: false, reason: 'Non requis' };
    }

    res.json({
      success: true,
      message: 'Statut mis à jour avec succès' + (emailResult.success ? ' et email de confirmation envoyé' : ''),
      data: reservation,
      email: emailResult
    });
  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Route pour les réservations d'aujourd'hui
router.get('/aujourd-hui/terrains', async (req, res) => {
  try {
    const sql = `
      SELECT 
        numeroterrain,
        nomterrain,
        COUNT(*) as nb_reservations,
        STRING_AGG(
          CONCAT(heurereservation, '-', heurefin, ' (', nomclient, ')'), 
          ', '
        ) as creneaux_occupes
      FROM reservation 
      WHERE datereservation = CURRENT_DATE 
        AND statut = 'confirmée'
      GROUP BY numeroterrain, nomterrain
      ORDER BY numeroterrain
    `;
    const result = await db.query(sql);
    res.json({
      success: true,
      date: new Date().toISOString().split('T')[0],
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur réservations aujourd\'hui:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;