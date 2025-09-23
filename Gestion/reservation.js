// reservation-api-enhanced.js
import express from 'express';
import db from '../db.js';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import qrcode from 'qrcode';
import axios from 'axios';

const router = express.Router();

// 📧 Configuration de l'email
const emailTransporter = nodemailer.createTransporter({
  service: 'gmail', // ou votre service email
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// 📱 Configuration WhatsApp (en utilisant l'API WhatsApp Business)
const WHATSAPP_CONFIG = {
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  apiVersion: 'v18.0'
};

/**
 * 🎯 FONCTION : Générer un PDF de réservation professionnel
 */
const generateReservationPDF = async (reservation) => {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      
      // 📄 En-tête du document
      doc.fontSize(20).font('Helvetica-Bold')
         .fillColor('#2c5530')
         .text('CONFIRMATION DE RÉSERVATION', 50, 50, { align: 'center' });
      
      doc.fontSize(12).font('Helvetica')
         .fillColor('#666')
         .text('Votre réservation a été confirmée avec succès', 50, 80, { align: 'center' });
      
      // 📍 Ligne de séparation
      doc.moveTo(50, 110).lineTo(550, 110).strokeColor('#2c5530').lineWidth(2).stroke();
      
      let yPosition = 140;
      
      // 👤 Informations client
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#333').text('INFORMATIONS CLIENT', 50, yPosition);
      yPosition += 30;
      
      doc.fontSize(10).font('Helvetica');
      doc.text(`Nom complet: ${reservation.prenom} ${reservation.nomclient}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Email: ${reservation.email}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Téléphone: ${reservation.telephone}`, 50, yPosition);
      yPosition += 40;
      
      // ⚽ Informations réservation
      doc.fontSize(14).font('Helvetica-Bold').text('DÉTAILS DE LA RÉSERVATION', 50, yPosition);
      yPosition += 30;
      
      doc.fontSize(10).font('Helvetica');
      doc.text(`Terrain: ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Numéro: ${reservation.numeroterrain}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Type: ${reservation.typeterrain || 'Non spécifié'}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Surface: ${reservation.surface || 'Non spécifié'}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Date: ${new Date(reservation.datereservation).toLocaleDateString('fr-FR')}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Heure: ${reservation.heurereservation} - ${reservation.heurefin}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Statut: ${reservation.statut.toUpperCase()}`, 50, yPosition);
      yPosition += 20;
      doc.text(`Tarif: ${reservation.tarif || '0'} Dh`, 50, yPosition);
      yPosition += 40;
      
      // 📍 Code QR pour accès rapide
      const qrData = `Réservation ${reservation.id} - ${reservation.nomterrain} - ${reservation.datereservation} ${reservation.heurereservation}`;
      const qrCodeImage = await qrcode.toBuffer(qrData, { width: 100 });
      
      doc.text('Code QR pour accès rapide:', 50, yPosition);
      yPosition += 20;
      doc.image(qrCodeImage, 50, yPosition, { width: 100 });
      yPosition += 120;
      
      // 📝 Informations importantes
      doc.fontSize(12).font('Helvetica-Bold').text('INFORMATIONS IMPORTANTES', 50, yPosition);
      yPosition += 20;
      
      doc.fontSize(9).font('Helvetica');
      doc.text('• Présentez ce document à votre arrivée', 50, yPosition, { width: 500 });
      yPosition += 15;
      doc.text('• Arrivez 15 minutes avant le début de la réservation', 50, yPosition, { width: 500 });
      yPosition += 15;
      doc.text('• En cas de retard, votre créneau pourra être réduit', 50, yPosition, { width: 500 });
      yPosition += 15;
      doc.text('• Annulation possible jusqu\'à 24h avant', 50, yPosition, { width: 500 });
      
      // 🏁 Pied de page
      doc.fontSize(8).fillColor('#999')
         .text('Merci pour votre confiance ! © Centre Sportif - Tél: +212 XXX XXX XXX', 
               50, 750, { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * 📧 FONCTION : Envoyer le PDF par email
 */
const sendReservationEmail = async (reservation, pdfBuffer) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: reservation.email,
      subject: `Confirmation de réservation - ${reservation.nomterrain}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c5530;">Confirmation de votre réservation</h2>
          <p>Bonjour ${reservation.prenom},</p>
          <p>Votre réservation a été confirmée avec succès. Voici le détail :</p>
          
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #2c5530; margin-top: 0;">Détails de la réservation</h3>
            <p><strong>Terrain:</strong> ${reservation.nomterrain} (${reservation.numeroterrain})</p>
            <p><strong>Date:</strong> ${new Date(reservation.datereservation).toLocaleDateString('fr-FR')}</p>
            <p><strong>Heure:</strong> ${reservation.heurereservation} - ${reservation.heurefin}</p>
            <p><strong>Type:</strong> ${reservation.typeterrain}</p>
            <p><strong>Tarif:</strong> ${reservation.tarif} Dh</p>
          </div>
          
          <p>Vous trouverez en pièce jointe votre confirmation en format PDF.</p>
          <p>Présentez ce document à votre arrivée au centre sportif.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              Centre Sportif - Tél: +212 XXX XXX XXX<br>
              Email: contact@centresportif.ma
            </p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `reservation-${reservation.id}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };
    
    await emailTransporter.sendMail(mailOptions);
    console.log('✅ Email envoyé avec succès à:', reservation.email);
    return true;
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw error;
  }
};

/**
 * 📱 FONCTION : Envoyer message WhatsApp
 */
const sendWhatsAppMessage = async (reservation) => {
  try {
    const messageData = {
      messaging_product: "whatsapp",
      to: reservation.telephone.replace(/\s/g, ''), // Supprimer les espaces
      type: "template",
      template: {
        name: "reservation_confirmation",
        language: { code: "fr" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: reservation.prenom },
              { type: "text", text: reservation.nomterrain },
              { type: "text", text: new Date(reservation.datereservation).toLocaleDateString('fr-FR') },
              { type: "text", text: `${reservation.heurereservation} - ${reservation.heurefin}` },
              { type: "text", text: reservation.tarif + ' Dh' }
            ]
          }
        ]
      }
    };
    
    const response = await axios.post(
      `https://graph.facebook.com/${WHATSAPP_CONFIG.apiVersion}/${WHATSAPP_CONFIG.phoneNumberId}/messages`,
      messageData,
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_CONFIG.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Message WhatsApp envoyé avec succès');
    return response.data;
  } catch (error) {
    console.error('❌ Erreur envoi WhatsApp:', error.response?.data || error.message);
    
    // Fallback: Message simple si le template n'existe pas
    try {
      const fallbackMessage = {
        messaging_product: "whatsapp",
        to: reservation.telephone.replace(/\s/g, ''),
        type: "text",
        text: {
          body: `Bonjour ${reservation.prenom}! Votre réservation pour le terrain ${reservation.nomterrain} le ${new Date(reservation.datereservation).toLocaleDateString('fr-FR')} de ${reservation.heurereservation} à ${reservation.heurefin} a été confirmée. Tarif: ${reservation.tarif} Dh. Merci!`
        }
      };
      
      const fallbackResponse = await axios.post(
        `https://graph.facebook.com/${WHATSAPP_CONFIG.apiVersion}/${WHATSAPP_CONFIG.phoneNumberId}/messages`,
        fallbackMessage,
        {
          headers: {
            'Authorization': `Bearer ${WHATSAPP_CONFIG.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('✅ Message WhatsApp fallback envoyé');
      return fallbackResponse.data;
    } catch (fallbackError) {
      console.error('❌ Erreur même avec fallback WhatsApp:', fallbackError);
      throw fallbackError;
    }
  }
};

/**
 * 🔄 FONCTION : Traitement automatique lors de la confirmation
 */
const processReservationConfirmation = async (reservationId) => {
  try {
    console.log('🔄 Début du traitement automatique pour la réservation:', reservationId);
    
    // Récupérer les détails complets de la réservation
    const reservationSql = `
      SELECT * FROM reservation WHERE numeroreservations = $1
    `;
    const reservationResult = await db.query(reservationSql, [reservationId]);
    
    if (reservationResult.rows.length === 0) {
      throw new Error('Réservation non trouvée');
    }
    
    const reservation = reservationResult.rows[0];
    
    // 1. Générer le PDF
    console.log('📄 Génération du PDF...');
    const pdfBuffer = await generateReservationPDF(reservation);
    
    // 2. Envoyer l'email avec le PDF
    console.log('📧 Envoi de l\'email...');
    await sendReservationEmail(reservation, pdfBuffer);
    
    // 3. Envoyer le message WhatsApp
    console.log('📱 Envoi du message WhatsApp...');
    await sendWhatsAppMessage(reservation);
    
    console.log('✅ Traitement automatique terminé avec succès');
    return { success: true, message: 'Traitement automatique terminé' };
  } catch (error) {
    console.error('❌ Erreur lors du traitement automatique:', error);
    throw error;
  }
};

// 📌 Route pour mettre à jour le statut d'une réservation (AVEC TRAITEMENT AUTOMATIQUE)
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

    console.log('📋 Mise à jour statut réservation:', id, '→', statut);

    const result = await db.query(sql, [statut, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    const updatedReservation = result.rows[0];

    // 🎯 TRAITEMENT AUTOMATIQUE : Si le statut passe à "confirmée"
    if (statut === 'confirmée') {
      console.log('🎯 Réservation confirmée - Lancement du traitement automatique...');
      
      // Lancer le traitement en arrière-plan sans bloquer la réponse
      processReservationConfirmation(id)
        .then(() => console.log('✅ Traitement automatique terminé avec succès'))
        .catch(err => console.error('❌ Erreur traitement automatique:', err));
    }

    res.json({
      success: true,
      message: 'Statut de la réservation mis à jour avec succès.',
      data: updatedReservation
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

// 📌 Route pour créer une réservation (AVEC CONFIRMATION AUTOMATIQUE SI BESOIN)
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
    const newReservation = result.rows[0];

    // 🎯 TRAITEMENT AUTOMATIQUE : Si création avec statut "confirmée"
    if (statut === 'confirmée') {
      console.log('🎯 Nouvelle réservation confirmée - Lancement du traitement automatique...');
      processReservationConfirmation(newReservation.id)
        .then(() => console.log('✅ Traitement automatique terminé avec succès'))
        .catch(err => console.error('❌ Erreur traitement automatique:', err));
    }

    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès.',
      data: newReservation
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

// 📌 Route pour mettre à jour une réservation (AVEC CONFIRMATION AUTOMATIQUE)
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

    // Récupérer l'ancien statut pour détecter le changement
    const oldReservationSql = 'SELECT statut FROM reservation WHERE numeroreservations = $1';
    const oldResult = await db.query(oldReservationSql, [id]);
    const oldStatut = oldResult.rows[0]?.statut;

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

    // 🎯 TRAITEMENT AUTOMATIQUE : Si le statut passe à "confirmée"
    if (oldStatut !== 'confirmée' && statut === 'confirmée') {
      console.log('🎯 Statut changé à confirmée - Lancement du traitement automatique...');
      processReservationConfirmation(id)
        .then(() => console.log('✅ Traitement automatique terminé avec succès'))
        .catch(err => console.error('❌ Erreur traitement automatique:', err));
    }

    res.json({
      success: true,
      message: 'Réservation mise à jour avec succès.',
      data: updatedReservation
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

// 📌 Route pour récupérer les réservations (avec ou sa
// ns filtres)
router.get('/', async (req, res) => {
  try {
    const { nom, email, statut, date, clientId } = req.query;

    let sql = `
      SELECT 
        numeroreservations as id,-
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

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);

    console.log('📊 Réservations trouvées:', result.rows.length);
    if (result.rows.length > 0) {
      console.log('📝 Première réservation:', result.rows[0]);
    }

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

// 📌 Route pour récupérer une réservation spécifique par ID (numeroreservations)
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

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);

    const result = await db.query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    console.log('✅ Réservation trouvée:', result.rows[0]);

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

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);

    console.log('✅ Réservation créée:', result.rows[0]);

    res.status(201).json({
      success: true,
      message: 'Réservation créée avec succès.',
      data: result.rows[0]
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

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', params);

    const result = await db.query(sql, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    console.log('✅ Réservation mise à jour:', result.rows[0]);

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

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètre ID:', id);

    const result = await db.query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    console.log('✅ Réservation supprimée:', result.rows[0]);

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

    const sql = `
      UPDATE reservation 
      SET statut = $1 
      WHERE numeroreservations = $2
      RETURNING numeroreservations as id, *
    `;

    console.log('📋 Requête SQL:', sql);
    console.log('📦 Paramètres:', [statut, id]);

    const result = await db.query(sql, [statut, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée.'
      });
    }

    console.log('✅ Statut réservation mis à jour:', result.rows[0]);

    res.json({
      success: true,
      message: 'Statut de la réservation mis à jour avec succès.',
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

export default router;