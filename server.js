import express from "express";
import dotenv from "dotenv";
import pool from "./db.js";
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
    });
  } catch (err) {
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

// ✅ Routes
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

app.get("/", (req, res) => {
  res.send("✅ Backend Blackbook opérationnel (CORS activé)");
});

// Pour le développement local
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;