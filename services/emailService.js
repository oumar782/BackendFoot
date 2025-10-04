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
      
      doc.fillColor('#FFFFFF')
         .fontSize(12)
         .font('Helvetica')
         .text('Votre réservation a été confirmée avec succès', 0, 85, {
           align: 'center',
           width: doc.page.width
         });
      
      // Section informations client
      let yPosition = 150;
      
      doc.fillColor(secondaryColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('INFORMATIONS CLIENT', 50, yPosition);
      
      yPosition += 30;
      
      // Cadre informations client
      doc.rect(50, yPosition, doc.page.width - 100, 80)
         .fillColor(lightGray)
         .fill()
         .strokeColor('#E0E0E0')
         .stroke();
      
      doc.fillColor(darkGray)
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('NOM COMPLET:', 70, yPosition + 20);
      
      doc.fillColor(secondaryColor)
         .fontSize(11)
         .text(`${reservation.prenom} ${reservation.nomclient}`, 150, yPosition + 20);
      
      doc.fillColor(darkGray)
         .text('EMAIL:', 70, yPosition + 40);
      
      doc.fillColor(secondaryColor)
         .text(reservation.email, 150, yPosition + 40);
      
      doc.fillColor(darkGray)
         .text('TÉLÉPHONE:', 70, yPosition + 60);
      
      doc.fillColor(secondaryColor)
         .text(reservation.telephone, 150, yPosition + 60);
      
      yPosition += 110;
      
      // Section détails réservation
      doc.fillColor(secondaryColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('DÉTAILS DE LA RÉSERVATION', 50, yPosition);
      
      yPosition += 30;
      
      // Cadre détails réservation
      doc.rect(50, yPosition, doc.page.width - 100, 120)
         .fillColor(lightGray)
         .fill()
         .strokeColor('#E0E0E0')
         .stroke();
      
      // Colonne gauche
      doc.fillColor(darkGray)
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('TERRAIN:', 70, yPosition + 20);
      
      doc.fillColor(secondaryColor)
         .fontSize(11)
         .text(reservation.nomterrain || 'Terrain ' + reservation.numeroterrain, 150, yPosition + 20);
      
      doc.fillColor(darkGray)
         .text('NUMÉRO:', 70, yPosition + 40);
      
      doc.fillColor(secondaryColor)
         .text(reservation.numeroterrain, 150, yPosition + 40);
      
      doc.fillColor(darkGray)
         .text('TYPE:', 70, yPosition + 60);
      
      doc.fillColor(secondaryColor)
         .text(reservation.typeterrain || 'Non spécifié', 150, yPosition + 60);
      
      doc.fillColor(darkGray)
         .text('SURFACE:', 70, yPosition + 80);
      
      doc.fillColor(secondaryColor)
         .text(reservation.surface || 'Non spécifié', 150, yPosition + 80);
      
      // Colonne droite
      doc.fillColor(darkGray)
         .text('DATE:', 300, yPosition + 20);
      
      doc.fillColor(secondaryColor)
         .text(new Date(reservation.datereservation).toLocaleDateString('fr-FR'), 350, yPosition + 20);
      
      doc.fillColor(darkGray)
         .text('HORAIRE:', 300, yPosition + 40);
      
      doc.fillColor(secondaryColor)
         .text(`${reservation.heurereservation} - ${reservation.heurefin}`, 350, yPosition + 40);
      
      doc.fillColor(darkGray)
         .text('STATUT:', 300, yPosition + 60);
      
      doc.fillColor(accentColor)
         .text(reservation.statut, 350, yPosition + 60);
      
      doc.fillColor(darkGray)
         .text('TARIF:', 300, yPosition + 80);
      
      doc.fillColor(secondaryColor)
         .text(`${reservation.tarif || '0'} Dh`, 350, yPosition + 80);
      
      yPosition += 150;
      
      // Section informations importantes
      doc.rect(50, yPosition, doc.page.width - 100, 60)
         .fillColor('#FFF3CD')
         .fill()
         .strokeColor(accentColor)
         .stroke();
      
      doc.fillColor('#856404')
         .fontSize(10)
         .font('Helvetica-Bold')
         .text('INFORMATIONS IMPORTANTES', 70, yPosition + 15);
      
      doc.fillColor('#856404')
         .fontSize(9)
         .font('Helvetica')
         .text('• Présentez cette confirmation à votre arrivée', 70, yPosition + 30, {
           width: doc.page.width - 140
         });
      
      doc.text('• En cas de retard, veuillez nous contacter', 70, yPosition + 45, {
        width: doc.page.width - 140
      });
      
      // Pied de page
      const footerY = doc.page.height - 50;
      
      doc.strokeColor('#E0E0E0')
         .moveTo(50, footerY)
         .lineTo(doc.page.width - 50, footerY)
         .stroke();
      
      doc.fillColor(darkGray)
         .fontSize(8)
         .text('Document généré automatiquement - ' + new Date().toLocaleDateString('fr-FR'), 0, footerY + 10, {
           align: 'center',
           width: doc.page.width
         });
      
      doc.text('Merci pour votre confiance', 0, footerY + 25, {
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
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 0;
                }
                
                .email-container {
                    background: #FFFFFF;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
                    margin: 20px;
                }
                
                .email-header {
                    background: linear-gradient(135deg, #2E8B57 0%, #27AE60 100%);
                    color: #FFFFFF;
                    padding: 40px 30px;
                    text-align: center;
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
                
                .greeting {
                    font-size: 18px;
                    font-weight: 600;
                    color: #2C3E50;
                    margin-bottom: 24px;
                }
                
                .confirmation-message {
                    background: #E8F5E8;
                    border-left: 4px solid #2E8B57;
                    padding: 20px;
                    border-radius: 0 8px 8px 0;
                    margin-bottom: 32px;
                }
                
                .section {
                    margin-bottom: 32px;
                }
                
                .section-title {
                    font-size: 18px;
                    font-weight: 700;
                    color: #2C3E50;
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 2px solid #ECF0F1;
                }
                
                .info-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 16px;
                }
                
                .info-item {
                    display: flex;
                    flex-direction: column;
                }
                
                .info-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: #7F8C8D;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-bottom: 4px;
                }
                
                .info-value {
                    font-size: 15px;
                    font-weight: 500;
                    color: #2C3E50;
                }
                
                .status-badge {
                    display: inline-block;
                    background: #F39C12;
                    color: #FFFFFF;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                }
                
                .important-notice {
                    background: #FFF3CD;
                    border: 1px solid #FFEAA7;
                    border-radius: 8px;
                    padding: 20px;
                    margin-top: 24px;
                }
                
                .important-notice h4 {
                    color: #856404;
                    margin-bottom: 8px;
                    font-size: 14px;
                }
                
                .important-notice p {
                    color: #856404;
                    font-size: 13px;
                    margin-bottom: 4px;
                }
                
                .email-footer {
                    background: #34495E;
                    color: #FFFFFF;
                    padding: 30px;
                    text-align: center;
                }
                
                .footer-text {
                    font-size: 13px;
                    opacity: 0.8;
                    line-height: 1.5;
                }
                
                @media (max-width: 480px) {
                    .email-container {
                        margin: 10px;
                    }
                    
                    .email-header, .email-content {
                        padding: 30px 20px;
                    }
                    
                    .info-grid {
                        grid-template-columns: 1fr;
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
                    <div class="greeting">
                        Bonjour ${reservation.prenom} ${reservation.nomclient},
                    </div>
                    
                    <div class="confirmation-message">
                        Nous avons le plaisir de vous confirmer que votre réservation a été acceptée. 
                        Retrouvez ci-dessous le détail de votre réservation.
                    </div>
                    
                    <div class="section">
                        <h3 class="section-title">Informations Client</h3>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">Nom Complet</span>
                                <span class="info-value">${reservation.prenom} ${reservation.nomclient}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Email</span>
                                <span class="info-value">${reservation.email}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Téléphone</span>
                                <span class="info-value">${reservation.telephone}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h3 class="section-title">Détails de la Réservation</h3>
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
                                <span class="info-label">Type</span>
                                <span class="info-value">${reservation.typeterrain || 'Non spécifié'}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Surface</span>
                                <span class="info-value">${reservation.surface || 'Non spécifié'}</span>
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
                                <span class="info-label">Statut</span>
                                <span class="status-badge">${reservation.statut}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">Tarif</span>
                                <span class="info-value">${reservation.tarif || '0'} Dh</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="important-notice">
                        <h4>Informations Importantes</h4>
                        <p>• Présentez cette confirmation à votre arrivée</p>
                        <p>• En cas de retard, veuillez nous contacter au plus vite</p>
                        <p>• La confirmation PDF est jointe à cet email</p>
                    </div>
                </div>
                
                <div class="email-footer">
                    <p class="footer-text">
                        Cordialement,<br>
                        <strong>Équipe Terrains de Football</strong><br>
                        <em>Merci pour votre confiance</em>
                    </p>
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