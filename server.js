import express from "express";
import db from "./db.js";
import cors from 'cors';
import dotenv from 'dotenv';

// Importation corrigée du routeur des créneaux
import creneauxRoutes from './Gestion/creneaux.js'; // Correction du nom de fichier

dotenv.config();
const app = express();

// ✅ CORS bien configuré (corrigé)
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://g-traf.vercel.app",
      "https://admingtraf.vercel.app"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// 📄 Route racine simplifiée
app.get('/', (req, res) => {
  res.send('✅ Serveur backend en marche');
});

// Utilisation du routeur des créneaux
app.use('/api/creneaux', creneauxRoutes);

// 🏥 Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    database: 'connected'
  });
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

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 🚀 Lancement serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});