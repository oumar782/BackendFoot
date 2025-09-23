import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

// Configuration du transporteur email - CORRECTION ICI
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
};

// Fonction pour générer le PDF
const generateReservationPDF = (reservation) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      
      // En-tête du PDF
      doc.fontSize(20).text('CONFIRMATION DE RÉSERVATION', { align: 'center' });
      doc.moveDown();
      
      // Informations de la réservation
      doc.fontSize(14).text('Détails de votre réservation:', { underline: true });
      doc.moveDown();
      
      doc.fontSize(12);
      doc.text(`• Terrain: ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`);
      doc.text(`• Numéro de terrain: ${reservation.numeroterrain}`);
      doc.text(`• Type: ${reservation.typeterrain || 'Non spécifié'}`);
      doc.text(`• Surface: ${reservation.surface || 'Non spécifié'}`);
      doc.moveDown();
      
      doc.text(`• Date: ${new Date(reservation.datereservation).toLocaleDateString('fr-FR')}`);
      doc.text(`• Heure: ${reservation.heurereservation} - ${reservation.heurefin}`);
      doc.moveDown();
      
      doc.text(`• Client: ${reservation.prenom} ${reservation.nomclient}`);
      doc.text(`• Email: ${reservation.email}`);
      doc.text(`• Téléphone: ${reservation.telephone}`);
      doc.moveDown();
      
      doc.text(`• Statut: ${reservation.statut}`);
      doc.text(`• Tarif: ${reservation.tarif || '0'} Dh`);
      doc.moveDown();
      
      doc.text('Merci pour votre réservation !');
      doc.text('Présentez cette confirmation à votre arrivée.');
      
      // Pied de page
      doc.moveDown(2);
      doc.fontSize(10).text('Document généré automatiquement - ' + new Date().toLocaleDateString('fr-FR'), { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Fonction pour envoyer l'email avec PDF
export const sendReservationConfirmation = async (reservation) => {
  let transporter;
  
  try {
    // Vérifier que les variables d'environnement sont définies
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Variables d\'environnement email manquantes');
      return { success: false, error: 'Configuration email manquante' };
    }

    // Créer le transporteur
    transporter = createTransporter();
    
    // Vérifier la connexion
    await transporter.verify();
    console.log('✅ Serveur email prêt');

    // Générer le PDF
    const pdfBuffer = await generateReservationPDF(reservation);
    
    // Préparer l'email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: reservation.email,
      subject: `Confirmation de réservation - ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { 
                    font-family: 'Arial', sans-serif; 
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                .header { 
                    background: #4CAF50; 
                    color: white; 
                    padding: 30px; 
                    text-align: center; 
                    border-radius: 10px 10px 0 0;
                }
                .content { 
                    padding: 30px; 
                    background: #f9f9f9;
                    border-radius: 0 0 10px 10px;
                }
                .details { 
                    background: white; 
                    padding: 20px; 
                    border-radius: 5px; 
                    border-left: 4px solid #4CAF50;
                    margin: 20px 0;
                }
                .footer { 
                    margin-top: 30px; 
                    padding: 20px; 
                    background: #f0f0f0; 
                    text-align: center;
                    border-radius: 5px;
                    font-size: 14px;
                }
                h1 { margin: 0; }
                h3 { color: #4CAF50; }
                .highlight { color: #4CAF50; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>✅ Confirmation de Réservation</h1>
            </div>
            <div class="content">
                <p>Bonjour <span class="highlight">${reservation.prenom} ${reservation.nomclient}</span>,</p>
                <p>Votre réservation a été <span class="highlight">confirmée</span> avec succès.</p>
                
                <div class="details">
                    <h3>📋 Détails de votre réservation :</h3>
                    <p><strong>🏟️ Terrain :</strong> ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}</p>
                    <p><strong>🔢 Numéro :</strong> ${reservation.numeroterrain}</p>
                    <p><strong>📅 Date :</strong> ${new Date(reservation.datereservation).toLocaleDateString('fr-FR')}</p>
                    <p><strong>⏰ Horaire :</strong> ${reservation.heurereservation} - ${reservation.heurefin}</p>
                    <p><strong>⚽ Type :</strong> ${reservation.typeterrain || 'Non spécifié'}</p>
                    <p><strong>💰 Tarif :</strong> ${reservation.tarif || '0'} Dh</p>
                </div>
                
                <p>📎 Vous trouverez la confirmation officielle en PDF jointe à cet email.</p>
                <p>🎯 <strong>Important :</strong> Présentez cette confirmation à votre arrivée au complexe.</p>
                
                <p>Pour toute question, n'hésitez pas à nous contacter.</p>
            </div>
            <div class="footer">
                <p>Cordialement,<br><strong>L'équipe de gestion des terrains</strong></p>
                <p>📞 Contact: [Votre numéro de téléphone]<br>📧 Email: [Votre email de contact]</p>
            </div>
        </body>
        </html>
      `,
      attachments: [
        {
          filename: `confirmation-reservation-${reservation.id}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };
    
    // Envoyer l'email
    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Email envoyé avec succès:', result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    return { success: false, error: error.message };
  } finally {
    // Fermer le transporteur
    if (transporter) {
      transporter.close();
    }
  }
};

// Version simplifiée pour les tests
export const sendTestEmail = async (reservation) => {
  try {
    console.log('📧 Tentative d\'envoi d\'email à:', reservation.email);
    console.log('🔧 Configuration email:', {
      user: process.env.EMAIL_USER ? 'Défini' : 'Non défini',
      pass: process.env.EMAIL_PASS ? 'Défini' : 'Non défini'
    });
    
    // Simuler un envoi réussi pour les tests
    return { success: true, messageId: 'test-' + Date.now(), test: true };
    
  } catch (error) {
    console.error('❌ Erreur test email:', error);
    return { success: false, error: error.message };
  }
};