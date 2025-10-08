import express from "express";
import db from "./db.js";
import cors from 'cors';
import dotenv from 'dotenv';

// Importation des routes
import creneauxRoutes from './Gestion/creneaux.js';
import Reservation from './Gestion/reservation.js';
import Contact from './Gestion/contact.js';
import creneauxRoute from './Gestion/gestionCreneaux.js';
import User from './Gestion/user.js';
import Terrain from './Gestion/terrain.js';
import Client from './Gestion/clients.js';
import CalendriersRouter from './Gestion/calendrier.js';
import demo from './Gestion/demonstration.js';
import prev from './Gestion/prev.js';

dotenv.config();
const app = express();

// ✅ CORS bien configuré
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://footspace-reserve.netlify.app",
      "https://frabjous-gaufre-31e862.netlify.app",
      "https://footspace-solutions.vercel.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// 📄 Route racine
app.get('/', (req, res) => {
  res.json({
    message: '✅ Serveur backend FootSpace en marche',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Utilisation des routeurs
app.use('/api/creneaux', creneauxRoutes);
app.use('/api/clients', Client);
app.use('/api/user', User);
app.use('/api/terrain', Terrain);
app.use('/api/reservation', Reservation);
app.use('/api/contact', Contact);
app.use('/api/gestioncreneaux', creneauxRoute);
app.use('/api/demonstration', demo);
app.use('/api/prevision', prev);
app.use('/api/calendriers', CalendriersRouter);

// 🏥 Health check endpoint amélioré
app.get('/api/health', async (req, res) => {
  try {
    // Tester la connexion à la base de données
    const dbResult = await db.query('SELECT NOW() as current_time');
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: 'connected',
      databaseTime: dbResult.rows[0].current_time,
      resendConfigured: !!process.env.RESEND_API_KEY,
      cloudinaryConfigured: !!process.env.CLOUDINARY_CLOUD_NAME
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// 📧 Route pour tester l'envoi d'email
app.get('/api/test-email', async (req, res) => {
  try {
    const { sendReservationConfirmation } = await import('./services/emailService.js');
    
    const testReservation = {
      id: 'test-' + Date.now(),
      datereservation: new Date().toISOString().split('T')[0],
      heurereservation: '14:00',
      heurefin: '16:00',
      statut: 'confirmée',
      idclient: 1,
      numeroterrain: 1,
      nomclient: 'Test',
      prenom: 'Utilisateur',
      email: 'test@example.com', // Remplacez par un email valide pour tester
      telephone: '0123456789',
      typeterrain: 'Synthétique',
      tarif: 150,
      surface: '100m²',
      nomterrain: 'Stade Principal'
    };

    console.log('🧪 Test d\'envoi d\'email en cours...');
    const result = await sendReservationConfirmation(testReservation);
    
    res.json({
      success: result.success,
      message: result.success ? 'Email de test envoyé avec succès' : 'Erreur lors de l\'envoi',
      error: result.error,
      reservation: testReservation,
      resendConfigured: !!process.env.RESEND_API_KEY
    });
  } catch (error) {
    console.error('❌ Erreur test email:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du test d\'email',
      error: error.message,
      resendConfigured: !!process.env.RESEND_API_KEY
    });
  }
});

// 🔧 Route pour vérifier la configuration
app.get('/api/config', (req, res) => {
  // Ne pas exposer les clés sensibles en production
  const safeConfig = {
    success: true,
    nodeEnv: process.env.NODE_ENV,
    resendConfigured: !!process.env.RESEND_API_KEY,
    cloudinaryConfigured: !!process.env.CLOUDINARY_CLOUD_NAME,
    databaseConfigured: !!process.env.DATABASE_URL,
    keyLengths: {
      resend: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.length : 0,
      cloudinary: process.env.CLOUDINARY_API_KEY ? process.env.CLOUDINARY_API_KEY.length : 0
    }
  };
  
  res.json(safeConfig);
});

// 🚨 Gestion des erreurs améliorée
app.use((err, req, res, next) => {
  console.error('❌ Erreur:', err.stack);
  
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      success: false,
      message: 'Erreur de validation',
      errors: err.errors
    });
  }

  // Erreur Resend spécifique
  if (err.message?.includes('Resend') || err.message?.includes('email')) {
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi de l\'email',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Service email temporairement indisponible'
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 🚀 Lancement serveur avec logs détaillés
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
🚀 Serveur FootSpace lancé sur le port ${PORT}
🌍 Environnement: ${process.env.NODE_ENV || 'development'}
📧 Resend configuré: ${process.env.RESEND_API_KEY ? '✅ OUI' : '❌ NON'}
☁️  Cloudinary configuré: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅ OUI' : '❌ NON'}
🗄️  Base de données: ${process.env.DATABASE_URL ? '✅ CONFIGURÉE' : '❌ NON CONFIGURÉE'}
  
📋 Routes disponibles:
   • GET  /api/health - Santé de l'API
   • GET  /api/config - Configuration
   • GET  /api/test-email - Test d'envoi d'email
   • GET  /api/reservation - Réservations
   • POST /api/reservation - Nouvelle réservation
  `);
  
  // Avertissements de configuration
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  RESEND_API_KEY manquante - Les emails ne fonctionneront pas');
  }
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL manquante - La base de données ne fonctionnera pas');
  }
});

export default app;