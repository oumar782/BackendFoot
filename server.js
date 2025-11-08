import express from "express";
import dotenv from "dotenv";
import pool from "./db.js";

// Importation CORRECTE des routes (vérifiez que ce sont des routes, pas des modèles)
import creneauxRoutes from './Gestion/creneaux.js';
import reservationRoutes from './Gestion/reservation.js'; // Changé de Reservation à reservationRoutes
import contactRoutes from './Gestion/contact.js'; // Changé de Contact à contactRoutes
import creneauxRoute from './Gestion/gestionCreneaux.js';
import userRoutes from './Gestion/user.js'; // Changé de User à userRoutes
import terrainRoutes from './Gestion/terrain.js'; // Changé de Terrain à terrainRoutes
import clientRoutes from './Gestion/clients.js'; // Changé de Client à clientRoutes
import calendriersRoutes from './Gestion/calendrier.js'; // Changé de CalendriersRouter à calendriersRoutes
import demoRoutes from './Gestion/demonstration.js'; // Changé de demo à demoRoutes
import prevRoutes from './Gestion/prev.js'; // Changé de prev à prevRoutes

dotenv.config();

const app = express();

// ✅ Configuration CORS
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
    });
  } catch (err) {
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

// ✅ Routes CORRIGÉES (utilisation de variables de routes, pas de modèles)
app.use('/api/creneaux', creneauxRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/user', userRoutes);
app.use('/api/terrain', terrainRoutes);
app.use('/api/reservation', reservationRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/gestioncreneaux', creneauxRoute);
app.use('/api/demonstration', demoRoutes);
app.use('/api/prevision', prevRoutes);
app.use('/api/calendriers', calendriersRoutes);

app.get("/", (req, res) => {
  res.send("✅ Backend FootSpace opérationnel (CORS activé)");
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  res.status(500).json({ 
    error: 'Erreur interne du serveur',
    message: err.message 
  });
});

// Route 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;