// routes/reservation.js
import express from 'express';
import db from '../db.js';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import qrcode from 'qrcode';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const router = express.Router();

// 📧 Configuration email CORRIGÉE
const createEmailTransporter = () => {
  // Vérifier si on est en production (Vercel)
  if (process.env.NODE_ENV === 'production') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  } else {
    // Mode test - utiliser un transporteur de test
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: 'test@example.com',
        pass: 'test'
      }
    });
  }
};

const emailTransporter = createEmailTransporter();

/**
 * 📄 GÉNÉRATION PDF
 */
const generateReservationPDF = async (reservation) => {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Contenu du PDF
      doc.fontSize(20).text('CONFIRMATION DE RÉSERVATION', 100, 100);
      doc.fontSize(12).text(`Client: ${reservation.prenom} ${reservation.nomclient}`, 100, 150);
      doc.text(`Date: ${reservation.datereservation}`, 100, 170);
      doc.text(`Heure: ${reservation.heurereservation} - ${reservation.heurefin}`, 100, 190);
      doc.text(`Terrain: ${reservation.nomterrain} (${reservation.numeroterrain})`, 100, 210);
      doc.text(`Tarif: ${reservation.tarif} Dh`, 100, 230);
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * 📧 ENVOI EMAIL SIMPLIFIÉ
 */
const sendReservationEmail = async (reservation, pdfBuffer) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@sports.com',
      to: reservation.email,
      subject: `Confirmation Réservation - ${reservation.nomterrain}`,
      html: `
        <h2>Confirmation de Réservation</h2>
        <p>Bonjour ${reservation.prenom},</p>
        <p>Votre réservation a été confirmée :</p>
        <ul>
          <li>Terrain: ${reservation.nomterrain}</li>
          <li>Date: ${reservation.datereservation}</li>
          <li>Heure: ${reservation.heurereservation} - ${reservation.heurefin}</li>
          <li>Tarif: ${reservation.tarif} Dh</li>
        </ul>
      `,
      attachments: [{
        filename: `reservation-${reservation.id}.pdf`,
        content: pdfBuffer
      }]
    };

    const info = await emailTransporter.sendMail(mailOptions);
    console.log('✅ Email envoyé:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Erreur email:', error);
    return false;
  }
};

/**
 * 📱 WHATSAPP AVEC CALLMEBOT
 */
const sendWhatsAppMessage = async (reservation) => {
  try {
    // Solution simple sans API complexe
    console.log('📱 WhatsApp simulé pour:', reservation.telephone);
    console.log('📱 Message:', `Réservation confirmée pour ${reservation.nomterrain}`);
    
    // Dans un vrai environnement, vous utiliseriez CallMeBot ici
    return true;
  } catch (error) {
    console.error('❌ Erreur WhatsApp:', error);
    return false;
  }
};

/**
 * 🔄 TRAITEMENT AUTOMATIQUE
 */
const processReservationConfirmation = async (reservationId) => {
  try {
    console.log('🔄 Traitement automatique pour:', reservationId);
    
    const result = await db.query(
      'SELECT * FROM reservation WHERE numeroreservations = $1',
      [reservationId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Réservation non trouvée');
    }
    
    const reservation = result.rows[0];
    
    // Générer PDF
    const pdfBuffer = await generateReservationPDF(reservation);
    
    // Envoyer email
    await sendReservationEmail(reservation, pdfBuffer);
    
    // Envoyer WhatsApp
    await sendWhatsAppMessage(reservation);
    
    console.log('✅ Traitement automatique terminé');
    return { success: true };
  } catch (error) {
    console.error('❌ Erreur traitement:', error);
    return { success: false, error: error.message };
  }
};

// 📌 ROUTES PRINCIPALES
router.get('/', async (req, res) => {
  try {
    const { nom, email, statut } = req.query;
    
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
    
    sql += ` ORDER BY datereservation DESC`;
    
    const result = await db.query(sql, params);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur GET:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

// 📌 MISE À JOUR STATUT AVEC TRAITEMENT AUTOMATIQUE
router.put('/:id/statut', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;

    if (!statut) {
      return res.status(400).json({
        success: false,
        message: 'Statut requis'
      });
    }

    const sql = `
      UPDATE reservation 
      SET statut = $1 
      WHERE numeroreservations = $2
      RETURNING *
    `;

    const result = await db.query(sql, [statut, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }

    const updatedReservation = result.rows[0];

    // 🎯 TRAITEMENT AUTOMATIQUE SI CONFIRMÉE
    if (statut === 'confirmée') {
      console.log('🎯 Lancement traitement automatique...');
      processReservationConfirmation(id)
        .then(result => console.log('✅ Traitement:', result))
        .catch(err => console.error('❌ Erreur traitement:', err));
    }

    res.json({
      success: true,
      message: 'Statut mis à jour',
      data: updatedReservation
    });

  } catch (error) {
    console.error('❌ Erreur statut:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

// 📌 CRÉATION RÉSERVATION
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

    if (!datereservation || !heurereservation || !idclient || !numeroterrain) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants'
      });
    }

    const sql = `
      INSERT INTO reservation (
        datereservation, heurereservation, statut, idclient, numeroterrain,
        nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const params = [
      datereservation, heurereservation, statut || 'en attente', idclient, numeroterrain,
      nomclient, prenom, email, telephone, typeterrain, tarif, surface, heurefin, nomterrain
    ];

    const result = await db.query(sql, params);
    const newReservation = result.rows[0];

    // 🎯 TRAITEMENT SI CONFIRMÉE DÈS LA CRÉATION
    if (statut === 'confirmée') {
      processReservationConfirmation(newReservation.numeroreservations)
        .then(() => console.log('✅ Traitement auto terminé'))
        .catch(err => console.error('❌ Erreur traitement:', err));
    }

    res.status(201).json({
      success: true,
      message: 'Réservation créée',
      data: newReservation
    });

  } catch (error) {
    console.error('❌ Erreur création:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

// 📌 SUPPRESSION
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      'DELETE FROM reservation WHERE numeroreservations = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }

    res.json({
      success: true,
      message: 'Réservation supprimée',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur suppression:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

export default router;