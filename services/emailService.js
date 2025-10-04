import { Resend } from 'resend';
import PDFDocument from 'pdfkit';

// Initialisation de Resend avec VOTRE VRAIE CLÉ API
const resend = new Resend(process.env.RESEND_API_KEY);

// Fonction pour générer le PDF
const generateReservationPDF = (reservation) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50
        }
      });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      
      // Couleurs professionnelles
      const primaryColor = '#2E8B57';
      const secondaryColor = '#34495E';
      const accentColor = '#F39C12';
      const lightGray = '#F8F9FA';
      const darkGray = '#7F8C8D';
      
      // En-tête avec fond coloré
      doc.rect(0, 0, doc.page.width, 120)
         .fill(primaryColor);
      
      doc.fillColor('#FFFFFF')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('CONFIRMATION DE RÉSERVATION', 0, 50, { 
           align: 'center',
           width: doc.page.width 
         });
      
      doc.fontSize(12)
         .fillColor('rgba(255,255,255,0.8)')
         .text('Votre réservation a été confirmée avec succès', 0, 85, {
           align: 'center',
           width: doc.page.width
         });
      
      // Section informations client
      doc.y = 150;
      doc.fillColor(secondaryColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('INFORMATIONS CLIENT', 50, doc.y);
      
      doc.moveDown(0.5);
      doc.rect(50, doc.y, doc.page.width - 100, 1)
         .fill(accentColor);
      doc.moveDown(1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica');
      
      const clientInfo = [
        { label: 'Nom complet', value: `${reservation.prenom} ${reservation.nomclient}` },
        { label: 'Email', value: reservation.email },
        { label: 'Téléphone', value: reservation.telephone }
      ];
      
      clientInfo.forEach(info => {
        doc.fillColor(secondaryColor)
           .font('Helvetica-Bold')
           .text(`${info.label}:`, { continued: true })
           .fillColor(darkGray)
           .font('Helvetica')
           .text(` ${info.value}`);
        doc.moveDown(0.3);
      });
      
      // Section détails réservation
      doc.moveDown(1);
      doc.fillColor(secondaryColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('DÉTAILS DE LA RÉSERVATION');
      
      doc.moveDown(0.5);
      doc.rect(50, doc.y, doc.page.width - 100, 1)
         .fill(accentColor);
      doc.moveDown(1);
      
      const reservationDetails = [
        { label: 'Terrain', value: reservation.nomterrain || 'Terrain ' + reservation.numeroterrain },
        { label: 'Numéro de terrain', value: reservation.numeroterrain },
        { label: 'Type', value: reservation.typeterrain || 'Non spécifié' },
        { label: 'Surface', value: reservation.surface || 'Non spécifié' },
        { label: 'Date', value: new Date(reservation.datereservation).toLocaleDateString('fr-FR') },
        { label: 'Horaire', value: `${reservation.heurereservation} - ${reservation.heurefin}` },
        { label: 'Statut', value: reservation.statut },
        { label: 'Tarif', value: `${reservation.tarif || '0'} Dh` }
      ];
      
      reservationDetails.forEach(detail => {
        doc.fillColor(secondaryColor)
           .font('Helvetica-Bold')
           .text(`${detail.label}:`, { continued: true })
           .fillColor(darkGray)
           .font('Helvetica')
           .text(` ${detail.value}`);
        doc.moveDown(0.3);
      });
      
      // Section informations importantes
      doc.moveDown(1.5);
      doc.fillColor(secondaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('INFORMATIONS IMPORTANTES');
      
      doc.moveDown(0.5);
      doc.rect(50, doc.y, doc.page.width - 100, 1)
         .fill(accentColor);
      doc.moveDown(1);
      
      doc.fillColor(darkGray)
         .fontSize(10)
         .font('Helvetica')
         .text('• Présentez cette confirmation à votre arrivée au complexe sportif.', {
           indent: 10
         });
      doc.moveDown(0.3);
      doc.text('• En cas de retard supérieur à 15 minutes, la réservation pourra être annulée.', {
        indent: 10
      });
      doc.moveDown(0.3);
      doc.text('• Le paiement est à effectuer sur place selon les modalités prévues.', {
        indent: 10
      });
      
      // Pied de page
      const footerY = doc.page.height - 50;
      doc.rect(0, footerY, doc.page.width, 1)
         .fill(lightGray);
      
      doc.fillColor(darkGray)
         .fontSize(8)
         .text('Document généré automatiquement - ' + new Date().toLocaleDateString('fr-FR'), 0, footerY + 15, {
           align: 'center',
           width: doc.page.width
         });
      
      doc.text('Merci pour votre confiance et à bientôt !', 0, footerY + 30, {
        align: 'center',
        width: doc.page.width
      });
      
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
      console.error('CLÉ RESEND MANQUANTE - Configurez RESEND_API_KEY dans Vercel');
      return { 
        success: false, 
        error: 'Clé API Resend non configurée. Ajoutez RESEND_API_KEY dans les variables d\'environnement.' 
      };
    }

    // Vérification de l'email du client
    if (!reservation.email) {
      console.error('Email du client manquant');
      return { success: false, error: 'Email du client manquant' };
    }

    console.log('Clé Resend configurée:', process.env.RESEND_API_KEY ? 'OUI' : 'NON');
    console.log('Envoi à:', reservation.email);

    // Générer le PDF
    const pdfBuffer = await generateReservationPDF(reservation);
    
    // Envoyer avec Resend
    const { data, error } = await resend.emails.send({
      from: 'Réservation Terrains <confirmation@votre-domaine.com>',
      to: [reservation.email],
      subject: `Confirmation de Réservation - ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
                
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    line-height: 1.6;
                    color: #34495E;
                    background-color: #F8F9FA;
                    margin: 0;
                    padding: 0;
                }
                
                .email-container {
                    max-width: 600px;
                    margin: 0 auto;
                    background: #FFFFFF;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                }
                
                .email-header {
                    background: linear-gradient(135deg, #2E8B57 0%, #27AE60 100%);
                    padding: 40px 30px;
                    text-align: center;
                    color: #FFFFFF;
                }
                
                .email-header h1 {
                    font-size: 28px;
                    font-weight: 700;
                    margin-bottom: 8px;
                    letter-spacing: -0.5px;
                }
                
                .email-header p {
                    font-size: 16px;
                    font-weight: 400;
                    opacity: 0.9;
                }
                
                .email-content {
                    padding: 40px 30px;
                }
                
                .section {
                    margin-bottom: 32px;
                }
                
                .section-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: #2C3E50;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 2px solid #F39C12;
                }
                
                .info-grid {
                    display: grid;
                    grid-template-columns: 1fr;
                    gap: 12px;
                }
                
                .info-item {
                    display: flex;
                    justify-content: space-between;
                    padding: 12px 0;
                    border-bottom: 1px solid #ECF0F1;
                }
                
                .info-label {
                    font-weight: 500;
                    color: #2C3E50;
                }
                
                .info-value {
                    font-weight: 400;
                    color: #7F8C8D;
                    text-align: right;
                }
                
                .highlight-box {
                    background: linear-gradient(135deg, #FFF3E0 0%, #FFECB3 100%);
                    border-left: 4px solid #F39C12;
                    padding: 20px;
                    border-radius: 8px;
                    margin: 24px 0;
                }
                
                .highlight-title {
                    font-weight: 600;
                    color: #E67E22;
                    margin-bottom: 8px;
                }
                
                .instructions {
                    background: #F8F9FA;
                    border-radius: 8px;
                    padding: 20px;
                    margin-top: 24px;
                }
                
                .instructions ul {
                    list-style: none;
                    padding: 0;
                }
                
                .instructions li {
                    padding: 6px 0;
                    position: relative;
                    padding-left: 20px;
                }
                
                .instructions li:before {
                    content: "•";
                    color: #2E8B57;
                    font-weight: bold;
                    position: absolute;
                    left: 0;
                }
                
                .email-footer {
                    background: #2C3E50;
                    color: #BDC3C7;
                    padding: 30px;
                    text-align: center;
                    font-size: 14px;
                }
                
                .footer-text {
                    margin-bottom: 8px;
                }
                
                .confirmation-badge {
                    display: inline-block;
                    background: #27AE60;
                    color: #FFFFFF;
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 16px;
                }
                
                @media (max-width: 600px) {
                    .email-header {
                        padding: 30px 20px;
                    }
                    
                    .email-content {
                        padding: 30px 20px;
                    }
                    
                    .info-item {
                        flex-direction: column;
                        gap: 4px;
                    }
                    
                    .info-value {
                        text-align: left;
                    }
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="email-header">
                    <h1>Réservation Confirmée</h1>
                    <p>Votre réservation a été validée avec succès</p>
                </div>
                
                <div class="email-content">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <span class="confirmation-badge">RÉSERVATION CONFIRMÉE</span>
                    </div>
                    
                    <p style="margin-bottom: 24px; font-size: 16px;">
                        Bonjour <strong>${reservation.prenom} ${reservation.nomclient}</strong>,<br>
                        Nous avons le plaisir de vous confirmer votre réservation.
                    </p>
                    
                    <div class="section">
                        <div class="section-title">Détails de la Réservation</div>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Terrain</span>
                                <span class="info-value">${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Numéro</span>
                                <span class="info-value">${reservation.numeroterrain}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Date</span>
                                <span class="info-value">${new Date(reservation.datereservation).toLocaleDateString('fr-FR')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Horaire</span>
                                <span class="info-value">${reservation.heurereservation} - ${reservation.heurefin}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Type</span>
                                <span class="info-value">${reservation.typeterrain || 'Non spécifié'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Tarif</span>
                                <span class="info-value">${reservation.tarif || '0'} Dh</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="highlight-box">
                        <div class="highlight-title">Votre confirmation</div>
                        <p style="margin: 0; color: #7F8C8D;">
                            Vous trouverez votre confirmation officielle en pièce jointe. 
                            Présentez ce document à votre arrivée.
                        </p>
                    </div>
                    
                    <div class="instructions">
                        <div style="font-weight: 600; margin-bottom: 12px; color: #2C3E50;">
                            Informations importantes :
                        </div>
                        <ul>
                            <li>Merci de vous présenter 10 minutes avant l'horaire réservé</li>
                            <li>En cas de retard supérieur à 15 minutes, la réservation pourra être annulée</li>
                            <li>Le paiement est à effectuer sur place selon les modalités prévues</li>
                            <li>Présentez cette confirmation à l'accueil</li>
                        </ul>
                    </div>
                </div>
                
                <div class="email-footer">
                    <div class="footer-text">Équipe Terrains de Football</div>
                    <div class="footer-text">Merci pour votre confiance et à bientôt !</div>
                    <div style="margin-top: 16px; font-size: 12px; color: #95A5A6;">
                        Ce message a été généré automatiquement. Merci de ne pas y répondre.
                    </div>
                </div>
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
      console.error('Erreur Resend:', error);
      return { success: false, error: error.message };
    }

    console.log('Email envoyé avec succès! ID:', data.id);
    return { success: true, messageId: data.id };
    
  } catch (error) {
    console.error('Erreur critique:', error);
    return { success: false, error: error.message };
  }
};