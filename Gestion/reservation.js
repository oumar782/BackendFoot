import express from 'express';
import db from '../db.js';
import { sendReservationConfirmation } from '../services/emailService.js';

const router = express.Router();

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

    // Calculer les statistiques globales
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

    // Générer des données pour tous les jours de la période (même ceux sans réservations)
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
          heures_disponibles: 12, // Par défaut 1 terrain disponible 12h
          terrains_types: 'Aucun'
        });
      }
      
      dateCourante.setDate(dateCourante.getDate() + 1);
    }

    // Calcul des statistiques avancées
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

// 📌 Route pour récupérer les réservations (avec ou sans filtres)
router.get('/', async (req, res) => {
  try {
    const { nom, email, statut, date, clientId } = req.query;

    let sql = `
      SELECT 
        numeroreservations as id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        idclient,
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

    // Filtre par clientId (prioritaire, pour les clients)
    if (clientId) {
      paramCount++;
      sql += ` AND idclient = $${paramCount}`;
      params.push(clientId);
    } else {
      // Filtres admin
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

    sql += ` ORDER BY datereservation DESC, heurereservation DESC`;

    const result = await db.query(sql, params);

    res.json({
      success: true,
      count: result.rows.length,
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
        idclient,
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
      idclient,
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
    if (!datereservation || !heurereservation || !statut || !idclient || !numeroterrain) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants: date, heure, statut, idclient et numeroterrain sont obligatoires.'
      });
    }

    const sql = `
      INSERT INTO reservation (
        datereservation, heurereservation, statut, idclient, numeroterrain,
        nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING numeroreservations as id, *
    `;

    const params = [
      datereservation, heurereservation, statut, idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain
    ];

    const result = await db.query(sql, params);

    // ENVOYER L'EMAIL À TOUT UTILISATEUR DONT L'EMAIL EST DANS LA RÉSERVATION
    let emailSent = false;
    let emailError = null;
    
    if (statut === 'confirmée' && email) {
      try {
        const emailResult = await sendReservationConfirmation(result.rows[0]);
        
        if (emailResult.success) {
          emailSent = true;
          console.log('✅ Email de confirmation envoyé avec succès à:', email);
        } else {
          emailError = emailResult.error;
          console.error('❌ Erreur envoi email:', emailError);
        }
      } catch (emailError) {
        console.error('❌ Erreur envoi email:', emailError);
        emailError = emailError.message;
      }
    }

    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès.' + (emailSent ? ' Email de confirmation envoyé.' : ''),
      data: result.rows[0],
      emailSent: emailSent,
      emailError: emailError
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
      idclient,
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

    // Récupérer l'ancienne réservation pour vérifier le changement de statut
    const oldReservationResult = await db.query(
      'SELECT statut, email FROM reservation WHERE numeroreservations = $1',
      [id]
    );

    const oldReservation = oldReservationResult.rows[0];
    const oldStatus = oldReservation ? oldReservation.statut : null;
    const oldEmail = oldReservation ? oldReservation.email : null;

    const sql = `
      UPDATE reservation 
      SET 
        datereservation = $1,
        heurereservation = $2,
        statut = $3,
        idclient = $4,
        numeroterrain = $5,
        nomclient = $6,
        prenom = $7,
        email = $8,
        telephone = $9,
        typeterrain = $10,
        tarif = $11,
        surface = $12,
        heurefin = $13,
        nomterrain = $14
      WHERE numeroreservations = $15
      RETURNING numeroreservations as id, *
    `;

    const params = [
      datereservation, heurereservation, statut, idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain, id
    ];

    const result = await db.query(sql, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    const updatedReservation = result.rows[0];

    // ENVOYER L'EMAIL SI LE STATUT EST PASSÉ À "CONFIRMÉE" ET QU'IL Y A UN EMAIL
    let emailSent = false;
    let emailError = null;
    
    // Vérifier si le statut est passé à "confirmée" et qu'il y a un email
    const becameConfirmed = oldStatus !== 'confirmée' && statut === 'confirmée';
    const hasEmail = email && email.trim() !== '';
    
    if (becameConfirmed && hasEmail) {
      try {
        console.log(`📧 Envoi d'email de confirmation à: ${email}`);
        
        const emailResult = await sendReservationConfirmation(updatedReservation);
        
        if (emailResult.success) {
          emailSent = true;
          console.log('✅ Email envoyé avec succès via Resend');
        } else {
          emailError = emailResult.error;
          console.error('❌ Erreur Resend:', emailError);
        }
      } catch (error) {
        emailError = error.message;
        console.error('❌ Erreur envoi email:', error);
      }
    }

    res.json({
      success: true,
      message: 'Réservation mise à jour avec succès.' + 
               (emailSent ? ' Email de confirmation envoyé.' : '') +
               (emailError ? ` Erreur email: ${emailError}` : ''),
      data: updatedReservation,
      emailSent: emailSent,
      emailError: emailError
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

// 📌 Route pour mettre à jour le statut d'une réservation (AVEC RESEND)
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

    // Récupérer l'ancienne réservation pour vérifier le changement de statut
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
    const oldEmail = oldReservation.email;

    const sql = `
      UPDATE reservation 
      SET statut = $1 
      WHERE numeroreservations = $2
      RETURNING numeroreservations as id, *
    `;

    const result = await db.query(sql, [statut, id]);

    const reservation = result.rows[0];

    // ENVOYER L'EMAIL À TOUT UTILISATEUR DONT L'EMAIL EST DANS LA RÉSERVATION
    let emailSent = false;
    let emailError = null;
    
    // Vérifier si le statut est passé à "confirmée" et qu'il y a un email
    const becameConfirmed = oldStatus !== 'confirmée' && statut === 'confirmée';
    const hasEmail = reservation.email && reservation.email.trim() !== '';
    
    if (becameConfirmed && hasEmail) {
      try {
        console.log(`📧 Envoi d'email de confirmation à: ${reservation.email}`);
        
        const emailResult = await sendReservationConfirmation(reservation);
        
        if (emailResult.success) {
          emailSent = true;
          console.log('✅ Email envoyé avec succès via Resend');
        } else {
          emailError = emailResult.error;
          console.error('❌ Erreur Resend:', emailError);
        }
      } catch (error) {
        emailError = error.message;
        console.error('❌ Erreur envoi email:', error);
      }
    }

    res.json({
      success: true,
      message: 'Statut de la réservation mis à jour avec succès.' + 
               (emailSent ? ' Email de confirmation envoyé.' : '') +
               (emailError ? ` Erreur email: ${emailError}` : ''),
      data: reservation,
      emailSent: emailSent,
      emailError: emailError
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

export default router;