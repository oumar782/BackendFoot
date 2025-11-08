import express from "express";
import dotenv from "dotenv";
import pool from "./db.js";

// Importation CORRECTE des routes
import creneauxRoutes from './Gestion/creneaux.js';
import reservationRoutes from './Gestion/reservation.js';
import contactRoutes from './Gestion/contact.js';
import gestionCreneauxRoutes from './Gestion/gestionCreneaux.js';
import userRoutes from './Gestion/user.js';
import terrainRoutes from './Gestion/terrain.js';
import clientRoutes from './Gestion/clients.js';
import calendriersRoutes from './Gestion/calendrier.js';
import demonstrationRoutes from './Gestion/demonstration.js';
import previsionRoutes from './Gestion/prev.js';

dotenv.config();

const app = express();

// ✅ Configuration CORS corrigée
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://footspace-reserve.netlify.app",
  "https://frabjous-gaufre-31e862.netlify.app",
  "https://footspace-solutions.vercel.app"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// 🏥 Test route
app.get("/api/health", async (req, res) => {
  try {
    const dbCheck = await pool.query("SELECT NOW()");
    res.status(200).json({
      status: "healthy",
      dbTime: dbCheck.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: "unhealthy", 
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ Routes CORRIGÉES avec des noms cohérents
app.use('/api/creneaux', creneauxRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/users', userRoutes);
app.use('/api/terrains', terrainRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/gestion-creneaux', gestionCreneauxRoutes);
app.use('/api/demonstrations', demonstrationRoutes);
app.use('/api/previsions', previsionRoutes);
app.use('/api/calendriers', calendriersRoutes);

// Route racine
app.get("/", (req, res) => {
  res.send("✅ Backend FootSpace opérationnel (CORS activé)");
});

// Middleware de gestion d'erreurs
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  res.status(500).json({ 
    error: 'Erreur interne du serveur',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Route 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route non trouvée',
    path: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
});

export default app;