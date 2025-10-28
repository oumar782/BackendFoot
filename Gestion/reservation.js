import express from 'express';
import db from '../db.js';
import { sendReservationConfirmation, checkEmailConfiguration } from '../services/emailService.js';

const router = express.Router();

// 📊 STATISTIQUES ET ANALYTIQUES

// 📌 ROUTE PRINCIPALE POUR LE TABLEAU DE BORD
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;

    // 1. Statistiques de base
    const statsBase = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE statut = 'confirmée' AND datereservation = CURRENT_DATE) AS reservations_aujourdhui,
        COALESCE(SUM(tarif) FILTER (WHERE statut = 'confirmée' AND datereservation = CURRENT_DATE), 0) AS revenu_aujourdhui,
        COUNT(*) FILTER (WHERE statut = 'confirmée' AND datereservation >= date_trunc('month', CURRENT_DATE)) AS reservations_mois,
        COALESCE(SUM(tarif) FILTER (WHERE statut = 'confirmée' AND datereservation >= date_trunc('month', CURRENT_DATE)), 0) AS revenu_mois,
        COUNT(*) FILTER (WHERE statut = 'confirmée' AND datereservation >= date_trunc('year', CURRENT_DATE)) AS reservations_annee,
        COALESCE(SUM(tarif) FILTER (WHERE statut = 'confirmée' AND datereservation >= date_trunc('year', CURRENT_DATE)), 0) AS revenu_annee,
        COUNT(DISTINCT nomterrain) FILTER (WHERE statut = 'confirmée' AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS terrains_actifs_semaine,
        COUNT(*) FILTER (WHERE statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS annulations_semaine,
        COUNT(DISTINCT email) FILTER (WHERE statut = 'confirmée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days') AS clients_uniques_30j
      FROM reservation
    `);

    // 2. Terrains occupés actuellement
    const terrainsOccupes = await db.query(`
      SELECT COUNT(DISTINCT nomterrain) AS terrains_occupes_actuels
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heurereservation <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
    `);

    // 3. Taux de remplissage
    const tauxRemplissage = await db.query(`
      WITH reservations_recentes AS (
        SELECT 
          datereservation,
          COUNT(*) as nb_reservations,
          COUNT(DISTINCT nomterrain) as nb_terrains_utilises
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE
        GROUP BY datereservation
      )
      SELECT 
        CASE 
          WHEN COUNT(*) > 0 THEN
            ROUND(AVG(
              CASE 
                WHEN nb_terrains_utilises > 0 
                THEN (nb_reservations * 100.0) / (nb_terrains_utilises * 3)
                ELSE 0
              END
            ), 2)
          ELSE 0
        END as taux_remplissage_moyen
      FROM reservations_recentes
      WHERE nb_terrains_utilises > 0
    `);

    // 4. Données pour les tendances
    const tendances = await db.query(`
      WITH periode_actuelle AS (
        SELECT 
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as revenus
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      ),
      periode_precedente AS (
        SELECT 
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as revenus
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '30 days'
      )
      SELECT 
        pa.reservations as resa_actuelles,
        pa.revenus as revenus_actuels,
        pp.reservations as resa_precedentes,
        pp.revenus as revenus_precedents,
        CASE 
          WHEN pp.reservations > 0 
          THEN ROUND(((pa.reservations - pp.reservations) * 100.0 / pp.reservations), 2)
          ELSE 0
        END as evolution_reservations,
        CASE 
          WHEN pp.revenus > 0 
          THEN ROUND(((pa.revenus - pp.revenus) * 100.0 / pp.revenus), 2)
          ELSE 0
        END as evolution_revenus
      FROM periode_actuelle pa, periode_precedente pp
    `);

    const stats = statsBase.rows[0];
    const evolution = tendances.rows[0];

    const data = {
      revenus_mois: stats.revenu_mois || 0,
      revenus_aujourdhui: stats.revenu_aujourdhui || 0,
      revenus_annee: stats.revenu_annee || 0,
      reservations_mois: stats.reservations_mois || 0,
      reservations_aujourdhui: stats.reservations_aujourdhui || 0,
      reservations_annee: stats.reservations_annee || 0,
      confirmes_aujourdhui: stats.reservations_aujourdhui || 0,
      terrains_occupes_actuels: terrainsOccupes.rows[0]?.terrains_occupes_actuels || 0,
      clients_actifs: stats.terrains_actifs_semaine || 0,
      clients_uniques: stats.clients_uniques_30j || 0,
      annulations_semaine: stats.annulations_semaine || 0,
      taux_remplissage: tauxRemplissage.rows[0]?.taux_remplissage_moyen || 0,
      trends: {
        revenus: {
          isPositive: (evolution?.evolution_revenus || 0) >= 0,
          value: Math.abs(evolution?.evolution_revenus || 0)
        },
        reservations: {
          isPositive: (evolution?.evolution_reservations || 0) >= 0,
          value: Math.abs(evolution?.evolution_reservations || 0)
        },
        clients: {
          isPositive: (stats.clients_uniques_30j || 0) > 10,
          value: Math.min((stats.clients_uniques_30j || 0) / 2, 20)
        },
        remplissage: {
          isPositive: (tauxRemplissage.rows[0]?.taux_remplissage_moyen || 0) > 50,
          value: Math.round(tauxRemplissage.rows[0]?.taux_remplissage_moyen || 0)
        }
      }
    };

    res.json({
      success: true,
      periode: periode,
      data: data,
      metriques: {
        date_actualisation: new Date().toISOString(),
        periode_calcul: '30 derniers jours',
        heure_serveur: new Date().toLocaleTimeString('fr-FR')
      }
    });

  } catch (error) {
    console.error('❌ Erreur dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 STATISTIQUES TEMPS RÉEL
router.get('/statistiques-temps-reel', async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE statut = 'confirmée' AND datereservation = CURRENT_DATE) AS reservations_aujourdhui,
        COALESCE(SUM(tarif) FILTER (WHERE statut = 'confirmée' AND datereservation = CURRENT_DATE), 0) AS revenu_aujourdhui,
        COUNT(*) FILTER (WHERE statut = 'confirmée' AND datereservation >= date_trunc('month', CURRENT_DATE)) AS reservations_mois,
        COALESCE(SUM(tarif) FILTER (WHERE statut = 'confirmée' AND datereservation >= date_trunc('month', CURRENT_DATE)), 0) AS revenu_mois,
        COUNT(DISTINCT nomterrain) FILTER (WHERE statut = 'confirmée' AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS terrains_actifs_semaine,
        COUNT(*) FILTER (WHERE statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS annulations_semaine
      FROM reservation
    `);

    const terrainsOccupes = await db.query(`
      SELECT COUNT(DISTINCT nomterrain) AS terrains_occupes_actuels
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heurereservation <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
    `);

    const result = {
      terrains_occupes_actuels: terrainsOccupes.rows[0]?.terrains_occupes_actuels || 0,
      annulations_semaine: stats.rows[0]?.annulations_semaine || 0,
      terrains_actifs_semaine: stats.rows[0]?.terrains_actifs_semaine || 0,
      reservations_aujourdhui: stats.rows[0]?.reservations_aujourdhui || 0,
      revenu_aujourdhui: stats.rows[0]?.revenu_aujourdhui || 0,
      reservations_mois: stats.rows[0]?.reservations_mois || 0,
      revenu_mois: stats.rows[0]?.revenu_mois || 0,
      date_actualisation: new Date().toISOString()
    };

    res.json({
      success: true,
      data: result,
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

// 📌 REVENUS TOTAUX
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
        case 'annee':
          periodeCondition = `AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '365 days'`;
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
        MIN(tarif) AS revenu_min,
        COUNT(DISTINCT email) AS clients_uniques
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

// 📌 TAUX DE REMPLISSAGE
router.get('/taux-remplissage', async (req, res) => {
  try {
    const { type = 'mensuel' } = req.query;

    let sql = '';
    
    if (type === 'journalier') {
      sql = `
        WITH dates_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '15 days', 
            CURRENT_DATE + INTERVAL '15 days', 
            '1 day'::interval
          )::date AS date_jour
        ),
        reservations_par_jour AS (
          SELECT 
            datereservation,
            COUNT(*) as nb_reservations,
            COUNT(DISTINCT nomterrain) as nb_terrains
          FROM reservation
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '15 days' AND CURRENT_DATE + INTERVAL '15 days'
          GROUP BY datereservation
        )
        SELECT 
          ds.date_jour AS date,
          TO_CHAR(ds.date_jour, 'DD/MM') AS date_formattee,
          EXTRACT(DOW FROM ds.date_jour) AS jour_semaine,
          COALESCE(rj.nb_reservations, 0) AS nb_reservations,
          COALESCE(rj.nb_terrains, 0) AS nb_terrains,
          CASE 
            WHEN COALESCE(rj.nb_terrains, 0) > 0 
            THEN ROUND((COALESCE(rj.nb_reservations, 0) * 100.0 / (rj.nb_terrains * 3)), 2)
            ELSE 0
          END AS taux_remplissage,
          COALESCE((
            SELECT SUM(tarif) 
            FROM reservation r2 
            WHERE r2.datereservation = ds.date_jour 
            AND r2.statut = 'confirmée'
          ), 0) AS revenu_jour
        FROM dates_series ds
        LEFT JOIN reservations_par_jour rj ON ds.date_jour = rj.datereservation
        ORDER BY ds.date_jour ASC
      `;
    } else {
      sql = `
        WITH mois_series AS (
          SELECT 
            date_trunc('month', generate_series(
              CURRENT_DATE - INTERVAL '5 months', 
              CURRENT_DATE + INTERVAL '5 months', 
              '1 month'::interval
            )) AS debut_mois
        ),
        reservations_par_mois AS (
          SELECT 
            date_trunc('month', datereservation) AS debut_mois,
            COUNT(*) as nb_reservations,
            COUNT(DISTINCT nomterrain) as nb_terrains_moyen,
            COALESCE(SUM(tarif), 0) as revenu_mois
          FROM reservation
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '5 months' AND CURRENT_DATE + INTERVAL '5 months'
          GROUP BY date_trunc('month', datereservation)
        )
        SELECT 
          ms.debut_mois AS date_debut_mois,
          (ms.debut_mois + INTERVAL '1 month - 1 day')::date AS date_fin_mois,
          TO_CHAR(ms.debut_mois, 'MM/YYYY') AS periode_mois,
          TO_CHAR(ms.debut_mois, 'Month YYYY') AS periode_mois_complet,
          COALESCE(rm.nb_reservations, 0) AS nb_reservations,
          COALESCE(rm.nb_terrains_moyen, 0) AS nb_terrains_moyen,
          COALESCE(rm.revenu_mois, 0) AS revenu_mois,
          CASE 
            WHEN COALESCE(rm.nb_terrains_moyen, 0) > 0 
            THEN ROUND((COALESCE(rm.nb_reservations, 0) * 100.0 / (rm.nb_terrains_moyen * 90)), 2)
            ELSE 0
          END AS taux_remplissage
        FROM mois_series ms
        LEFT JOIN reservations_par_mois rm ON ms.debut_mois = rm.debut_mois
        ORDER BY ms.debut_mois ASC
      `;
    }

    const result = await db.query(sql);

    const tauxList = result.rows.map(row => parseFloat(row.taux_remplissage) || 0).filter(t => t > 0);
    const tauxMoyen = tauxList.length > 0 ? 
      Math.round(tauxList.reduce((a, b) => a + b, 0) / tauxList.length) : 0;

    const stats = {
      taux_remplissage_moyen: tauxMoyen,
      periode_max_remplissage: result.rows.reduce((max, row) => {
        const taux = parseFloat(row.taux_remplissage) || 0;
        const maxTaux = parseFloat(max.taux_remplissage) || 0;
        return taux > maxTaux ? row : max;
      }, result.rows[0]),
      periode_min_remplissage: result.rows.reduce((min, row) => {
        const taux = parseFloat(row.taux_remplissage) || 0;
        const minTaux = parseFloat(min.taux_remplissage) || 0;
        return taux < minTaux ? row : min;
      }, result.rows[0]),
      total_periodes: result.rows.length
    };

    res.json({
      success: true,
      type_remplissage: type,
      data: result.rows,
      statistiques: stats,
      metriques: {
        date_generation: new Date().toISOString(),
        periode_analyse: type === 'journalier' ? '30 jours' : '10 mois'
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

// 📌 PRÉVISIONS DÉTAILLÉES
router.get('/previsions/detaillees', async (req, res) => {
  try {
    const { jours = 14 } = req.query;
    const joursNumber = parseInt(jours);

    const sql = `
      WITH reservations_futures AS (
        SELECT 
          datereservation,
          COUNT(*) as nb_reservations,
          COUNT(DISTINCT nomterrain) as nb_terrains,
          COALESCE(SUM(tarif), 0) as revenu_attendu,
          STRING_AGG(DISTINCT typeterrain, ', ') as types_terrains
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE
          AND datereservation <= CURRENT_DATE + INTERVAL '${joursNumber} days'
        GROUP BY datereservation
      )
      SELECT 
        rf.datereservation,
        rf.nb_reservations,
        rf.nb_terrains,
        rf.revenu_attendu,
        rf.types_terrains,
        TO_CHAR(rf.datereservation, 'DD Mon') AS date_formattee,
        EXTRACT(DOW FROM rf.datereservation) AS jour_semaine,
        CASE 
          WHEN rf.nb_terrains > 0 
          THEN ROUND((rf.nb_reservations * 100.0 / (rf.nb_terrains * 3)), 2)
          ELSE 0
        END AS taux_occupation_prevu,
        CASE 
          WHEN rf.nb_reservations >= 8 THEN 'Élevée'
          WHEN rf.nb_reservations >= 4 THEN 'Moyenne'
          ELSE 'Faible'
        END AS niveau_occupation
      FROM reservations_futures rf
      ORDER BY rf.datereservation ASC
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
        new Date(row.datereservation).toISOString().split('T')[0] === dateStr
      );
      
      if (reservationExistante) {
        toutesLesDates.push(reservationExistante);
      } else {
        toutesLesDates.push({
          datereservation: dateStr,
          taux_occupation_prevu: 0,
          nb_reservations: 0,
          revenu_attendu: 0,
          nb_terrains: 0,
          types_terrains: 'Aucun',
          date_formattee: dateFormatee,
          jour_semaine: jourSemaine,
          niveau_occupation: 'Faible'
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
      jours_avec_reservations: toutesLesDates.filter(row => row.nb_reservations > 0).length
    };

    res.json({
      success: true,
      data: toutesLesDates,
      periode: joursNumber,
      statistiques: stats,
      metriques: {
        date_debut: today.toISOString().split('T')[0],
        date_fin: dateFin.toISOString().split('T')[0],
        total_jours: toutesLesDates.length
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

// 📌 STATISTIQUES AVANCÉES
router.get('/statistiques-avancees', async (req, res) => {
  try {
    const performance = await db.query(`
      SELECT 
        ROUND(
          (COUNT(*) FILTER (WHERE statut = 'confirmée') * 100.0 / NULLIF(COUNT(*), 0)
        ), 2) AS taux_confirmation,
        ROUND(
          (COUNT(*) FILTER (WHERE statut = 'annulée') * 100.0 / NULLIF(COUNT(*), 0)
        ), 2) AS taux_annulation,
        ROUND(AVG(tarif) FILTER (WHERE statut = 'confirmée'), 2) AS revenu_moyen,
        ROUND(
          COUNT(*) FILTER (WHERE statut = 'confirmée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days') / 30.0, 
          1
        ) AS reservations_par_jour_moyen,
        COUNT(DISTINCT email) FILTER (WHERE statut = 'confirmée') AS total_clients,
        COUNT(DISTINCT email) FILTER (
          WHERE statut = 'confirmée' 
          AND email IN (
            SELECT email 
            FROM reservation 
            WHERE statut = 'confirmée' 
            GROUP BY email 
            HAVING COUNT(*) > 1
          )
        ) AS clients_fideles
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
    `);

    const topTerrains = await db.query(`
      SELECT 
        nomterrain,
        COUNT(*) as nb_reservations,
        COALESCE(SUM(tarif), 0) as revenu_total,
        ROUND(AVG(tarif), 2) as revenu_moyen
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY nomterrain
      ORDER BY nb_reservations DESC
      LIMIT 10
    `);

    const horairesPopulaires = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure_debut,
        COUNT(*) as nb_reservations,
        ROUND(AVG(tarif), 2) as tarif_moyen
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY nb_reservations DESC
      LIMIT 8
    `);

    res.json({
      success: true,
      data: {
        performance: performance.rows[0],
        top_terrains: topTerrains.rows,
        horaires_populaires: horairesPopulaires.rows
      },
      metriques: {
        periode_analyse: '90 derniers jours',
        date_generation: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erreur statistiques avancées:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📧 GESTION DES EMAILS
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

router.post('/email/test', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email de test requis'
      });
    }

    const testReservation = {
      id: 'test-' + Date.now(),
      datereservation: new Date().toISOString().split('T')[0],
      heurereservation: '14:00',
      heurefin: '16:00',
      statut: 'confirmée',
      nomclient: 'Test',
      prenom: 'Utilisateur',
      email: email,
      telephone: '0123456789',
      typeterrain: 'Synthétique',
      tarif: 150,
      nomterrain: 'Stade Principal',
      surface: '11X11'
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

// 🎯 CRUD COMPLET DES RÉSERVATIONS

// 📌 Récupérer les réservations
router.get('/', async (req, res) => {
  try {
    const { nom, email, statut, date, page = 1, limit = 10 } = req.query;

    let sql = `
      SELECT 
        numeroreservations as id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
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

    const countSql = `SELECT COUNT(*) as total_count FROM (${sql}) as subquery`;
    const countResult = await db.query(countSql, params);
    const totalCount = parseInt(countResult.rows[0].total_count);

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
    console.error('❌ Erreur récupération réservations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Récupérer une réservation spécifique
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT 
        numeroreservations as id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
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
    console.error('❌ Erreur récupération réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Créer une réservation
router.post('/', async (req, res) => {
  try {
    const {
      datereservation,
      heurereservation,
      statut,
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

    console.log('📝 Données reçues:', req.body);

    // Validation des champs obligatoires
    const champsObligatoires = [
      { nom: 'datereservation', valeur: datereservation, message: 'Date de réservation' },
      { nom: 'heurereservation', valeur: heurereservation, message: 'Heure de début' },
      { nom: 'heurefin', valeur: heurefin, message: 'Heure de fin' },
      { nom: 'statut', valeur: statut, message: 'Statut' },
      { nom: 'nomclient', valeur: nomclient, message: 'Nom du client' },
      { nom: 'prenom', valeur: prenom, message: 'Prénom du client' },
      { nom: 'email', valeur: email, message: 'Email' },
      { nom: 'telephone', valeur: telephone, message: 'Téléphone' },
      { nom: 'typeterrain', valeur: typeterrain, message: 'Type de terrain' },
      { nom: 'tarif', valeur: tarif, message: 'Tarif' },
      { nom: 'surface', valeur: surface, message: 'Surface' },
      { nom: 'nomterrain', valeur: nomterrain, message: 'Nom du terrain' }
    ];

    const champsManquants = champsObligatoires.filter(champ => 
      !champ.valeur || champ.valeur.toString().trim() === ''
    );

    if (champsManquants.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Champs obligatoires manquants: ${champsManquants.map(c => c.message).join(', ')}`
      });
    }

    // Validations supplémentaires
    if (!['Normal', 'Synthétique'].includes(typeterrain)) {
      return res.status(400).json({
        success: false,
        message: 'Type de terrain invalide. Doit être "Normal" ou "Synthétique".'
      });
    }

    if (!['7X7', '9X9', '11X11'].includes(surface)) {
      return res.status(400).json({
        success: false,
        message: 'Surface invalide. Doit être "7X7", "9X9" ou "11X11".'
      });
    }

    if (!email.includes('@')) {
      return res.status(400).json({
        success: false,
        message: 'Format d\'email invalide.'
      });
    }

    const tarifNumerique = parseFloat(tarif);
    if (isNaN(tarifNumerique) || tarifNumerique <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Tarif invalide. Doit être un nombre positif.'
      });
    }

    const sql = `
      INSERT INTO reservation (
        datereservation, heurereservation, statut,
        nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING numeroreservations as id, *
    `;

    const params = [
      datereservation, 
      heurereservation, 
      statut,
      nomclient, 
      prenom, 
      email, 
      telephone, 
      typeterrain, 
      tarifNumerique, 
      surface, 
      heurefin, 
      nomterrain
    ];

    console.log('🚀 Exécution SQL avec params:', params);

    const result = await db.query(sql, params);
    const newReservation = result.rows[0];

    console.log('✅ Réservation créée:', newReservation);

    // Envoi d'email si confirmée
    let emailResult = null;
    const shouldSendEmail = statut === 'confirmée' && email && email.includes('@');
    
    if (shouldSendEmail) {
      try {
        emailResult = await sendReservationConfirmation(newReservation);
        console.log('📧 Email envoyé:', emailResult);
      } catch (emailError) {
        console.error('❌ Erreur envoi email:', emailError);
        emailResult = { success: false, error: emailError.message };
      }
    }

    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès' + (emailResult?.success ? ' et email envoyé' : ''),
      data: newReservation,
      email: emailResult
    });

  } catch (error) {
    console.error('❌ Erreur création réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message,
      details: error.detail
    });
  }
});

// 📌 Mettre à jour une réservation
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      datereservation,
      heurereservation,
      statut,
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

    console.log('📝 Données reçues pour modification:', req.body);

    // Validation des champs obligatoires
    const champsObligatoires = [
      { nom: 'datereservation', valeur: datereservation, message: 'Date de réservation' },
      { nom: 'heurereservation', valeur: heurereservation, message: 'Heure de début' },
      { nom: 'heurefin', valeur: heurefin, message: 'Heure de fin' },
      { nom: 'statut', valeur: statut, message: 'Statut' },
      { nom: 'nomclient', valeur: nomclient, message: 'Nom du client' },
      { nom: 'prenom', valeur: prenom, message: 'Prénom du client' },
      { nom: 'email', valeur: email, message: 'Email' },
      { nom: 'telephone', valeur: telephone, message: 'Téléphone' },
      { nom: 'typeterrain', valeur: typeterrain, message: 'Type de terrain' },
      { nom: 'tarif', valeur: tarif, message: 'Tarif' },
      { nom: 'surface', valeur: surface, message: 'Surface' },
      { nom: 'nomterrain', valeur: nomterrain, message: 'Nom du terrain' }
    ];

    const champsManquants = champsObligatoires.filter(champ => 
      !champ.valeur || champ.valeur.toString().trim() === ''
    );

    if (champsManquants.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Champs obligatoires manquants: ${champsManquants.map(c => c.message).join(', ')}`
      });
    }

    // Récupérer l'ancienne réservation
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

    // Validation du tarif
    const tarifNumerique = parseFloat(tarif);
    if (isNaN(tarifNumerique) || tarifNumerique <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Tarif invalide. Doit être un nombre positif.'
      });
    }

    const sql = `
      UPDATE reservation 
      SET 
        datereservation = $1,
        heurereservation = $2,
        statut = $3,
        nomclient = $4,
        prenom = $5,
        email = $6,
        telephone = $7,
        typeterrain = $8,
        tarif = $9,
        surface = $10,
        heurefin = $11,
        nomterrain = $12
      WHERE numeroreservations = $13
      RETURNING numeroreservations as id, *
    `;

    const params = [
      datereservation, 
      heurereservation, 
      statut,
      nomclient, 
      prenom, 
      email, 
      telephone, 
      typeterrain, 
      tarifNumerique, 
      surface, 
      heurefin, 
      nomterrain, 
      id
    ];

    console.log('🚀 Exécution SQL UPDATE avec params:', params);

    const result = await db.query(sql, params);
    const updatedReservation = result.rows[0];

    console.log('✅ Réservation modifiée:', updatedReservation);

    // Envoi d'email si statut changé vers confirmée
    let emailResult = null;
    const becameConfirmed = oldStatus !== 'confirmée' && statut === 'confirmée';
    const hasValidEmail = email && email.includes('@');
    
    if (becameConfirmed && hasValidEmail) {
      try {
        emailResult = await sendReservationConfirmation(updatedReservation);
        console.log('📧 Email envoyé:', emailResult);
      } catch (emailError) {
        console.error('❌ Erreur envoi email:', emailError);
        emailResult = { success: false, error: emailError.message };
      }
    }

    res.json({
      success: true,
      message: 'Réservation mise à jour avec succès' + (emailResult?.success ? ' et email envoyé' : ''),
      data: updatedReservation,
      email: emailResult
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message,
      details: error.detail
    });
  }
});

// 📌 Supprimer une réservation
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

// 📌 Mettre à jour le statut
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

    // Récupérer l'ancienne réservation
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

    // Envoi d'email si statut changé vers confirmée
    let emailResult = null;
    const becameConfirmed = oldStatus !== 'confirmée' && statut === 'confirmée';
    const hasValidEmail = reservation.email && reservation.email.includes('@');
    
    if (becameConfirmed && hasValidEmail) {
      try {
        emailResult = await sendReservationConfirmation(reservation);
      } catch (emailError) {
        console.error('❌ Erreur envoi email:', emailError);
        emailResult = { success: false, error: emailError.message };
      }
    }

    res.json({
      success: true,
      message: 'Statut mis à jour avec succès' + (emailResult?.success ? ' et email envoyé' : ''),
      data: reservation,
      email: emailResult
    });

  } catch (error) {
    console.error('❌ Erreur mise à jour statut:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📌 Réservations d'aujourd'hui
router.get('/aujourd-hui/terrains', async (req, res) => {
  try {
    const sql = `
      SELECT 
        nomterrain,
        COUNT(*) as nb_reservations,
        STRING_AGG(
          CONCAT(heurereservation, '-', heurefin, ' (', nomclient, ')'), 
          ', '
        ) as creneaux_occupes
      FROM reservation 
      WHERE datereservation = CURRENT_DATE 
        AND statut = 'confirmée'
      GROUP BY nomterrain
      ORDER BY nomterrain
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