import PDFDocument from 'pdfkit';
import emailjs from '@emailjs/nodejs';

// Configuration EmailJS
const EMAILJS_CONFIG = {
  serviceId: 'service_9cd5nin',
  templateId: 'template_l71wb4o', 
  publicKey: '4ouSFo0CcZLfJLizR',
  privateKey: '3XnlabANVMe6SicjAJ56g'
};

// Fonction simplifiée et robuste pour générer le PDF
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
      doc.on('error', reject);

      // Couleurs professionnelles
      const primaryColor = '#2C3E50';
      const accentColor = '#27AE60';
      
      // En-tête
      doc.rect(0, 0, 612, 80).fill(primaryColor);
      doc.fillColor('#FFFFFF')
         .fontSize(20)
         .font('Helvetica-Bold')
         .text('CONFIRMATION DE RÉSERVATION', 50, 30, { align: 'center' });
      
      // Informations client
      doc.fillColor(primaryColor)
         .fontSize(16)
         .text('Informations Client', 50, 100);
      
      doc.fontSize(12)
         .text(`Nom: ${reservation.prenom} ${reservation.nomclient}`, 50, 130)
         .text(`Email: ${reservation.email}`, 50, 150)
         .text(`Téléphone: ${reservation.telephone || 'Non renseigné'}`, 50, 170);
      
      // Détails réservation
      doc.fontSize(16)
         .text('Détails de la Réservation', 50, 210);
      
      doc.fontSize(12)
         .text(`Terrain: ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`, 50, 240)
         .text(`Type: ${reservation.typeterrain || 'Non spécifié'}`, 50, 260)
         .text(`Date: ${new Date(reservation.datereservation).toLocaleDateString('fr-FR')}`, 50, 280)
         .text(`Horaire: ${reservation.heurereservation} - ${reservation.heurefin}`, 50, 300)
         .text(`Statut: ${reservation.statut}`, 50, 320);
      
      // Tarif
      doc.fillColor(accentColor)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text(`Tarif: ${reservation.tarif || '0'} Dh`, 50, 360);
      
      // Message de remerciement
      doc.fillColor(primaryColor)
         .fontSize(10)
         .text('Merci pour votre confiance. Veuillez présenter cette confirmation à votre arrivée.', 
               50, 400, { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Fonction principale d'envoi d'email - VERSION CORRIGÉE ET ROBUSTE
export const sendReservationConfirmation = async (reservation) => {
  try {
    console.log('🚀 DÉBUT PROCESSUS ENVOI EMAIL');
    console.log('📍 Destinataire:', reservation.email);

    // Validation basique de l'email
    if (!reservation.email) {
      console.error('❌ Email manquant');
      return { success: false, error: 'Email du client manquant' };
    }

    if (!reservation.email.includes('@')) {
      console.error('❌ Format email invalide:', reservation.email);
      return { success: false, error: 'Format d\'email invalide' };
    }

    console.log('✅ Email valide détecté');

    // Génération du PDF (optionnel - gestion d'erreur robuste)
    let pdfBuffer = null;
    try {
      console.log('📄 Génération du PDF en cours...');
      pdfBuffer = await generateReservationPDF(reservation);
      console.log('✅ PDF généré avec succès');
    } catch (pdfError) {
      console.warn('⚠️ Erreur génération PDF, continuation sans pièce jointe:', pdfError.message);
      pdfBuffer = null;
    }

    // Préparation des données pour le template EmailJS
    const templateParams = {
      to_email: reservation.email,
      client_name: `${reservation.prenom} ${reservation.nomclient}`,
      terrain_name: reservation.nomterrain || `Terrain ${reservation.numeroterrain}`,
      terrain_number: reservation.numeroterrain,
      terrain_type: reservation.typeterrain || 'Synthétique',
      reservation_date: new Date(reservation.datereservation).toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      reservation_time: `${reservation.heurereservation} - ${reservation.heurefin}`,
      tarif: `${reservation.tarif || '0'} Dh`,
      telephone: reservation.telephone || 'Non renseigné',
      from_name: 'FootSpace Réservation',
      reply_to: 'noreply@footspace.com',
      reservation_id: reservation.id || `RSV-${Date.now()}`,
      subject: `Confirmation de réservation - ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`
    };

    console.log('📤 Tentative d\'envoi via EmailJS...');
    console.log('📋 Paramètres template:', {
      to_email: templateParams.to_email,
      client_name: templateParams.client_name,
      terrain_name: templateParams.terrain_name
    });

    // ENVOI EMAIL AVEC EMAILJS - AVEC GESTION D'ERREUR DÉTAILLÉE
    const emailResult = await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      templateParams,
      {
        publicKey: EMAILJS_CONFIG.publicKey,
        privateKey: EMAILJS_CONFIG.privateKey
      }
    );

    console.log('✅ EMAIL ENVOYÉ AVEC SUCCÈS!');
    console.log('📨 ID Message:', emailResult.messageId);
    console.log('👤 Destinataire:', reservation.email);
    console.log('🏟️ Terrain:', templateParams.terrain_name);
    
    return { 
      success: true, 
      messageId: emailResult.messageId,
      email: reservation.email,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ ERREUR CRITIQUE LORS DE L\'ENVOI D\'EMAIL:');
    console.error('🔍 Message d\'erreur:', error.message);
    
    // Log détaillé pour debugging
    const errorDetails = {
      message: error.message,
      code: error.code,
      stack: error.stack
    };

    if (error.response) {
      console.error('📧 Réponse EmailJS:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
      errorDetails.emailjsStatus = error.response.status;
      errorDetails.emailjsData = error.response.data;
    }

    console.error('🔧 Détails complets erreur:', errorDetails);
    
    return { 
      success: false, 
      error: error.message,
      details: errorDetails,
      timestamp: new Date().toISOString()
    };
  }
};

// Fonction de vérification de configuration SIMPLIFIÉE
export const checkEmailConfiguration = async () => {
  try {
    console.log('🔧 Vérification configuration EmailJS...');
    
    // Test de connexion simple sans envoyer d'email
    const configStatus = {
      status: 'CONFIGURÉ',
      service: 'EmailJS',
      serviceId: EMAILJS_CONFIG.serviceId ? '✅ PRÉSENT' : '❌ MANQUANT',
      templateId: EMAILJS_CONFIG.templateId ? '✅ PRÉSENT' : '❌ MANQUANT',
      publicKey: EMAILJS_CONFIG.publicKey ? '✅ PRÉSENT' : '❌ MANQUANT',
      privateKey: EMAILJS_CONFIG.privateKey ? '✅ PRÉSENT' : '❌ MANQUANT',
      message: 'Configuration EmailJS prête à être utilisée',
      timestamp: new Date().toISOString(),
      checks: {
        hasServiceId: !!EMAILJS_CONFIG.serviceId,
        hasTemplateId: !!EMAILJS_CONFIG.templateId,
        hasPublicKey: !!EMAILJS_CONFIG.publicKey,
        hasPrivateKey: !!EMAILJS_CONFIG.privateKey,
        allConfigPresent: !!EMAILJS_CONFIG.serviceId && !!EMAILJS_CONFIG.templateId && 
                         !!EMAILJS_CONFIG.publicKey && !!EMAILJS_CONFIG.privateKey
      }
    };

    console.log('✅ Configuration vérifiée:', configStatus);
    
    return configStatus;
  } catch (error) {
    console.error('❌ Erreur vérification configuration:', error);
    
    return {
      status: 'ERREUR',
      service: 'EmailJS',
      message: `Erreur de configuration: ${error.message}`,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// Fonction pour envoyer des emails génériques
export const sendGenericEmail = async (to, subject, message, attachments = []) => {
  try {
    console.log(`📧 Envoi email générique à: ${to}`);
    
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

    console.log('✅ Email générique envoyé avec succès!');
    
    return { 
      success: true, 
      messageId: result.messageId,
      email: to 
    };
  } catch (error) {
    console.error('❌ Erreur envoi email générique:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

// Export de la configuration pour debugging
export const getEmailConfig = () => {
  return {
    ...EMAILJS_CONFIG,
    privateKey: EMAILJS_CONFIG.privateKey ? '***' + EMAILJS_CONFIG.privateKey.slice(-4) : 'NON DÉFINIE'
  };
};