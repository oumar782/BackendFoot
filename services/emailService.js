import { Resend } from 'resend';
import PDFDocument from 'pdfkit';

// Initialisation de Resend avec VOTRE VRAIE CLÉ API
const resend = new Resend(process.env.RESEND_API_KEY);

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
      
      doc.moveDown(2);
      doc.fontSize(10).text('Document généré automatiquement - ' + new Date().toLocaleDateString('fr-FR'), { align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Fonction principale pour envoyer l'email
export const sendReservationConfirmation = async (reservation) => {
  try {
    // Vérification de la clé API
    if (!process.env.RESEND_API_KEY) {
      console.error('❌ CLÉ RESEND MANQUANTE - Configurez RESEND_API_KEY dans Vercel');
      return { 
        success: false, 
        error: 'Clé API Resend non configurée. Ajoutez RESEND_API_KEY dans les variables d\'environnement.' 
      };
    }

    // Vérification de l'email du client
    if (!reservation.email) {
      console.error('❌ Email du client manquant');
      return { success: false, error: 'Email du client manquant' };
    }

    console.log('🔑 Clé Resend configurée:', process.env.RESEND_API_KEY ? 'OUI' : 'NON');
    console.log('📧 Envoi à:', reservation.email);

    // Générer le PDF
    const pdfBuffer = await generateReservationPDF(reservation);
    
    // Envoyer avec Resend
    const { data, error } = await resend.emails.send({
      from: 'Confirmation Réservation <onboarding@resend.dev>',
      to: [reservation.email],
      subject: `✅ Confirmation - ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #4CAF50; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { padding: 30px; background: #f9f9f9; border-radius: 0 0 10px 10px; }
                .details { background: white; padding: 20px; border-radius: 5px; border-left: 4px solid #4CAF50; margin: 20px 0; }
                .footer { margin-top: 30px; padding: 20px; background: #f0f0f0; text-align: center; border-radius: 5px; font-size: 14px; }
                .highlight { color: #4CAF50; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>✅ Réservation Confirmée</h1>
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
                <p>🎯 <strong>Important :</strong> Présentez cette confirmation à votre arrivée.</p>
            </div>
            <div class="footer">
                <p>Cordialement,<br><strong>Équipe Terrains de Football</strong></p>
            </div>
        </body>
        </html>
      `,
      attachments: [
        {
          filename: `confirmation-reservation-${reservation.id}.pdf`,
          content: pdfBuffer.toString('base64'),
        }
      ]
    });

    if (error) {
      console.error('❌ Erreur Resend:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ Email envoyé avec succès! ID:', data.id);
    return { success: true, messageId: data.id };
    
  } catch (error) {
    console.error('❌ Erreur critique:', error);
    return { success: false, error: error.message };
  }
};