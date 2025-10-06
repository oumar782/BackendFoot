// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    
    // Requêtes parallèles pour optimiser les performances
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
          COALESCE(SUM(tarif), 0) AS revenu_total,
          COUNT(*) AS nb_reservations,
          ROUND(AVG(tarif), 2) AS revenu_moyen,
          MAX(tarif) AS revenu_max,
          MIN(tarif) AS revenu_min
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
      `),
      
      // Réservations par statut
      db.query(`
        SELECT 
          statut,
          COUNT(*) AS count,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
        FROM reservation
        WHERE datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
        GROUP BY statut
        ORDER BY count DESC
      `),
      
      // Clients actifs
      db.query(`
        SELECT 
          COUNT(*) AS total_clients,
          COUNT(CASE WHEN statut = 'actif' THEN 1 END) AS clients_actifs,
          COUNT(CASE WHEN statut = 'inactif' THEN 1 END) AS clients_inactifs,
          COUNT(DISTINCT r.idclient) AS clients_avec_reservations
        FROM clients c
        LEFT JOIN reservation r ON c.idclient = r.idclient 
          AND r.datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
      `),
      
      // Occupation des terrains
      db.query(`
        WITH occupation AS (
          SELECT 
            numeroterrain,
            COUNT(*) AS nb_reservations,
            COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_utilisees,
            COUNT(DISTINCT datereservation) AS jours_utilises
          FROM reservation
          WHERE statut = 'confirmée'
            AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
          GROUP BY numeroterrain
        )
        SELECT 
          COUNT(*) AS terrains_utilises,
          ROUND(AVG(nb_reservations), 1) AS reservations_moyenne,
          ROUND(AVG(heures_utilisees), 1) AS heures_moyennes,
          SUM(heures_utilisees) AS heures_totales,
          ROUND(AVG(heures_utilisees / NULLIF(jours_utilises, 0)), 1) AS heures_moyennes_par_jour
        FROM occupation
      `),
      
      // Données temps réel
      db.query(`
        SELECT 
          -- Terrains occupés en ce moment
          (SELECT COUNT(DISTINCT numeroterrain) 
           FROM reservation 
           WHERE statut = 'confirmée'
             AND datereservation = CURRENT_DATE
             AND heurereservation <= CURRENT_TIME
             AND heurefin >= CURRENT_TIME
          ) AS terrains_occupes_actuels,
          
          -- Réservations aujourd'hui
          (SELECT COUNT(*) 
           FROM reservation 
           WHERE statut = 'confirmée'
             AND datereservation = CURRENT_DATE
          ) AS reservations_aujourdhui,
          
          -- Revenu aujourd'hui
          (SELECT COALESCE(SUM(tarif), 0)
           FROM reservation 
           WHERE statut = 'confirmée'
             AND datereservation = CURRENT_DATE
          ) AS revenu_aujourdhui,
          
          -- Prochaines réservations (dans les 2 heures)
          (SELECT COUNT(*)
           FROM reservation 
           WHERE statut = 'confirmée'
             AND datereservation = CURRENT_DATE
             AND heurereservation BETWEEN CURRENT_TIME AND CURRENT_TIME + INTERVAL '2 hours'
          ) AS reservations_prochaines
      `),
      
      // Tendances vs période précédente
      db.query(`
        WITH periode_actuelle AS (
          SELECT 
            COUNT(*) AS reservations_count,
            COALESCE(SUM(tarif), 0) AS revenu_total,
            COUNT(DISTINCT idclient) AS clients_uniques
          FROM reservation
          WHERE statut = 'confirmée'
            AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
        ),
        periode_precedente AS (
          SELECT 
            COUNT(*) AS reservations_count,
            COALESCE(SUM(tarif), 0) AS revenu_total,
            COUNT(DISTINCT idclient) AS clients_uniques
          FROM reservation
          WHERE statut = 'confirmée'
            AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE - INTERVAL '1 ${periode}')
            AND datereservation < DATE_TRUNC('${periode}', CURRENT_DATE)
        )
        SELECT 
          pa.reservations_count AS reservations_actuelles,
          pp.reservations_count AS reservations_precedentes,
          pa.revenu_total AS revenu_actuel,
          pp.revenu_total AS revenu_precedent,
          pa.clients_uniques AS clients_actuels,
          pp.clients_uniques AS clients_precedents,
          CASE 
            WHEN pp.reservations_count = 0 THEN 100
            ELSE ROUND((pa.reservations_count - pp.reservations_count) * 100.0 / pp.reservations_count, 1)
          END AS evolution_reservations,
          CASE 
            WHEN pp.revenu_total = 0 THEN 100
            ELSE ROUND((pa.revenu_total - pp.revenu_total) * 100.0 / pp.revenu_total, 1)
          END AS evolution_revenus
        FROM periode_actuelle pa, periode_precedente pp
      `)
    ]);

    const stats = {
      periode: periode,
      revenus: {
        total: parseFloat(revenusResult.rows[0].revenu_total),
        moyenne: parseFloat(revenusResult.rows[0].revenu_moyen),
        maximum: parseFloat(revenusResult.rows[0].revenu_max),
        minimum: parseFloat(revenusResult.rows[0].revenu_min),
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
        avec_reservations: parseInt(clientsResult.rows[0].clients_avec_reservations)
      },
      terrains: {
        utilises: parseInt(terrainsResult.rows[0].terrains_utilises),
        reservations_moyenne: parseFloat(terrainsResult.rows[0].reservations_moyenne),
        heures_moyennes: parseFloat(terrainsResult.rows[0].heures_moyennes),
        heures_totales: parseFloat(terrainsResult.rows[0].heures_totales)
      },
      temps_reel: {
        terrains_occupes: parseInt(tempsReelResult.rows[0].terrains_occupes_actuels),
        reservations_aujourdhui: parseInt(tempsReelResult.rows[0].reservations_aujourdhui),
        revenu_aujourdhui: parseFloat(tempsReelResult.rows[0].revenu_aujourdhui),
        reservations_prochaines: parseInt(tempsReelResult.rows[0].reservations_prochaines)
      },
      tendances: {
        evolution_reservations: parseFloat(tendancesResult.rows[0].evolution_reservations),
        evolution_revenus: parseFloat(tendancesResult.rows[0].evolution_revenus),
        reservations_actuelles: parseInt(tendancesResult.rows[0].reservations_actuelles),
        reservations_precedentes: parseInt(tendancesResult.rows[0].reservations_precedentes)
      },
      metriques: {
        date_actualisation: new Date().toISOString(),
        periode_calcul: periode
      }
    };

    res.json({
      success: true,
      data: stats
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

// 📈 Statistiques détaillées par terrain
router.get('/terrains', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;

    const sql = `
      SELECT 
        numeroterrain,
        typeterrain,
        nomterrain,
        COUNT(*) AS nb_reservations,
        COALESCE(SUM(tarif), 0) AS revenu_total,
        ROUND(AVG(tarif), 2) AS revenu_moyen,
        COUNT(DISTINCT datereservation) AS jours_utilises,
        COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_utilisees,
        ROUND(
          (COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) 
           / 
           NULLIF(COUNT(DISTINCT datereservation) * 12, 0)
          ) * 100, 2
        ) AS taux_occupation,
        COUNT(DISTINCT idclient) AS clients_uniques,
        MAX(tarif) AS revenu_max,
        MIN(tarif) AS revenu_min
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
      GROUP BY numeroterrain, typeterrain, nomterrain
      ORDER BY revenu_total DESC
    `;

    const result = await db.query(sql);

    // Calcul des statistiques globales
    const stats = {
      total_terrains: result.rows.length,
      revenu_total: result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_total), 0),
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations), 0),
      taux_occupation_moyen: Math.round(
        result.rows.reduce((sum, row) => sum + parseFloat(row.taux_occupation), 0) / result.rows.length
      ),
      terrain_plus_rentable: result.rows[0] || null,
      terrain_moins_rentable: result.rows[result.rows.length - 1] || null
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
      periode: periode
    });

  } catch (error) {
    console.error('❌ Erreur statistiques terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Analytics clients
router.get('/clients', async (req, res) => {
  try {
    const { periode = 'mois', top = 10 } = req.query;

    const sql = `
      SELECT 
        c.idclient,
        c.nom,
        c.prenom,
        c.email,
        c.telephone,
        c.statut,
        COUNT(r.numeroreservations) AS nb_reservations,
        COALESCE(SUM(r.tarif), 0) AS montant_total,
        ROUND(AVG(r.tarif), 2) AS montant_moyen,
        MIN(r.datereservation) AS premiere_reservation,
        MAX(r.datereservation) AS derniere_reservation,
        COUNT(DISTINCT r.numeroterrain) AS terrains_differents
      FROM clients c
      LEFT JOIN reservation r ON c.idclient = r.idclient 
        AND r.statut = 'confirmée'
        AND r.datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
      GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
      HAVING COUNT(r.numeroreservations) > 0
      ORDER BY montant_total DESC
      LIMIT $1
    `;

    const result = await db.query(sql, [parseInt(top)]);

    const stats = {
      total_clients_actifs: result.rows.length,
      revenu_total: result.rows.reduce((sum, row) => sum + parseFloat(row.montant_total), 0),
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations), 0),
      client_plus_fidele: result.rows[0] || null,
      valeur_moyenne_client: Math.round(
        result.rows.reduce((sum, row) => sum + parseFloat(row.montant_total), 0) / result.rows.length
      )
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
      top: parseInt(top)
    });

  } catch (error) {
    console.error('❌ Erreur analytics clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🕒 Prévisions intelligentes
router.get('/previsions/intelligentes', async (req, res) => {
  try {
    const { jours = 30 } = req.query;

    const sql = `
      WITH historique AS (
        -- Données historiques des 90 derniers jours
        SELECT 
          datereservation,
          EXTRACT(DOW FROM datereservation) AS jour_semaine,
          EXTRACT(MONTH FROM datereservation) AS mois,
          COUNT(*) AS reservations_count,
          COALESCE(SUM(tarif), 0) AS revenu_total,
          COUNT(DISTINCT numeroterrain) AS terrains_utilises
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
          AND datereservation < CURRENT_DATE
        GROUP BY datereservation, EXTRACT(DOW FROM datereservation), EXTRACT(MONTH FROM datereservation)
      ),
      moyennes AS (
        -- Calcul des moyennes par jour de semaine
        SELECT 
          jour_semaine,
          ROUND(AVG(reservations_count), 1) AS reservations_moyennes,
          ROUND(AVG(revenu_total), 2) AS revenu_moyen,
          ROUND(AVG(terrains_utilises), 1) AS terrains_moyens
        FROM historique
        GROUP BY jour_semaine
      ),
      future_dates AS (
        -- Génération des dates futures
        SELECT 
          generate_series(
            CURRENT_DATE, 
            CURRENT_DATE + INTERVAL '${jours} days', 
            '1 day'::interval
          )::date AS future_date
      )
      SELECT 
        fd.future_date AS date,
        TO_CHAR(fd.future_date, 'DD/MM') AS date_formattee,
        EXTRACT(DOW FROM fd.future_date) AS jour_semaine,
        TO_CHAR(fd.future_date, 'Day') AS nom_jour,
        m.reservations_moyennes AS reservations_prevues,
        m.revenu_moyen AS revenu_prevue,
        m.terrains_moyens AS terrains_prevus,
        CASE 
          WHEN m.reservations_moyennes >= 8 THEN 'Très élevée'
          WHEN m.reservations_moyennes >= 5 THEN 'Élevée'
          WHEN m.reservations_moyennes >= 3 THEN 'Moyenne'
          ELSE 'Faible'
        END AS niveau_activite_prevue,
        -- Facteur saisonnier (exemple simplifié)
        CASE 
          WHEN EXTRACT(MONTH FROM fd.future_date) IN (6,7,8) THEN 1.2  -- Été
          WHEN EXTRACT(MONTH FROM fd.future_date) IN (12,1,2) THEN 0.8  -- Hiver
          ELSE 1.0
        END AS facteur_saisonnier
      FROM future_dates fd
      LEFT JOIN moyennes m ON EXTRACT(DOW FROM fd.future_date) = m.jour_semaine
      ORDER BY fd.future_date ASC
    `;

    const result = await db.query(sql);

    const stats = {
      periode_prevision: jours,
      reservations_total_prevues: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.reservations_prevues), 0)),
      revenu_total_prevue: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_prevue), 0)),
      jours_activite_elevee: result.rows.filter(row => row.niveau_activite_prevue === 'Élevée' || row.niveau_activite_prevue === 'Très élevée').length,
      meilleur_jour: result.rows.reduce((max, row) => parseFloat(row.reservations_prevues) > parseFloat(max.reservations_prevues) ? row : max, result.rows[0]),
      pire_jour: result.rows.reduce((min, row) => parseFloat(row.reservations_prevues) < parseFloat(min.reservations_prevues) ? row : min, result.rows[0])
    };

    res.json({
      success: true,
      data: result.rows,
      statistiques: stats,
      metriques: {
        date_generation: new Date().toISOString(),
        modele: 'moyennes_mobiles_saisonnières'
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions intelligentes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;