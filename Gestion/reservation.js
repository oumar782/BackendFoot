import express from 'express';
import db from '../db.js';
import { sendReservationConfirmation} from '../services/emailService.js';

const router = express.Router();

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

    // Envoyer l'email seulement si le statut est "confirmée" dès la création
    let emailSent = false;
    let emailError = null;
    
    if (statut === 'confirmée' && email) {
      try {
        const emailResult = await sendReservationConfirmation(result.rows[0]);
        
        if (emailResult.success) {
          emailSent = true;
          console.log('✅ Email de confirmation envoyé avec succès');
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

    res.json({
      success: true,
      message: 'Réservation mise à jour avec succès.',
      data: result.rows[0]
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

    const sql = `
      UPDATE reservation 
      SET statut = $1 
      WHERE numeroreservations = $2
      RETURNING numeroreservations as id, *
    `;

    const result = await db.query(sql, [statut, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    const reservation = result.rows[0];

    // ENVOYER L'EMAIL AVEC RESEND SI CONFIRMATION
    let emailSent = false;
    let emailError = null;
    
    if (statut === 'confirmée' && reservation.email) {
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