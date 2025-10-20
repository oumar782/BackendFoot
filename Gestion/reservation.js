import express from 'express';
import db from '../db.js';
import { sendReservationConfirmation, checkEmailConfiguration } from '../services/emailService.js';
const router = express.Router();

router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;

    // Fonction pour obtenir les dates selon la période
    const getDateRange = (period) => {
      const now = new Date();
      switch (period) {
        case 'jour':
          return {
            start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
            previousStart: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
            previousEnd: new Date(now.getFullYear(), now.getMonth(), now.getDate())
          };
        case 'semaine':
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Lundi
          return {
            start: new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate()),
            end: new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 7),
            previousStart: new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() - 7),
            previousEnd: new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate())
          };
        case 'annee':
          return {
            start: new Date(now.getFullYear(), 0, 1),
            end: new Date(now.getFullYear() + 1, 0, 1),
            previousStart: new Date(now.getFullYear() - 1, 0, 1),
            previousEnd: new Date(now.getFullYear(), 0, 1)
          };
        case 'mois':
        default:
          return {
            start: new Date(now.getFullYear(), now.getMonth(), 1),
            end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
            previousStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
            previousEnd: new Date(now.getFullYear(), now.getMonth(), 1)
          };
      }
    };

    const currentRange = getDateRange(periode);
    const previousRange = getDateRange(periode === 'mois' ? 'mois' : 
                                    periode === 'semaine' ? 'semaine' : 
                                    periode === 'annee' ? 'annee' : 'jour');

    // 1. Statistiques principales - AVEC PÉRIODE DYNAMIQUE
    const statsPrincipalesSql = `
      SELECT 
        -- Revenus période actuelle
        COALESCE(SUM(CASE WHEN datereservation >= $1 AND datereservation < $2 
          AND statut = 'confirmée' THEN tarif ELSE 0 END), 0) AS revenus_periode,
        
        -- Revenus année en cours (toujours utile)
        COALESCE(SUM(CASE WHEN datereservation >= date_trunc('year', CURRENT_DATE) 
          AND statut = 'confirmée' THEN tarif ELSE 0 END), 0) AS revenus_annee,
        
        -- Revenus aujourd'hui
        COALESCE(SUM(CASE WHEN datereservation = CURRENT_DATE 
          AND statut = 'confirmée' THEN tarif ELSE 0 END), 0) AS revenus_aujourdhui,
        
        -- Réservations période actuelle
        COUNT(CASE WHEN datereservation >= $1 AND datereservation < $2 
          AND statut = 'confirmée' THEN 1 END) AS reservations_periode,
        
        -- Réservations aujourd'hui
        COUNT(CASE WHEN datereservation = CURRENT_DATE 
          AND statut = 'confirmée' THEN 1 END) AS confirmes_aujourdhui,
        COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) AS reservations_aujourdhui,
        
        -- Clients actifs (30 derniers jours)
        COUNT(DISTINCT CASE WHEN datereservation >= CURRENT_DATE - INTERVAL '30 days' 
          AND statut = 'confirmée' THEN email END) AS clients_actifs,
        
        -- Terrains
        COUNT(DISTINCT numeroterrain) AS nb_terrains_total
      FROM reservation
      WHERE statut = 'confirmée'
    `;

    // 2. Taux de remplissage - ADAPTÉ À LA PÉRIODE
    const remplissageSql = periode === 'jour' ? `
      -- Taux de remplissage pour aujourd'hui
      WITH stats_terrains AS (
        SELECT 
          COUNT(DISTINCT numeroterrain) as nb_terrains_utilises,
          COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_reservees
        FROM reservation 
        WHERE statut = 'confirmée' 
          AND datereservation = CURRENT_DATE
      )
      SELECT 
        CASE 
          WHEN nb_terrains_utilises > 0 THEN
            CAST(
              (heures_reservees / (nb_terrains_utilises * 12)) * 100 AS NUMERIC(10,1)
            )
          ELSE 0 
        END AS taux_remplissage,
        nb_terrains_utilises,
        heures_reservees
      FROM stats_terrains
    ` : `
      -- Taux de remplissage moyen pour les autres périodes
      SELECT 
        CAST(
          (COUNT(*) * 100.0 / (SELECT COUNT(DISTINCT numeroterrain) FROM reservation WHERE statut = 'confirmée'))
        AS NUMERIC(10,1)) AS taux_remplissage,
        COUNT(DISTINCT numeroterrain) as nb_terrains_utilises,
        COUNT(*) as heures_reservees
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= $1 AND datereservation < $2
    `;

    // 3. Tendances - COMPARAISON AVEC PÉRIODE PRÉCÉDENTE
    const tendancesSql = `
      -- Revenus
      WITH revenus_actuels AS (
        SELECT COALESCE(SUM(tarif), 0) AS total
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= $1 AND datereservation < $2
      ),
      revenus_precedents AS (
        SELECT COALESCE(SUM(tarif), 0) AS total
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= $3 AND datereservation < $4
      ),
      
      -- Réservations
      reservations_actuelles AS (
        SELECT COUNT(*) AS total
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= $1 AND datereservation < $2
      ),
      reservations_precedentes AS (
        SELECT COUNT(*) AS total
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= $3 AND datereservation < $4
      ),
      
      -- Clients
      clients_actuels AS (
        SELECT COUNT(DISTINCT email) AS total
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= $1 AND datereservation < $2
      ),
      clients_precedents AS (
        SELECT COUNT(DISTINCT email) AS total
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= $3 AND datereservation < $4
      )
      
      SELECT 
        -- Trend revenus
        CASE 
          WHEN (SELECT total FROM revenus_precedents) > 0 THEN
            CAST(
              (((SELECT total FROM revenus_actuels) - (SELECT total FROM revenus_precedents)) / 
              (SELECT total FROM revenus_precedents) * 100) AS NUMERIC(10,1)
            )
          ELSE 
            CASE WHEN (SELECT total FROM revenus_actuels) > 0 THEN 100.0 ELSE 0.0 END
        END AS trend_revenus,
        
        -- Trend réservations
        CASE 
          WHEN (SELECT total FROM reservations_precedentes) > 0 THEN
            CAST(
              (((SELECT total FROM reservations_actuelles) - (SELECT total FROM reservations_precedentes)) / 
              (SELECT total FROM reservations_precedentes) * 100) AS NUMERIC(10,1)
            )
          ELSE 
            CASE WHEN (SELECT total FROM reservations_actuelles) > 0 THEN 100.0 ELSE 0.0 END
        END AS trend_reservations,
        
        -- Trend clients
        CASE 
          WHEN (SELECT total FROM clients_precedents) > 0 THEN
            CAST(
              (((SELECT total FROM clients_actuels) - (SELECT total FROM clients_precedents)) / 
              (SELECT total FROM clients_precedents) * 100) AS NUMERIC(10,1)
            )
          ELSE 
            CASE WHEN (SELECT total FROM clients_actuels) > 0 THEN 100.0 ELSE 0.0 END
        END AS trend_clients
    `;

    // 4. Réservations à venir (toujours utile)
    const reservationsProchainesSql = `
      SELECT 
        datereservation,
        COUNT(*) as nb_reservations,
        COALESCE(SUM(tarif), 0) as revenu_prevue,
        COUNT(DISTINCT numeroterrain) as terrains_occupes
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `;

    // 5. Top clients
    const topClientsSql = `
      SELECT 
        email,
        nomclient,
        COUNT(*) as nb_reservations,
        COALESCE(SUM(tarif), 0) as total_depense,
        MAX(datereservation) as derniere_reservation
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY email, nomclient
      ORDER BY nb_reservations DESC, total_depense DESC
      LIMIT 5
    `;

    // Exécution des requêtes avec les paramètres de période
    const [
      statsPrincipalesResult,
      remplissageResult,
      tendancesResult,
      reservationsProchainesResult,
      topClientsResult
    ] = await Promise.all([
      // Stats principales
      db.query(statsPrincipalesSql, [currentRange.start, currentRange.end]),
      
      // Remplissage (paramètres différents selon la période)
      periode === 'jour' 
        ? db.query(remplissageSql)
        : db.query(remplissageSql, [currentRange.start, currentRange.end]),
      
      // Tendances (comparaison avec période précédente)
      db.query(tendancesSql, [
        currentRange.start, currentRange.end,
        previousRange.start, previousRange.end
      ]),
      
      // Réservations à venir
      db.query(reservationsProchainesSql),
      
      // Top clients
      db.query(topClientsSql)
    ]);

    // Préparation des données finales
    const data = {
      // Statistiques principales
      revenus_mois: parseFloat(statsPrincipalesResult.rows[0].revenus_periode) || 0,
      revenus_annee: parseFloat(statsPrincipalesResult.rows[0].revenus_annee) || 0,
      revenus_aujourdhui: parseFloat(statsPrincipalesResult.rows[0].revenus_aujourdhui) || 0,
      
      reservations_mois: parseInt(statsPrincipalesResult.rows[0].reservations_periode) || 0,
      confirmes_aujourdhui: parseInt(statsPrincipalesResult.rows[0].confirmes_aujourdhui) || 0,
      reservations_aujourdhui: parseInt(statsPrincipalesResult.rows[0].reservations_aujourdhui) || 0,
      clients_actifs: parseInt(statsPrincipalesResult.rows[0].clients_actifs) || 0,
      nb_terrains_total: parseInt(statsPrincipalesResult.rows[0].nb_terrains_total) || 0,
      
      // Performance
      taux_remplissage: parseFloat(remplissageResult.rows[0].taux_remplissage) || 0,
      nb_terrains_utilises: parseInt(remplissageResult.rows[0].nb_terrains_utilises) || 0,
      heures_reservees: parseFloat(remplissageResult.rows[0].heures_reservees) || 0,
      
      // Tendances
      trends: {
        revenus: {
          value: Math.abs(parseFloat(tendancesResult.rows[0].trend_revenus) || 0),
          isPositive: parseFloat(tendancesResult.rows[0].trend_revenus) >= 0
        },
        reservations: {
          value: Math.abs(parseFloat(tendancesResult.rows[0].trend_reservations) || 0),
          isPositive: parseFloat(tendancesResult.rows[0].trend_reservations) >= 0
        },
        clients: {
          value: Math.abs(parseFloat(tendancesResult.rows[0].trend_clients) || 0),
          isPositive: parseFloat(tendancesResult.rows[0].trend_clients) >= 0
        }
      },
      
      // Données supplémentaires
      reservations_prochaines: reservationsProchainesResult.rows,
      top_clients: topClientsResult.rows,
      
      // Métriques calculées
      metriques: {
        revenu_moyen_par_reservation: statsPrincipalesResult.rows[0].reservations_periode > 0 
          ? parseFloat(statsPrincipalesResult.rows[0].revenus_periode) / parseInt(statsPrincipalesResult.rows[0].reservations_periode)
          : 0,
        taux_confirmation_aujourdhui: statsPrincipalesResult.rows[0].reservations_aujourdhui > 0
          ? (parseInt(statsPrincipalesResult.rows[0].confirmes_aujourdhui) / parseInt(statsPrincipalesResult.rows[0].reservations_aujourdhui)) * 100
          : 0
      }
    };

    res.json({
      success: true,
      periode: periode,
      date_actualisation: new Date().toISOString(),
      data: data
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

// 📧 GESTION DES EMAILS

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

// 📌 Route pour tester l'envoi d'email
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

// 🎯 GESTION DES RÉSERVATIONS

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

    // Gestion de l'envoi d'email
    let emailResult = null;
    const shouldSendEmail = statut === 'confirmée' && email && email.includes('@');
    if (shouldSendEmail) {
      try {
        console.log(`📧 Tentative d'envoi d'email de confirmation à: ${email}`);
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