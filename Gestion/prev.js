// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// Helper pour convertir la période en intervalle SQL
const getPeriodCondition = (periode) => {
  switch (periode) {
    case 'jour':
      return `datereservation = CURRENT_DATE`;
    case 'semaine':
      return `datereservation >= DATE_TRUNC('week', CURRENT_DATE) AND datereservation < DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 week'`;
    case 'mois':
      return `datereservation >= DATE_TRUNC('month', CURRENT_DATE) AND datereservation < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'`;
    case 'annee':
      return `datereservation >= DATE_TRUNC('year', CURRENT_DATE) AND datereservation < DATE_TRUNC('year', CURRENT_DATE) + INTERVAL '1 year'`;
    default:
      return `datereservation >= DATE_TRUNC('month', CURRENT_DATE) AND datereservation < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'`;
  }
};

// Helper pour la période précédente
const getPreviousPeriodCondition = (periode) => {
  switch (periode) {
    case 'jour':
      return `datereservation = CURRENT_DATE - INTERVAL '1 day'`;
    case 'semaine':
      return `datereservation >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week' AND datereservation < DATE_TRUNC('week', CURRENT_DATE)`;
    case 'mois':
      return `datereservation >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AND datereservation < DATE_TRUNC('month', CURRENT_DATE)`;
    case 'annee':
      return `datereservation >= DATE_TRUNC('year', CURRENT_DATE) - INTERVAL '1 year' AND datereservation < DATE_TRUNC('year', CURRENT_DATE)`;
    default:
      return `datereservation >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month' AND datereservation < DATE_TRUNC('month', CURRENT_DATE)`;
  }
};

// Fonction safe pour arrondir les nombres
const safeRound = (value, decimals = 2) => {
  return `ROUND((${value})::numeric, ${decimals})`;
};

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    
    const periodCondition = getPeriodCondition(periode);
    const previousPeriodCondition = getPreviousPeriodCondition(periode);

    // Requêtes parallèles pour optimiser les performances
    const [
      revenusResult,
      reservationsResult,
      clientsResult,
      terrainsResult,
      tempsReelResult,
      tendancesResult
    ] = await Promise.all([
      // Revenus totaux - CORRIGÉ
      db.query(`
        SELECT 
          COALESCE(SUM(tarif), 0) AS revenu_total,
          COUNT(*) AS nb_reservations,
          COALESCE(AVG(tarif), 0) AS revenu_moyen,
          COALESCE(MAX(tarif), 0) AS revenu_max,
          COALESCE(MIN(tarif), 0) AS revenu_min
        FROM reservation 
        WHERE statut = 'confirmée'
          AND ${periodCondition}
      `),
      
      // Réservations par statut - CORRIGÉ
      db.query(`
        WITH stats AS (
          SELECT 
            statut,
            COUNT(*) AS count
          FROM reservation
          WHERE ${periodCondition}
          GROUP BY statut
        ),
        total AS (
          SELECT SUM(count) as total_count FROM stats
        )
        SELECT 
          statut,
          count,
          CASE 
            WHEN (SELECT total_count FROM total) > 0 
            THEN ROUND((count * 100.0 / (SELECT total_count FROM total))::numeric, 1)
            ELSE 0 
          END AS percentage
        FROM stats
        ORDER BY count DESC
      `),
      
      // Clients actifs - CORRIGÉ
      db.query(`
        SELECT 
          COUNT(*) AS total_clients,
          COUNT(CASE WHEN statut = 'actif' THEN 1 END) AS clients_actifs,
          COUNT(CASE WHEN statut = 'inactif' THEN 1 END) AS clients_inactifs,
          COUNT(DISTINCT r.idclient) AS clients_avec_reservations
        FROM clients c
        LEFT JOIN reservation r ON c.idclient = r.idclient 
          AND r.statut = 'confirmée'
          AND ${periodCondition}
      `),
      
      // Occupation des terrains - CORRIGÉ
      db.query(`
        WITH occupation AS (
          SELECT 
            numeroterrain,
            COUNT(*) AS nb_reservations,
            COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_utilisees,
            COUNT(DISTINCT datereservation) AS jours_utilises
          FROM reservation
          WHERE statut = 'confirmée'
            AND ${periodCondition}
          GROUP BY numeroterrain
        )
        SELECT 
          COUNT(*) AS terrains_utilises,
          COALESCE(AVG(nb_reservations), 0) AS reservations_moyenne,
          COALESCE(AVG(heures_utilisees), 0) AS heures_moyennes,
          COALESCE(SUM(heures_utilisees), 0) AS heures_totales,
          COALESCE(AVG(heures_utilisees / NULLIF(jours_utilises, 0)), 0) AS heures_moyennes_par_jour,
          CASE 
            WHEN COUNT(*) > 0 AND SUM(jours_utilises) > 0 
            THEN ROUND((SUM(heures_utilisees) / (COUNT(*) * 12 * SUM(jours_utilises)) * 100)::numeric, 2)
            ELSE 0 
          END AS taux_occupation_moyen
        FROM occupation
      `),
      
      // Données temps réel - CORRIGÉ
      db.query(`
        SELECT 
          COALESCE((
            SELECT COUNT(DISTINCT numeroterrain) 
            FROM reservation 
            WHERE statut = 'confirmée'
              AND datereservation = CURRENT_DATE
              AND heurereservation <= CURRENT_TIME
              AND heurefin >= CURRENT_TIME
          ), 0) AS terrains_occupes_actuels,
          
          COALESCE((
            SELECT COUNT(*) 
            FROM reservation 
            WHERE statut = 'confirmée'
              AND datereservation = CURRENT_DATE
          ), 0) AS reservations_aujourdhui,
          
          COALESCE((
            SELECT SUM(tarif)
            FROM reservation 
            WHERE statut = 'confirmée'
              AND datereservation = CURRENT_DATE
          ), 0) AS revenu_aujourdhui,
          
          COALESCE((
            SELECT COUNT(*)
            FROM reservation 
            WHERE statut = 'confirmée'
              AND datereservation = CURRENT_DATE
              AND heurereservation BETWEEN CURRENT_TIME AND CURRENT_TIME + INTERVAL '2 hours'
          ), 0) AS reservations_prochaines
      `),
      
      // Tendances vs période précédente - CORRIGÉ
      db.query(`
        WITH periode_actuelle AS (
          SELECT 
            COUNT(*) AS reservations_count,
            COALESCE(SUM(tarif), 0) AS revenu_total,
            COUNT(DISTINCT idclient) AS clients_uniques
          FROM reservation
          WHERE statut = 'confirmée'
            AND ${periodCondition}
        ),
        periode_precedente AS (
          SELECT 
            COUNT(*) AS reservations_count,
            COALESCE(SUM(tarif), 0) AS revenu_total,
            COUNT(DISTINCT idclient) AS clients_uniques
          FROM reservation
          WHERE statut = 'confirmée'
            AND ${previousPeriodCondition}
        )
        SELECT 
          COALESCE(pa.reservations_count, 0) AS reservations_actuelles,
          COALESCE(pp.reservations_count, 0) AS reservations_precedentes,
          COALESCE(pa.revenu_total, 0) AS revenu_actuel,
          COALESCE(pp.revenu_total, 0) AS revenu_precedent,
          COALESCE(pa.clients_uniques, 0) AS clients_actuels,
          COALESCE(pp.clients_uniques, 0) AS clients_precedents,
          CASE 
            WHEN COALESCE(pp.reservations_count, 0) = 0 THEN 100
            ELSE ROUND(((COALESCE(pa.reservations_count, 0) - COALESCE(pp.reservations_count, 0)) * 100.0 / NULLIF(COALESCE(pp.reservations_count, 0), 0))::numeric, 1)
          END AS evolution_reservations,
          CASE 
            WHEN COALESCE(pp.revenu_total, 0) = 0 THEN 100
            ELSE ROUND(((COALESCE(pa.revenu_total, 0) - COALESCE(pp.revenu_total, 0)) * 100.0 / NULLIF(COALESCE(pp.revenu_total, 0), 0))::numeric, 1)
          END AS evolution_revenus
        FROM periode_actuelle pa, periode_precedente pp
      `)
    ]);

    // Transformation sécurisée des données
    const stats = {
      periode: periode,
      revenus: {
        total: parseFloat(revenusResult.rows[0]?.revenu_total || 0),
        moyenne: parseFloat(revenusResult.rows[0]?.revenu_moyen || 0),
        maximum: parseFloat(revenusResult.rows[0]?.revenu_max || 0),
        minimum: parseFloat(revenusResult.rows[0]?.revenu_min || 0),
        reservations: parseInt(revenusResult.rows[0]?.nb_reservations || 0)
      },
      reservations: {
        par_statut: reservationsResult.rows.map(row => ({
          statut: row.statut,
          count: parseInt(row.count || 0),
          percentage: parseFloat(row.percentage || 0)
        })),
        total: reservationsResult.rows.reduce((sum, row) => sum + parseInt(row.count || 0), 0)
      },
      clients: {
        total: parseInt(clientsResult.rows[0]?.total_clients || 0),
        actifs: parseInt(clientsResult.rows[0]?.clients_actifs || 0),
        inactifs: parseInt(clientsResult.rows[0]?.clients_inactifs || 0),
        avec_reservations: parseInt(clientsResult.rows[0]?.clients_avec_reservations || 0)
      },
      terrains: {
        utilises: parseInt(terrainsResult.rows[0]?.terrains_utilises || 0),
        reservations_moyenne: parseFloat(terrainsResult.rows[0]?.reservations_moyenne || 0),
        heures_moyennes: parseFloat(terrainsResult.rows[0]?.heures_moyennes || 0),
        heures_totales: parseFloat(terrainsResult.rows[0]?.heures_totales || 0),
        taux_occupation_moyen: parseFloat(terrainsResult.rows[0]?.taux_occupation_moyen || 0)
      },
      temps_reel: {
        terrains_occupes: parseInt(tempsReelResult.rows[0]?.terrains_occupes_actuels || 0),
        reservations_aujourdhui: parseInt(tempsReelResult.rows[0]?.reservations_aujourdhui || 0),
        revenu_aujourdhui: parseFloat(tempsReelResult.rows[0]?.revenu_aujourdhui || 0),
        reservations_prochaines: parseInt(tempsReelResult.rows[0]?.reservations_prochaines || 0)
      },
      tendances: {
        evolution_reservations: parseFloat(tendancesResult.rows[0]?.evolution_reservations || 0),
        evolution_revenus: parseFloat(tendancesResult.rows[0]?.evolution_revenus || 0),
        reservations_actuelles: parseInt(tendancesResult.rows[0]?.reservations_actuelles || 0),
        reservations_precedentes: parseInt(tendancesResult.rows[0]?.reservations_precedentes || 0)
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

// 📈 Statistiques détaillées par terrain - CORRIGÉ
router.get('/terrains', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    const periodCondition = getPeriodCondition(periode);

    const sql = `
      SELECT 
        numeroterrain,
        COALESCE(typeterrain, 'Non spécifié') AS typeterrain,
        COALESCE(nomterrain, 'Terrain ' || numeroterrain) AS nomterrain,
        COUNT(*) AS nb_reservations,
        COALESCE(SUM(tarif), 0) AS revenu_total,
        COALESCE(AVG(tarif), 0) AS revenu_moyen,
        COUNT(DISTINCT datereservation) AS jours_utilises,
        COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_utilisees,
        CASE 
          WHEN COUNT(DISTINCT datereservation) > 0 AND COUNT(DISTINCT numeroterrain) > 0
          THEN ROUND(
            (COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) 
             / 
             NULLIF(COUNT(DISTINCT datereservation) * 12, 0)
            ) * 100, 2
          )
          ELSE 0
        END AS taux_occupation,
        COUNT(DISTINCT idclient) AS clients_uniques,
        COALESCE(MAX(tarif), 0) AS revenu_max,
        COALESCE(MIN(tarif), 0) AS revenu_min
      FROM reservation
      WHERE statut = 'confirmée'
        AND ${periodCondition}
      GROUP BY numeroterrain, typeterrain, nomterrain
      ORDER BY revenu_total DESC
    `;

    const result = await db.query(sql);

    // Calcul des statistiques globales
    const stats = {
      total_terrains: result.rows.length,
      revenu_total: result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_total || 0), 0),
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations || 0), 0),
      taux_occupation_moyen: result.rows.length > 0 ? 
        Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.taux_occupation || 0), 0) / result.rows.length) : 0,
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

// 📊 Analytics clients - CORRIGÉ
router.get('/clients', async (req, res) => {
  try {
    const { periode = 'mois', top = 10 } = req.query;
    const periodCondition = getPeriodCondition(periode);

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
        COALESCE(AVG(r.tarif), 0) AS montant_moyen,
        MIN(r.datereservation) AS premiere_reservation,
        MAX(r.datereservation) AS derniere_reservation,
        COUNT(DISTINCT r.numeroterrain) AS terrains_differents
      FROM clients c
      LEFT JOIN reservation r ON c.idclient = r.idclient 
        AND r.statut = 'confirmée'
        AND ${periodCondition}
      GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
      HAVING COUNT(r.numeroreservations) > 0
      ORDER BY montant_total DESC
      LIMIT $1
    `;

    const result = await db.query(sql, [parseInt(top)]);

    const stats = {
      total_clients_actifs: result.rows.length,
      revenu_total: result.rows.reduce((sum, row) => sum + parseFloat(row.montant_total || 0), 0),
      reservations_total: result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations || 0), 0),
      client_plus_fidele: result.rows[0] || null,
      valeur_moyenne_client: result.rows.length > 0 ? 
        Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.montant_total || 0), 0) / result.rows.length) : 0
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

// 🕒 Prévisions intelligentes - CORRIGÉ
router.get('/previsions/intelligentes', async (req, res) => {
  try {
    const { jours = 30 } = req.query;

    const sql = `
      WITH historique AS (
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
        SELECT 
          jour_semaine,
          COALESCE(AVG(reservations_count), 0) AS reservations_moyennes,
          COALESCE(AVG(revenu_total), 0) AS revenu_moyen,
          COALESCE(AVG(terrains_utilises), 0) AS terrains_moyens
        FROM historique
        GROUP BY jour_semaine
      ),
      future_dates AS (
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
        COALESCE(m.reservations_moyennes, 0) AS reservations_prevues,
        COALESCE(m.revenu_moyen, 0) AS revenu_prevue,
        COALESCE(m.terrains_moyens, 0) AS terrains_prevus,
        CASE 
          WHEN COALESCE(m.reservations_moyennes, 0) >= 8 THEN 'Très élevée'
          WHEN COALESCE(m.reservations_moyennes, 0) >= 5 THEN 'Élevée'
          WHEN COALESCE(m.reservations_moyennes, 0) >= 3 THEN 'Moyenne'
          ELSE 'Faible'
        END AS niveau_activite_prevue
      FROM future_dates fd
      LEFT JOIN moyennes m ON EXTRACT(DOW FROM fd.future_date) = m.jour_semaine
      ORDER BY fd.future_date ASC
    `;

    const result = await db.query(sql);

    const stats = {
      periode_prevision: parseInt(jours),
      reservations_total_prevues: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.reservations_prevues || 0), 0)),
      revenu_total_prevue: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_prevue || 0), 0)),
      jours_activite_elevee: result.rows.filter(row => 
        row.niveau_activite_prevue === 'Élevée' || row.niveau_activite_prevue === 'Très élevée'
      ).length,
      meilleur_jour: result.rows.reduce((max, row) => 
        parseFloat(row.reservations_prevues || 0) > parseFloat(max.reservations_prevues || 0) ? row : max, 
        result.rows[0] || {}
      ),
      pire_jour: result.rows.reduce((min, row) => 
        parseFloat(row.reservations_prevues || 0) < parseFloat(min.reservations_prevues || 0) ? row : min, 
        result.rows[0] || {}
      )
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

// 📊 Statistiques de performance - CORRIGÉ
router.get('/performance', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    const periodCondition = getPeriodCondition(periode);

    const sql = `
      SELECT 
        -- Performance financière
        COALESCE((
          SELECT SUM(tarif) 
          FROM reservation 
          WHERE statut = 'confirmée' 
          AND ${periodCondition}
        ), 0) AS revenu_total,
        
        COALESCE((
          SELECT COUNT(*) 
          FROM reservation 
          WHERE statut = 'confirmée' 
          AND ${periodCondition}
        ), 0) AS reservations_confirmees,
        
        COALESCE((
          SELECT COUNT(*) 
          FROM reservation 
          WHERE statut = 'annulée' 
          AND ${periodCondition}
        ), 0) AS reservations_annulees,
        
        -- Performance occupation
        COALESCE((
          SELECT COUNT(DISTINCT numeroterrain) 
          FROM reservation 
          WHERE statut = 'confirmée' 
          AND ${periodCondition}
        ), 0) AS terrains_utilises,
        
        COALESCE((
          SELECT COUNT(DISTINCT datereservation) 
          FROM reservation 
          WHERE statut = 'confirmée' 
          AND ${periodCondition}
        ), 0) AS jours_activite,
        
        -- Performance clients
        COALESCE((
          SELECT COUNT(DISTINCT idclient) 
          FROM reservation 
          WHERE statut = 'confirmée' 
          AND ${periodCondition}
        ), 0) AS clients_actifs,
        
        COALESCE((
          SELECT COUNT(*) 
          FROM clients 
          WHERE statut = 'actif'
        ), 0) AS clients_total,
        
        -- Taux de conversion
        CASE 
          WHEN (
            SELECT COUNT(*) 
            FROM reservation 
            WHERE ${periodCondition}
          ) > 0 
          THEN ROUND((
            SELECT COUNT(*) FILTER (WHERE statut = 'confirmée') * 100.0 / 
            COUNT(*)
            FROM reservation 
            WHERE ${periodCondition}
          )::numeric, 1)
          ELSE 0 
        END AS taux_confirmation
    `;

    const result = await db.query(sql);
    const data = result.rows[0];

    const reservationsTotales = parseInt(data.reservations_confirmees || 0) + parseInt(data.reservations_annulees || 0);
    const tauxAnnulation = reservationsTotales > 0 ? 
      Math.round((parseInt(data.reservations_annulees || 0) * 100) / reservationsTotales) : 0;

    const stats = {
      performance_financiere: {
        revenu_total: parseFloat(data.revenu_total || 0),
        reservations_confirmees: parseInt(data.reservations_confirmees || 0),
        reservations_annulees: parseInt(data.reservations_annulees || 0),
        taux_annulation: tauxAnnulation
      },
      performance_occupation: {
        terrains_utilises: parseInt(data.terrains_utilises || 0),
        jours_activite: parseInt(data.jours_activite || 0),
        taux_utilisation_terrains: data.terrains_utilises > 0 ? Math.round((data.terrains_utilises * 100) / data.terrains_utilises) : 0
      },
      performance_clients: {
        clients_actifs: parseInt(data.clients_actifs || 0),
        clients_total: parseInt(data.clients_total || 0),
        taux_fidelisation: parseInt(data.clients_total || 0) > 0 ? 
          Math.round((parseInt(data.clients_actifs || 0) * 100) / parseInt(data.clients_total || 0)) : 0
      },
      indicateurs: {
        taux_confirmation: parseFloat(data.taux_confirmation || 0),
        revenu_moyen_par_client: parseInt(data.clients_actifs || 0) > 0 ? 
          Math.round(parseFloat(data.revenu_total || 0) / parseInt(data.clients_actifs || 0)) : 0,
        reservations_moyennes_par_jour: parseInt(data.jours_activite || 0) > 0 ? 
          Math.round(parseInt(data.reservations_confirmees || 0) / parseInt(data.jours_activite || 0)) : 0
      }
    };

    res.json({
      success: true,
      data: stats,
      periode: periode
    });

  } catch (error) {
    console.error('❌ Erreur statistiques performance:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔍 Test de connexion et données de base
router.get('/test', async (req, res) => {
  try {
    // Test des données de base
    const [reservationsCount, clientsCount, revenusTotal] = await Promise.all([
      db.query("SELECT COUNT(*) as count FROM reservation WHERE statut = 'confirmée'"),
      db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'actif'"),
      db.query("SELECT COALESCE(SUM(tarif), 0) as total FROM reservation WHERE statut = 'confirmée'")
    ]);

    res.json({
      success: true,
      data: {
        reservations_total: parseInt(reservationsCount.rows[0]?.count || 0),
        clients_actifs: parseInt(clientsCount.rows[0]?.count || 0),
        revenus_totaux: parseFloat(revenusTotal.rows[0]?.total || 0),
        statut_serveur: 'OK',
        heure_serveur: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erreur test:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur de connexion à la base de données',
      error: error.message
    });
  }
});

export default router;