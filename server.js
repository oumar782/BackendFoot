// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// ⚠️ Charger dotenv EN PREMIER
dotenv.config();

// Import de la DB (après dotenv pour que DATABASE_URL soit dispo)
import db from "./db.js";

// ============================================
// IMPORTATION DES ROUTES
// ============================================
// ⚠️ IMPORTANT : Ces routes DOIVENT être décommentées si vous les utilisez dans app.use()
// Si vous ne les utilisez pas, laissez-les commentées ET commentez aussi le app.use() correspondant

// Route CRITIQUE utilisée plus bas
import CreneauxAnalyses from './Gestion/creneaux_analyse.js';

// Autres routes (décommentez au besoin)
// import Souscription from './Gestion/Souscription.js';
// import UserInsights from './Gestion/user-insights.js';
// import Contact from './Gestion/contact.js';
// import creneauxRoute from './Gestion/gestionCreneaux.js';
// import User from './Gestion/user.js';
// import Terrain from './Gestion/terrain.js';
// import Client from './Gestion/clients.js';
// import CalendriersRouter from './Gestion/calendrier.js';
// import demo from './Gestion/demonstration.js';
// import prev from './Gestion/prev.js';
// import Commande from './Gestion/commande.js';
// import Annalyse from './Gestion/Annalyse-financiere.js';
// import Analysecren from './Gestion/Analyse-cren.js';
// import Abonne from './Gestion/Abonne.js';
// import SousAbonne from './Gestion/souscripanalyse.js';
// import Créneaux from './Gestion/creneaux.js';
// import Contactan from './Gestion/ContactAnalytics.js';
// import Joueur from './Gestion/Joueur.js';
// import Reservation from './Gestion/reservation.js';
// import Prevan from './Gestion/prevann.js';
// import Anademo from './Gestion/Anademo.js';
// import Proprietaire from './Gestion/Proprietaire.js';
// import Anareserve from './Gestion/Analyse-reservation.js';
// import Sessions from './Gestion/sessions.js';
// import Coach from './Gestion/coach.js';
// import tournoi from './Gestion/tournoi.js';
// import Boutique from './Gestion/Boutique.js';
import communityRoutes from './Gestion/communities.js';

// Sesi
// import prestation from './Gestion/Prestasesi.js';
// import contactesi from './Gestion/contactsesi.js';
// import Appointments from './Gestion/Appointments.js';
import PlayForestAuth from './Gestion/Auths.js';
// import tournamentAnalyticsApi from './tournament-analytics/app.js';

// ============================================
// INITIALISATION APP
// ============================================
const app = express();

// ============================================
// MIDDLEWARES GLOBAUX
// ============================================
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "https://footspace-reserve.netlify.app",
      "https://frabjous-gaufre-31e862.netlify.app",
      "https://footspace-solutions.vercel.app",
      "https://dashboardsesi.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// app.use('/api/v1', tournamentAnalyticsApi);

// ============================================
// ROUTE RACINE
// ============================================
app.get('/', (req, res) => {
  res.json({
    message: '✅ Serveur backend FootSpace en marche',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ============================================
// ROUTES PRINCIPALES
// ============================================

// --- Route analyses créneaux (CRITIQUE) ---
if (CreneauxAnalyses && typeof CreneauxAnalyses === 'function') {
  console.log('✅ Chargement du routeur CreneauxAnalyses...');
  app.use('/api/creneaux-analyses', CreneauxAnalyses);
  console.log('✅ Routeur /api/creneaux-analyses monté avec succès');
} else {
  console.error('❌ ERREUR: CreneauxAnalyses n\'est pas un routeur Express valide');
  console.error('   Type reçu :', typeof CreneauxAnalyses);
  console.error('   Vérifiez que ./Gestion/creneaux_analyse.js exporte bien un router (export default router)');
}

// --- Autres routes (décommentez au besoin, en cohérence avec les imports ci-dessus) ---
// app.use('/api/clients', Client);
// app.use('/api/user', User);
// app.use('/api/terrain', Terrain);
// app.use('/api/ana-souscription', SousAbonne);
// app.use('/api/reservation', Reservation);
// app.use('/api/contact', Contact);
// app.use('/api/gestioncreneaux', creneauxRoute);
// app.use('/api/souscription', Souscription);
// app.use('/api/demonstration', demo);
// app.use('/api/prevision', prev);
// app.use('/api/calendriers', CalendriersRouter);
// app.use('/api/prevannule', Prevan);
// app.use('/api/commande', Commande);
// app.use('/api/annalyse', Annalyse);
// app.use('/api/annalyse-creneaux', Analysecren);
// app.use('/api/annalyse-abonnes', Abonne);
// app.use('/api/user-insights', UserInsights);
// app.use('/api/creneaux', Créneaux);
// app.use('/api/ana-demo', Anademo);
// app.use('/api/contact-analytics', Contactan);
// app.use('/api/proprietaire', Proprietaire);
// app.use('/api/joueur', Joueur);
// app.use('/api/sessions', Sessions);
// app.use('/api/coach', Coach);
// app.use('/api/tournoi', tournoi);
app.use('/api/communities', communityRoutes);
// app.use('/api/boutique', Boutique);
// app.use('/api/analyse-reservation', Anareserve);

// Sesi
// app.use('/api/prestation', prestation);
// app.use('/api/contactesi', contactesi);
// app.use('/api/Appointments', Appointments);

// PlayForest — auth + préférences onboarding
app.use('/api/auth', PlayForestAuth);
app.use('/api/authentification', PlayForestAuth);

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', async (req, res) => {
  try {
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

// ============================================
// TEST EMAIL
// ============================================
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

// ============================================
// CONFIG CHECK
// ============================================
app.get('/api/config', (req, res) => {
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

// ============================================
// GESTION DES ERREURS (doit être après toutes les routes)
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Erreur:', err.stack);

  if (err.name === 'ValidationError') {
    return res.status(422).json({
      success: false,
      message: 'Erreur de validation',
      errors: err.errors
    });
  }

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

// ============================================
// LANCEMENT DU SERVEUR
// ============================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🚀 SERVEUR FOOTSPACE DÉMARRÉ AVEC SUCCÈS 🚀             ║
╚═══════════════════════════════════════════════════════════

📡 PORT: ${PORT}
🌍 Environnement: ${process.env.NODE_ENV || 'development'}
📧 Resend: ${process.env.RESEND_API_KEY ? '✅ OUI' : '❌ NON'}
☁️  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅ OUI' : '❌ NON'}
🗄️  Base de données: ${process.env.DATABASE_URL ? '✅ CONNECTÉE' : '❌ NON CONNECTÉE'}

📋 ROUTES DISPONIBLES:

🏠 BASE:
   • GET  /                           - Accueil API
   • GET  /api/health                 - Santé du serveur
   • GET  /api/config                 - Configuration

📊 ANALYSES CRÉNEAUX (préfixe: /api/creneaux-analyses):
   • GET  /api/creneaux-analyses/test - Test routeur
   • GET  /api/creneaux-analyses/occupation-analyse?periode=30jours&typeTerrain=...
   • GET  /api/creneaux-analyses/performance-tarifaire?periode=30jours
   • GET  /api/creneaux-analyses/creneaux-strategiques?horizon=7%20days
   • GET  /api/creneaux-analyses/analyse-mensuelle?annee=2024&typeTerrain=...

🔐 AUTH:
   • /api/auth/*                      - PlayForest Auth

===============================================================
  `);

  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️  ATTENTION: RESEND_API_KEY manquante - Les emails ne fonctionneront pas');
  }
  if (!process.env.DATABASE_URL) {
    console.warn('⚠️  ATTENTION: DATABASE_URL manquante - La base de données ne fonctionnera pas');
  }
});

export default app;