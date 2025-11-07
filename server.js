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

// ✅ CORS ULTRA-PERMISSIF - Solution garantie
app.use(cors({
  origin: true, // Autorise toutes les origines
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));

// Alternative plus sécurisée mais toujours permissive :
// app.use(cors({
//   origin: [
//     "http://localhost:5173",
//     "http://localhost:5174", 
//     "http://localhost:5175",
//     "https://footspace-reserve.netlify.app",
//     "https://frabjous-gaufre-31e862.netlify.app",
//     "https://footspace-solutions.vercel.app",
//     /\.netlify\.app$/,
//     /\.vercel\.app$/
//   ],
//   credentials: true,
//   methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//   allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
// }));

// Middleware pour gérer les pré-vols OPTIONS manuellement
app.options('*', cors());

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
      email: 'test@example.com',
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
  const safeConfig = {
    success: true,
    nodeEnv: process.env.NODE_ENV,
    resendConfigured: !!process.env.RESEND_API_KEY,
    cloudinaryConfigured: !!process.env.CLOUDINARY_CLOUD_NAME,
    databaseConfigured: !!process.env.DATABASE_URL,
    corsEnabled: true
  };
  
  res.json(safeConfig);
});

// 🚀 Lancement serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
🚀 Serveur FootSpace lancé sur le port ${PORT}
🌍 Environnement: ${process.env.NODE_ENV || 'development'}
🌐 CORS: ✅ ACTIVÉ POUR TOUTES LES ORIGINES
📧 Resend configuré: ${process.env.RESEND_API_KEY ? '✅ OUI' : '❌ NON'}
☁️  Cloudinary configuré: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅ OUI' : '❌ NON'}
🗄️  Base de données: ${process.env.DATABASE_URL ? '✅ CONFIGURÉE' : '❌ NON CONFIGURÉE'}
  `);
});

export default app;