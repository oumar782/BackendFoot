import { Resend } from 'resend';
import PDFDocument from 'pdfkit';

const resend = new Resend(process.env.RESEND_API_KEY);

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
    if (!process.env.RESEND_API_KEY) {
      console.error('CLÉ RESEND MANQUANTE - Configurez RESEND_API_KEY dans Vercel');
      return { 
        success: false, 
        error: 'Clé API Resend non configurée. Ajoutez RESEND_API_KEY dans les variables d\'environnement.' 
      };
    }

    if (!reservation.email) {
      console.error('Email du client manquant');
      return { success: false, error: 'Email du client manquant' };
    }

    console.log('Clé Resend configurée:', process.env.RESEND_API_KEY ? 'OUI' : 'NON');
    console.log('Envoi à:', reservation.email);

    const pdfBuffer = await generateReservationPDF(reservation);
    
    const { data, error } = await resend.emails.send({
      from: 'Confirmation Réservation <onboarding@resend.dev>',
      to: [reservation.email],
      subject: `Confirmation de réservation - ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    line-height: 1.6; 
                    color: #2C3E50; 
                    background-color: #F5F7FA;
                }
                .email-container { 
                    max-width: 600px; 
                    margin: 40px auto; 
                    background: #FFFFFF;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
                }
                .header { 
                    background: linear-gradient(135deg, #2C3E50 0%, #34495E 100%);
                    color: white; 
                    padding: 50px 40px;
                    text-align: center;
                }
                .header h1 { 
                    font-size: 28px;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    margin: 0;
                }
                .header p {
                    margin-top: 10px;
                    font-size: 14px;
                    opacity: 0.9;
                }
                .content { 
                    padding: 40px;
                }
                .greeting {
                    font-size: 16px;
                    margin-bottom: 20px;
                    color: #2C3E50;
                }
                .greeting .name {
                    font-weight: 600;
                    color: #27AE60;
                }
                .message {
                    font-size: 15px;
                    color: #5D6D7E;
                    margin-bottom: 30px;
                    line-height: 1.8;
                }
                .details-box { 
                    background: #F8F9FA;
                    border-left: 4px solid #27AE60;
                    padding: 30px;
                    margin: 30px 0;
                    border-radius: 8px;
                }
                .details-box h2 {
                    font-size: 18px;
                    margin-bottom: 20px;
                    color: #2C3E50;
                    font-weight: 600;
                }
                .detail-row {
                    display: table;
                    width: 100%;
                    padding: 12px 0;
                    border-bottom: 1px solid #E8EBED;
                }
                .detail-row:last-child {
                    border-bottom: none;
                }
                .detail-label {
                    display: table-cell;
                    font-size: 13px;
                    color: #7F8C8D;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .detail-value {
                    display: table-cell;
                    text-align: right;
                    font-size: 15px;
                    color: #2C3E50;
                    font-weight: 600;
                }
                .tarif-box {
                    background: linear-gradient(135deg, #27AE60 0%, #229954 100%);
                    color: white;
                    padding: 25px 30px;
                    margin: 30px 0;
                    border-radius: 8px;
                    text-align: center;
                }
                .tarif-box .label {
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    opacity: 0.9;
                    margin-bottom: 8px;
                }
                .tarif-box .amount {
                    font-size: 32px;
                    font-weight: 700;
                    letter-spacing: 1px;
                }
                .important-note {
                    background: #FFF3CD;
                    border-left: 4px solid #FFC107;
                    padding: 20px;
                    margin: 25px 0;
                    border-radius: 8px;
                }
                .important-note p {
                    margin: 0;
                    color: #856404;
                    font-size: 14px;
                    line-height: 1.6;
                }
                .important-note strong {
                    display: block;
                    margin-bottom: 8px;
                    font-size: 15px;
                }
                .footer { 
                    background: #F8F9FA;
                    padding: 30px 40px;
                    text-align: center;
                    border-top: 1px solid #E8EBED;
                }
                .footer p {
                    margin: 8px 0;
                    font-size: 14px;
                    color: #7F8C8D;
                }
                .footer .company {
                    font-weight: 600;
                    color: #2C3E50;
                    font-size: 15px;
                }
                @media only screen and (max-width: 600px) {
                    .email-container { margin: 20px; }
                    .header { padding: 30px 20px; }
                    .content { padding: 25px 20px; }
                    .details-box { padding: 20px; }
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="header">
                    <h1>CONFIRMATION DE RÉSERVATION</h1>
                    <p>Votre réservation a été confirmée avec succès</p>
                </div>
                
                <div class="content">
                    <p class="greeting">
                        Bonjour <span class="name">${reservation.prenom} ${reservation.nomclient}</span>,
                    </p>
                    
                    <p class="message">
                        Nous avons le plaisir de confirmer votre réservation. Vous trouverez ci-dessous tous les détails concernant votre réservation ainsi qu'une confirmation officielle en pièce jointe au format PDF.
                    </p>
                    
                    <div class="details-box">
                        <h2>Détails de votre réservation</h2>
                        
                        <div class="detail-row">
                            <span class="detail-label">Terrain</span>
                            <span class="detail-value">${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}</span>
                        </div>
                        
                        <div class="detail-row">
                            <span class="detail-label">Numéro</span>
                            <span class="detail-value">${reservation.numeroterrain}</span>
                        </div>
                        
                        <div class="detail-row">
                            <span class="detail-label">Type de terrain</span>
                            <span class="detail-value">${reservation.typeterrain || 'Non spécifié'}</span>
                        </div>
                        
                        <div class="detail-row">
                            <span class="detail-label">Date</span>
                            <span class="detail-value">${new Date(reservation.datereservation).toLocaleDateString('fr-FR', { 
                                weekday: 'long', 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric' 
                            })}</span>
                        </div>
                        
                        <div class="detail-row">
                            <span class="detail-label">Horaire</span>
                            <span class="detail-value">${reservation.heurereservation} - ${reservation.heurefin}</span>
                        </div>
                        
                        <div class="detail-row">
                            <span class="detail-label">Statut</span>
                            <span class="detail-value">${reservation.statut}</span>
                        </div>
                    </div>
                    
                    <div class="tarif-box">
                        <div class="label">Tarif total</div>
                        <div class="amount">${reservation.tarif || '0'} Dh</div>
                    </div>
                    
                    <div class="important-note">
                        <p><strong>Important</strong> Veuillez présenter cette confirmation lors de votre arrivée. Nous vous recommandons d'arriver quelques minutes avant l'heure prévue.</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p>Cordialement,</p>
                    <p class="company">Équipe Terrains de Football</p>
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