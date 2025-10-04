import { Resend } from 'resend';
import PDFDocument from 'pdfkit';

// Initialisation de Resend avec VOTRE VRAIE CLÉ API
const resend = new Resend(process.env.RESEND_API_KEY);

// Fonction pour générer le PDF PROFESSIONNEL
const generateReservationPDF = (reservation) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `Confirmation Réservation - ${reservation.nomterrain}`,
          Author: 'FootCenter',
          Subject: 'Confirmation de réservation terrain de football'
        }
      });
      
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Couleurs professionnelles
      const primaryColor = '#015502';
      const secondaryColor = '#023803';
      const accentColor = '#8B4513';
      const textColor = '#333333';
      const lightGray = '#f8f9fa';

      // ========== EN-TÊTE PROFESSIONNEL ==========
      doc.rect(0, 0, doc.page.width, 120)
         .fill(primaryColor);
      
      // Logo/texte central
      doc.fillColor('#ffffff')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('⚽ FOOTCENTER', 50, 40, { align: 'center' });
      
      doc.fillColor('rgba(255,255,255,0.8)')
         .fontSize(14)
         .font('Helvetica')
         .text('Votre partenaire football premium', 50, 70, { align: 'center' });
      
      // Titre principal
      doc.fillColor('#ffffff')
         .fontSize(20)
         .font('Helvetica-Bold')
         .text('CONFIRMATION DE RÉSERVATION', 50, 100, { align: 'center' });

      // ========== INFORMATIONS PRINCIPALES ==========
      let yPosition = 160;

      // Carte de réservation
      doc.roundedRect(50, yPosition, doc.page.width - 100, 80, 8)
         .fill(lightGray)
         .stroke(primaryColor);
      
      doc.fillColor(primaryColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('RÉSUMÉ DE LA RÉSERVATION', 70, yPosition + 20);
      
      doc.fillColor(textColor)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text(`Référence: #RES${reservation.id?.toString().padStart(4, '0') || '0000'}`, 70, yPosition + 45)
         .text(`Statut: ${reservation.statut.toUpperCase()}`, 300, yPosition + 45);

      yPosition += 120;

      // ========== SECTION TERRAIN ==========
      doc.fillColor(primaryColor)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text('🏟️ INFORMATIONS TERRAIN', 50, yPosition);
      
      yPosition += 30;

      // Grille d'informations terrain
      const terrainInfo = [
        { label: 'Nom du terrain', value: reservation.nomterrain || 'Terrain Principal' },
        { label: 'Numéro', value: reservation.numeroterrain },
        { label: 'Type de surface', value: reservation.typeterrain || 'Synthétique' },
        { label: 'Surface', value: reservation.surface || 'Standard' },
        { label: 'Tarif', value: `${reservation.tarif || '0'} Dh` }
      ];

      terrainInfo.forEach((info, index) => {
        const x = index % 2 === 0 ? 70 : 300;
        const y = yPosition + Math.floor(index / 2) * 25;
        
        doc.fillColor('#666666')
           .fontSize(10)
           .font('Helvetica')
           .text(info.label + ':', x, y);
        
        doc.fillColor(textColor)
           .fontSize(11)
           .font('Helvetica-Bold')
           .text(info.value, x + 80, y);
      });

      yPosition += 80;

      // ========== SECTION HORAIRE ==========
      doc.fillColor(primaryColor)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text('📅 CRÉNEAU HORAIRE', 50, yPosition);
      
      yPosition += 30;

      doc.roundedRect(70, yPosition, doc.page.width - 140, 60, 5)
         .fill('#fffae6')
         .stroke(accentColor);
      
      const dateObj = new Date(reservation.datereservation);
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const formattedDate = dateObj.toLocaleDateString('fr-FR', options);
      
      doc.fillColor(accentColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text(formattedDate.toUpperCase(), 90, yPosition + 15);
      
      doc.fillColor(textColor)
         .fontSize(16)
         .font('Helvetica-Bold')
         .text(`${reservation.heurereservation} - ${reservation.heurefin}`, 90, yPosition + 35);

      yPosition += 100;

      // ========== SECTION CLIENT ==========
      doc.fillColor(primaryColor)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text('👤 INFORMATIONS CLIENT', 50, yPosition);
      
      yPosition += 30;

      const clientInfo = [
        { label: 'Nom complet', value: `${reservation.prenom} ${reservation.nomclient}` },
        { label: 'Email', value: reservation.email },
        { label: 'Téléphone', value: reservation.telephone },
        { label: 'ID Client', value: `#CLI${reservation.idclient?.toString().padStart(4, '0') || '0000'}` }
      ];

      clientInfo.forEach((info, index) => {
        doc.fillColor('#666666')
           .fontSize(10)
           .font('Helvetica')
           .text(info.label + ':', 70, yPosition + (index * 20));
        
        doc.fillColor(textColor)
           .fontSize(11)
           .font('Helvetica-Bold')
           .text(info.value, 150, yPosition + (index * 20));
      });

      yPosition += 120;

      // ========== INSTRUCTIONS ==========
      doc.fillColor(primaryColor)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text('🎯 INSTRUCTIONS IMPORTANTES', 50, yPosition);
      
      yPosition += 30;

      const instructions = [
        '• Présentez ce document à votre arrivée',
        '• Arrivez 15 minutes avant le début de la réservation',
        '• Équipement sportif recommandé',
        '• Respectez les horaires de réservation',
        '• Contact en cas de problème: +212 5 XX XX XX XX'
      ];

      instructions.forEach((instruction, index) => {
        doc.fillColor(textColor)
           .fontSize(10)
           .font('Helvetica')
           .text(instruction, 70, yPosition + (index * 18));
      });

      yPosition += 120;

      // ========== PIED DE PAGE ==========
      doc.rect(0, doc.page.height - 80, doc.page.width, 80)
         .fill(lightGray);
      
      doc.fillColor(primaryColor)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('FOOTCENTER', 50, doc.page.height - 60);
      
      doc.fillColor('#666666')
         .fontSize(9)
         .font('Helvetica')
         .text('Votre partenaire football de confiance', 50, doc.page.height - 45)
         .text('contact@footcenter.ma • www.footcenter.ma', 50, doc.page.height - 30)
         .text(`Document généré le ${new Date().toLocaleDateString('fr-FR')}`, doc.page.width - 200, doc.page.height - 30, { align: 'right' });

      // Ligne de séparation
      doc.moveTo(50, doc.page.height - 85)
         .lineTo(doc.page.width - 50, doc.page.height - 85)
         .strokeColor(primaryColor)
         .lineWidth(1)
         .stroke();

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Fonction principale pour envoyer l'email PROFESSIONNEL
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

    // Générer le PDF professionnel
    const pdfBuffer = await generateReservationPDF(reservation);
    
    // Formater la date pour l'email
    const dateObj = new Date(reservation.datereservation);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = dateObj.toLocaleDateString('fr-FR', options);

    // Envoyer avec Resend - DESIGN EMAIL PREMIUM
    const { data, error } = await resend.emails.send({
      from: 'FootCenter <confirmation@footcenter.ma>',
      to: [reservation.email],
      subject: `✅ Confirmation Réservation - ${reservation.nomterrain || 'Terrain ' + reservation.numeroterrain}`,
      html: `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmation de Réservation</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }
        
        .email-container {
            max-width: 650px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
        }
        
        /* Header Élégant */
        .email-header {
            background: linear-gradient(135deg, #015502 0%, #023803 100%);
            color: white;
            padding: 50px 40px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        
        .email-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="football" x="0" y="0" width="25" height="25" patternUnits="userSpaceOnUse"><circle cx="12.5" cy="12.5" r="10" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/></pattern></defs><rect width="100" height="100" fill="url(%23football)"/></svg>');
        }
        
        .header-content {
            position: relative;
            z-index: 2;
        }
        
        .logo {
            font-size: 42px;
            margin-bottom: 15px;
        }
        
        .email-header h1 {
            font-size: 32px;
            font-weight: 800;
            margin-bottom: 10px;
            letter-spacing: -0.5px;
        }
        
        .email-header p {
            font-size: 16px;
            opacity: 0.9;
            font-weight: 400;
        }
        
        /* Corps de l'email */
        .email-body {
            padding: 50px 40px;
        }
        
        .greeting {
            font-size: 18px;
            color: #555;
            margin-bottom: 30px;
            line-height: 1.8;
        }
        
        .highlight {
            background: linear-gradient(135deg, #015502, #023803);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 700;
        }
        
        /* Carte de réservation */
        .reservation-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border-radius: 16px;
            padding: 35px;
            margin: 30px 0;
            border-left: 6px solid #015502;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
        }
        
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
            padding-bottom: 20px;
            border-bottom: 2px solid rgba(1, 85, 2, 0.1);
        }
        
        .terrain-info h2 {
            font-size: 24px;
            font-weight: 700;
            color: #015502;
            margin-bottom: 5px;
        }
        
        .terrain-type {
            color: #666;
            font-size: 14px;
            font-weight: 500;
        }
        
        .status-badge {
            background: #d4edda;
            color: #155724;
            padding: 10px 20px;
            border-radius: 25px;
            font-weight: 700;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border: 2px solid #c3e6cb;
        }
        
        /* Grille d'informations */
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 25px;
        }
        
        .info-item {
            display: flex;
            flex-direction: column;
        }
        
        .info-label {
            font-size: 12px;
            font-weight: 600;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
        }
        
        .info-value {
            font-size: 16px;
            font-weight: 600;
            color: #333;
        }
        
        /* Section timing */
        .timing-section {
            background: white;
            border-radius: 12px;
            padding: 25px;
            margin: 25px 0;
            border: 2px solid rgba(1, 85, 2, 0.1);
            text-align: center;
        }
        
        .date-display {
            font-size: 20px;
            font-weight: 700;
            color: #015502;
            margin-bottom: 10px;
        }
        
        .time-display {
            font-size: 28px;
            font-weight: 800;
            color: #333;
            background: linear-gradient(135deg, #015502, #023803);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        /* Section client */
        .client-section {
            background: white;
            border-radius: 12px;
            padding: 25px;
            margin: 25px 0;
            border: 2px solid rgba(1, 85, 2, 0.1);
        }
        
        .section-title {
            font-size: 18px;
            font-weight: 700;
            color: #015502;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
        }
        
        .section-title::before {
            content: '👤';
            margin-right: 10px;
            font-size: 20px;
        }
        
        /* Instructions */
        .instructions {
            background: #fff3cd;
            border: 2px solid #ffeaa7;
            border-radius: 12px;
            padding: 25px;
            margin: 25px 0;
        }
        
        .instructions-title {
            font-size: 16px;
            font-weight: 700;
            color: #856404;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
        }
        
        .instructions-title::before {
            content: '🎯';
            margin-right: 10px;
        }
        
        .instructions-list {
            list-style: none;
        }
        
        .instructions-list li {
            padding: 8px 0;
            border-bottom: 1px solid rgba(133, 100, 4, 0.1);
            font-size: 14px;
            color: #856404;
        }
        
        .instructions-list li:last-child {
            border-bottom: none;
        }
        
        /* Pied de page */
        .email-footer {
            background: #f8f9fa;
            padding: 40px;
            text-align: center;
            color: #6c757d;
        }
        
        .footer-logo {
            font-size: 32px;
            margin-bottom: 15px;
        }
        
        .company-name {
            font-size: 20px;
            font-weight: 700;
            color: #015502;
            margin-bottom: 10px;
        }
        
        .contact-info {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin: 20px 0;
            flex-wrap: wrap;
        }
        
        .contact-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
        }
        
        .signature {
            margin-top: 25px;
            padding-top: 25px;
            border-top: 1px solid #dee2e6;
            font-size: 14px;
        }
        
        /* Responsive */
        @media (max-width: 600px) {
            body {
                padding: 10px;
            }
            
            .email-header {
                padding: 40px 20px;
            }
            
            .email-body {
                padding: 30px 20px;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
            
            .card-header {
                flex-direction: column;
                text-align: center;
                gap: 15px;
            }
            
            .contact-info {
                flex-direction: column;
                gap: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- En-tête Élégant -->
        <div class="email-header">
            <div class="header-content">
                <div class="logo">⚽</div>
                <h1>RÉSERVATION CONFIRMÉE</h1>
                <p>Votre terrain vous attend !</p>
            </div>
        </div>
        
        <!-- Corps de l'email -->
        <div class="email-body">
            <div class="greeting">
                Bonjour <span class="highlight">${reservation.prenom} ${reservation.nomclient}</span>,<br>
                Votre réservation a été <span class="highlight">confirmée avec succès</span>. 
                Nous avons hâte de vous accueillir !
            </div>
            
            <!-- Carte de réservation -->
            <div class="reservation-card">
                <div class="card-header">
                    <div class="terrain-info">
                        <h2>${reservation.nomterrain || 'Terrain Football'}</h2>
                        <div class="terrain-type">Terrain n°${reservation.numeroterrain} • ${reservation.typeterrain || 'Synthétique'}</div>
                    </div>
                    <div class="status-badge">${reservation.statut || 'Confirmée'}</div>
                </div>
                
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Référence</span>
                        <span class="info-value">#RES${reservation.id?.toString().padStart(4, '0') || '0000'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Surface</span>
                        <span class="info-value">${reservation.surface || 'Standard'}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Tarif</span>
                        <span class="info-value highlight">${reservation.tarif || '0'} Dh</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">ID Client</span>
                        <span class="info-value">#CLI${reservation.idclient?.toString().padStart(4, '0') || '0000'}</span>
                    </div>
                </div>
            </div>
            
            <!-- Section Timing -->
            <div class="timing-section">
                <div class="date-display">${formattedDate}</div>
                <div class="time-display">${reservation.heurereservation} - ${reservation.heurefin}</div>
            </div>
            
            <!-- Section Client -->
            <div class="client-section">
                <div class="section-title">Informations Client</div>
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
            
            <!-- Instructions -->
            <div class="instructions">
                <div class="instructions-title">Instructions Importantes</div>
                <ul class="instructions-list">
                    <li>📋 Présentez votre confirmation à l'arrivée</li>
                    <li>⏰ Arrivez 15 minutes avant le début</li>
                    <li>👕 Équipement sportif recommandé</li>
                    <li>📞 Contact: +212 5 XX XX XX XX</li>
                </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <p style="color: #666; font-size: 14px;">
                    📎 Votre confirmation détaillée est disponible en pièce jointe
                </p>
            </div>
        </div>
        
        <!-- Pied de page -->
        <div class="email-footer">
            <div class="footer-logo">⚽</div>
            <div class="company-name">FOOTCENTER</div>
            <p style="margin-bottom: 20px;">Votre partenaire football premium</p>
            
            <div class="contact-info">
                <div class="contact-item">
                    <span>📞</span>
                    <span>+212 5 XX XX XX XX</span>
                </div>
                <div class="contact-item">
                    <span>📧</span>
                    <span>contact@footcenter.ma</span>
                </div>
                <div class="contact-item">
                    <span>🌐</span>
                    <span>www.footcenter.ma</span>
                </div>
            </div>
            
            <div class="signature">
                Merci de votre confiance ! À très bientôt sur le terrain 🎯
            </div>
        </div>
    </div>
</body>
</html>
      `,
      attachments: [
        {
          filename: `Confirmation_Reservation_${reservation.nomterrain}_${reservation.datereservation}.pdf`,
          content: pdfBuffer.toString('base64'),
        }
      ]
    });

    if (error) {
      console.error('❌ Erreur Resend:', error);
      return { success: false, error: error.message };
    }

    console.log('✅ Email professionnel envoyé avec succès! ID:', data.id);
    return { success: true, messageId: data.id };
    
  } catch (error) {
    console.error('❌ Erreur critique:', error);
    return { success: false, error: error.message };
  }
};