import PDFDocument from 'pdfkit';
import emailjs from '@emailjs/nodejs';

// Configuration EmailJS - AVEC VOS CLÉS
const EMAILJS_CONFIG = {
  serviceId: 'service_9cd5nin',
  templateId: 'template_l71wb4o', 
  publicKey: '4ouSFo0CcZLfJLizR',
  privateKey: '3XnlabANVMe6SicjAJ56g'
};

const generateReservationPDF = (reservation) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      
      // Couleurs professionnelles
      const primaryColor = '#2C3E50';
      const accentColor = '#27AE60';
      const lightGray = '#ECF0F1';
      
      // En-tête avec bande de couleur
      doc.rect(0, 0, 612, 80).fill(primaryColor);
      
      doc.fillColor('#FFFFFF')
         .fontSize(28)
         .font('Helvetica-Bold')
         .text('CONFIRMATION DE RÉSERVATION', 50, 30, { align: 'center' });
      
      doc.moveDown(3);
      
      // Ligne de séparation
      doc.moveTo(50, 120)
         .lineTo(562, 120)
         .strokeColor(accentColor)
         .lineWidth(2)
         .stroke();
      
      doc.moveDown(1);
      
      // Section Informations Client
      doc.fillColor(primaryColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('INFORMATIONS CLIENT', 50, 150);
      
      doc.rect(50, 175, 512, 80).fillAndStroke(lightGray, lightGray);
      
      doc.fillColor(primaryColor)
         .fontSize(11)
         .font('Helvetica');
      
      doc.text(`${reservation.prenom} ${reservation.nomclient}`, 70, 190);
      doc.fontSize(10)
         .fillColor('#7F8C8D')
         .text(`Email: ${reservation.email}`, 70, 210);
      doc.text(`Téléphone: ${reservation.telephone}`, 70, 225);
      
      doc.moveDown(2);
      
      // Section Détails de la Réservation
      doc.fillColor(primaryColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('DÉTAILS DE LA RÉSERVATION', 50, 280);
      
      const detailsY = 305;
      
      // Tableau des détails
      const drawDetailRow = (label, value, y) => {
        doc.rect(50, y, 512, 30).fillAndStroke('#FFFFFF', lightGray);
        doc.fillColor('#7F8C8D')
           .fontSize(9)
           .font('Helvetica')
           .text(label, 70, y + 8);
        doc.fillColor(primaryColor)
           .fontSize(11)
           .font('Helvetica-Bold')
           .text(value, 70, y + 8, { align: 'right', width: 472 });
      };
      
      let currentY = detailsY;
      
      drawDetailRow('TERRAIN', reservation.nomterrain || 'Terrain ' + reservation.numeroterrain, currentY);
      currentY += 30;
      
      drawDetailRow('NUMÉRO DE TERRAIN', reservation.numeroterrain.toString(), currentY);
      currentY += 30;
      
      drawDetailRow('TYPE DE TERRAIN', reservation.typeterrain || 'Non spécifié', currentY);
      currentY += 30;
      
      drawDetailRow('SURFACE', reservation.surface || 'Non spécifié', currentY);
      currentY += 30;
      
      drawDetailRow('DATE', new Date(reservation.datereservation).toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }), currentY);
      currentY += 30;
      
      drawDetailRow('HORAIRE', `${reservation.heurereservation} - ${reservation.heurefin}`, currentY);
      currentY += 30;
      
      drawDetailRow('STATUT', reservation.statut, currentY);
      currentY += 30;
      
      // Tarif mis en évidence
      doc.rect(50, currentY, 512, 40).fill(accentColor);
      doc.fillColor('#FFFFFF')
         .fontSize(10)
         .font('Helvetica')
         .text('TARIF TOTAL', 70, currentY + 8);
      doc.fontSize(18)
         .font('Helvetica-Bold')
         .text(`${reservation.tarif || '0'} Dh`, 70, currentY + 8, { align: 'right', width: 472 });
      
      currentY += 60;
      
      // Message de remerciement
      doc.fillColor(primaryColor)
         .fontSize(11)
         .font('Helvetica')
         .text('Merci pour votre confiance.', 50, currentY, { align: 'center' });
      
      doc.fontSize(10)
         .fillColor('#7F8C8D')
         .text('Veuillez présenter cette confirmation à votre arrivée.', 50, currentY + 20, { align: 'center' });
      
      // Pied de page
      doc.moveTo(50, 750)
         .lineTo(562, 750)
         .strokeColor(lightGray)
         .lineWidth(1)
         .stroke();
      
      doc.fontSize(8)
         .fillColor('#95A5A6')
         .text('Document généré automatiquement', 50, 760, { align: 'center' });
      doc.text(new Date().toLocaleDateString('fr-FR', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }), 50, 772, { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

export const sendReservationConfirmation = async (reservation) => {
  try {
    console.log('🎯 DÉBUT ENVOI EMAIL PRODUCTION');
    console.log('📍 Destinataire:', reservation.email);

    // Validation de l'email
    if (!reservation.email) {
      console.error('❌ Email du client manquant');
      return { success: false, error: 'Email du client manquant' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(reservation.email)) {
      console.error('❌ Format d\'email invalide:', reservation.email);
      return { success: false, error: 'Format d\'email invalide' };
    }

    console.log('✅ Email valide, génération PDF...');

    // Génération du PDF
    const pdfBuffer = await generateReservationPDF(reservation);
    console.log('✅ PDF généré avec succès');

    // Données pour le template EmailJS
    const templateParams = {
      to_email: reservation.email,
      client_name: `${reservation.prenom} ${reservation.nomclient}`,
      terrain_name: reservation.nomterrain || 'Terrain ' + reservation.numeroterrain,
      terrain_number: reservation.numeroterrain,
      terrain_type: reservation.typeterrain || 'Non spécifié',
      reservation_date: new Date(reservation.datereservation).toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      reservation_time: `${reservation.heurereservation} - ${reservation.heurefin}`,
      tarif: `${reservation.tarif || '0'} Dh`,
      telephone: reservation.telephone,
      from_name: 'FootSpace Réservation',
      reservation_id: reservation.id || 'N/A'
    };

    console.log('🚀 ENVOI AVEC EMAILJS...');
    console.log('📋 Paramètres template:', {
      to_email: templateParams.to_email,
      client_name: templateParams.client_name,
      terrain_name: templateParams.terrain_name
    });
    
    // ENVOI RÉEL AVEC EMAILJS
    const result = await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      templateParams,
      {
        publicKey: EMAILJS_CONFIG.publicKey,
        privateKey: EMAILJS_CONFIG.privateKey
      }
    );

    console.log('✅ EMAIL ENVOYÉ AVEC SUCCÈS! ID:', result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('❌ ERREUR EMAILJS:', error);
    
    // Log détaillé de l'erreur
    if (error.response) {
      console.error('📧 Détails erreur EmailJS:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    
    return { 
      success: false, 
      error: `Erreur d'envoi: ${error.message}`,
      details: error.response?.data || 'Aucun détail supplémentaire'
    };
  }
};

// Fonction pour vérifier la configuration EmailJS
export const checkEmailConfiguration = async () => {
  try {
    // Test simple de connexion à EmailJS
    const testParams = {
      to_email: 'test@example.com',
      client_name: 'Test Configuration',
      terrain_name: 'Terrain Test',
      terrain_number: '1',
      terrain_type: 'Synthétique',
      reservation_date: new Date().toLocaleDateString('fr-FR'),
      reservation_time: '14:00 - 16:00',
      tarif: '100 Dh',
      telephone: '0123456789',
      from_name: 'FootSpace Test'
    };

    await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      testParams,
      {
        publicKey: EMAILJS_CONFIG.publicKey,
        privateKey: EMAILJS_CONFIG.privateKey
      }
    );

    return {
      status: 'CONFIGURÉ',
      serviceId: EMAILJS_CONFIG.serviceId ? '✅ PRÉSENT' : '❌ MANQUANT',
      templateId: EMAILJS_CONFIG.templateId ? '✅ PRÉSENT' : '❌ MANQUANT',
      publicKey: EMAILJS_CONFIG.publicKey ? '✅ PRÉSENT' : '❌ MANQUANT',
      privateKey: EMAILJS_CONFIG.privateKey ? '✅ PRÉSENT' : '❌ MANQUANT',
      message: 'Configuration EmailJS valide'
    };
  } catch (error) {
    return {
      status: 'ERREUR',
      serviceId: EMAILJS_CONFIG.serviceId ? '✅ PRÉSENT' : '❌ MANQUANT',
      templateId: EMAILJS_CONFIG.templateId ? '✅ PRÉSENT' : '❌ MANQUANT',
      publicKey: EMAILJS_CONFIG.publicKey ? '✅ PRÉSENT' : '❌ MANQUANT',
      privateKey: EMAILJS_CONFIG.privateKey ? '✅ PRÉSENT' : '❌ MANQUANT',
      message: `Erreur de configuration: ${error.message}`,
      error: error.message
    };
  }
};

// Fonction pour envoyer des emails génériques
export const sendGenericEmail = async (to, subject, message, attachments = []) => {
  try {
    const templateParams = {
      to_email: to,
      subject: subject,
      message: message,
      from_name: 'FootSpace Administration'
    };

    const result = await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      templateParams,
      {
        publicKey: EMAILJS_CONFIG.publicKey,
        privateKey: EMAILJS_CONFIG.privateKey
      }
    );

    return { success: true, messageId: result.messageId };
  } catch (error) {
    return { success: false, error: error.message };
  }
};