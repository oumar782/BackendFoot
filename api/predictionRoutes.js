// ==========================================
// API EXPRESS - ROUTES DE PREDICTION
// ==========================================

import express from 'express';
import PredictionService from '../Machine-learning/PredictionService.js';

const router = express.Router();

// Instance unique du service (singleton)
let predictionService = null;

// Middleware pour initialiser le service
router.use(async (req, res, next) => {
  if (!predictionService) {
    try {
      predictionService = new PredictionService();
      const initialized = await predictionService.initialize();
      
      if (!initialized) {
        return res.status(500).json({
          success: false,
          error: 'Erreur lors de l\'initialisation du service de prédiction'
        });
      }
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `Erreur création service: ${error.message}`
      });
    }
  }
  next();
});

/**
 * GET /api/prediction/stats
 * Récupère les statistiques et patterns du modèle
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await predictionService.getStats();
    res.json({
      success: true,
      data: {
        score: `${(stats.score * 100).toFixed(1)}%`,
        patterns: {
          jourMostLoaded: stats.patterns.jourTop !== null ? '📅 Jour le plus chargé' : 'N/A',
          peakHour: stats.patterns.heureTop !== null ? `${stats.patterns.heureTop}h` : 'N/A',
          mostPopularField: stats.patterns.terrainTop || 'N/A',
          criticalSlot: `${stats.patterns.heureDebut}h - ${stats.patterns.heureFin}h`
        },
        dataSize: `${stats.nbDonnees} données d'entraînement`,
        fieldsCount: `${stats.nbTerrains} terrains`
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/prediction/terrains
 * Récupère la liste des terrains disponibles
 */
router.get('/terrains', async (req, res) => {
  try {
    const terrains = await predictionService.getTerrainsList();
    res.json({
      success: true,
      count: terrains.length,
      data: terrains
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/prediction/affluence
 * Prédit l'affluence pour une date donnée
 * 
 * Body:
 * {
 *   "date": "2026-05-20",           // Requis - Format YYYY-MM-DD
 *   "terrain": "Terrain A"          // Optionnel - Nom du terrain (ou "tous")
 * }
 */
router.post('/affluence', async (req, res) => {
  try {
    const { date, terrain } = req.body;

    if (!date) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre "date" requis (format: YYYY-MM-DD)'
      });
    }

    const result = await predictionService.predictAffluence(date, terrain);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/prediction/affluence/:date
 * Prédit l'affluence pour une date donnée (GET)
 * 
 * Query params:
 * - terrain (optionnel) : nom du terrain
 */
router.get('/affluence/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const { terrain } = req.query;

    const result = await predictionService.predictAffluence(date, terrain);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/prediction/affluence/:date/top
 * Récupère les informations du top 5 des terrains
 */
router.get('/affluence/:date/top', async (req, res) => {
  try {
    const { date } = req.params;

    const result = await predictionService.predictAffluence(date);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    res.json({
      success: true,
      date: result.date,
      dayName: result.jourNom,
      totalReservations: result.totalReservations,
      modelScore: `${(result.score * 100).toFixed(1)}%`,
      topTerrains: result.topTerrains.map(t => ({
        terrain: t.terrain,
        maxReservations: t.maxPrediction,
        peakHour: t.heurePointe,
        hoursBooked: t.nbHeuresReservees,
        occupancyRate: `${((t.nbHeuresReservees / 24) * 100).toFixed(0)}%`
      })),
      criticalAlert: result.alerteCritique
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/prediction/field/:date/:fieldName
 * Prédit l'affluence pour un terrain spécifique
 */
router.get('/field/:date/:fieldName', async (req, res) => {
  try {
    const { date, fieldName } = req.params;

    const result = await predictionService.predictAffluence(date, fieldName);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    if (!result.terrainSpecifique) {
      return res.status(400).json({
        success: false,
        error: `Terrain '${fieldName}' non trouvé`,
        availableFields: result.terrainsDisponibles
      });
    }

    const t = result.terrainSpecifique;
    res.json({
      success: true,
      field: {
        name: t.terrain,
        date: result.date,
        dayName: result.jourNom,
        peakHour: t.heurePointe,
        maxReservations: t.maxPrediction,
        hoursBooked: t.nbHeuresReservees,
        occupancyRate: `${t.tauxOccupation.toFixed(0)}%`,
        alertLevel: t.alerte,
        predictions: {
          byHour: t.predictions,
          description: 'Nombre de réservations prédites pour chaque heure (0-23)'
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;

/**
 * ==========================================
 * EXEMPLES D'UTILISATION
 * ==========================================
 * 
 * 1. Initialiser le service
 * --------------------------
 * import predictionRoutes from './api/predictionRoutes.js';
 * 
 * const app = express();
 * app.use(express.json());
 * app.use('/api/prediction', predictionRoutes);
 * 
 * 2. GET - Statistiques du modèle
 * ---------------------------------
 * curl http://localhost:3000/api/prediction/stats
 * 
 * 3. GET - Liste des terrains
 * ----------------------------
 * curl http://localhost:3000/api/prediction/terrains
 * 
 * 4. POST - Prédiction avec paramètres
 * -----------------------------------
 * curl -X POST http://localhost:3000/api/prediction/affluence \
 *   -H "Content-Type: application/json" \
 *   -d '{"date": "2026-05-20", "terrain": "Terrain A"}'
 * 
 * 5. GET - Prédiction pour une date
 * ---------------------------------
 * curl http://localhost:3000/api/prediction/affluence/2026-05-20
 * 
 * 6. GET - Top 5 terrains pour une date
 * -------------------------------------
 * curl http://localhost:3000/api/prediction/affluence/2026-05-20/top
 * 
 * 7. GET - Prédiction pour un terrain spécifique
 * -----------------------------------------------
 * curl http://localhost:3000/api/prediction/field/2026-05-20/Terrain%20A
 */
