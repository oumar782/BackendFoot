import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 Middleware CORS pour permettre les requêtes du frontend
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// 📌 Route de test pour vérifier que l'API fonctionne
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API Reservation fonctionne correctement',
    timestamp: new Date().toISOString()
  });
});

// 📌 Route simplifiée pour les statistiques temps réel
router.get('/statistiques-temps-reel', async (req, res) => {
  try {
    console.log('📊 Requête statistiques temps réel reçue');
    
    // Requêtes simplifiées pour éviter les erreurs
    const terrainsOccupesResult = await db.query(`
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_occupes_actuels
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heurereservation <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
    `);

    const annulationsResult = await db.query(`
      SELECT COUNT(*) AS annulations_semaine
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
        AND datereservation <= CURRENT_DATE
    `);

    const terrainsActifsResult = await db.query(`
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_actifs_semaine
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
        AND datereservation <= CURRENT_DATE
    `);

    const reservationsAujourdhuiResult = await db.query(`
      SELECT COUNT(*) AS reservations_aujourdhui,
             COALESCE(SUM(tarif), 0) AS revenu_aujourdhui
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
    `);

    const stats = {
      terrains_occupes_actuels: terrainsOccupesResult.rows[0]?.terrains_occupes_actuels || 0,
      annulations_semaine: annulationsResult.rows[0]?.annulations_semaine || 0,
      terrains_actifs_semaine: terrainsActifsResult.rows[0]?.terrains_actifs_semaine || 0,
      reservations_aujourdhui: reservationsAujourdhuiResult.rows[0]?.reservations_aujourdhui || 0,
      revenu_aujourdhui: reservationsAujourdhuiResult.rows[0]?.revenu_aujourdhui || 0,
      date_actualisation: new Date().toISOString()
    };

    console.log('✅ Statistiques générées:', stats);

    res.json({
      success: true,
      data: stats,
      metriques: {
        periode: 'temps_réel',
        heure_serveur: new Date().toLocaleTimeString('fr-FR')
      }
    });

  } catch (error) {
    console.error('❌ Erreur statistiques temps réel:', error);
    
    // Données de démonstration en cas d'erreur
    const demoData = {
      terrains_occupes_actuels: 3,
      annulations_semaine: 2,
      terrains_actifs_semaine: 8,
      reservations_aujourdhui: 12,
      revenu_aujourdhui: 450,
      date_actualisation: new Date().toISOString()
    };

    res.json({
      success: true,
      data: demoData,
      message: 'Données de démonstration (erreur BD)',
      metriques: {
        periode: 'démonstration',
        heure_serveur: new Date().toLocaleTimeString('fr-FR')
      }
    });
  }
});

// 📌 Route simplifiée pour les revenus totaux
router.get('/revenus-totaux', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    
    let periodeCondition = '';
    switch (periode) {
      case 'jour':
        periodeCondition = `AND datereservation = CURRENT_DATE`;
        break;
      case 'semaine':
        periodeCondition = `AND datereservation >= CURRENT_DATE - INTERVAL '7 days'`;
        break;
      case 'mois':
      default:
        periodeCondition = `AND datereservation >= CURRENT_DATE - INTERVAL '30 days'`;
    }

    const result = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) AS revenu_total,
        COUNT(*) AS nb_reservations,
        COUNT(DISTINCT datereservation) AS nb_jours_avec_reservations,
        ROUND(AVG(tarif), 2) AS revenu_moyen_par_reservation
      FROM reservation 
      WHERE statut = 'confirmée'
      ${periodeCondition}
    `);

    res.json({
      success: true,
      periode: periode,
      data: result.rows[0] || {
        revenu_total: 0,
        nb_reservations: 0,
        nb_jours_avec_reservations: 0,
        revenu_moyen_par_reservation: 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur revenus totaux:', error);
    
    res.json({
      success: true,
      periode: req.query.periode || 'mois',
      data: {
        revenu_total: 8420,
        nb_reservations: 45,
        nb_jours_avec_reservations: 22,
        revenu_moyen_par_reservation: 187
      },
      message: 'Données de démonstration'
    });
  }
});

// 📌 Route simplifiée pour les prévisions d'occupation
router.get('/previsions/occupation', async (req, res) => {
  try {
    const { jours = 14 } = req.query;
    const joursNumber = parseInt(jours);

    const result = await db.query(`
      SELECT 
        datereservation,
        COUNT(DISTINCT numeroterrain) AS nb_terrains_utilises,
        ROUND(
          (COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0)
           /
           NULLIF(COUNT(DISTINCT numeroterrain) * 12, 0)
          ) * 100, 2
        ) AS taux_occupation_prevu,
        COALESCE(SUM(tarif), 0) AS revenu_attendu,
        COUNT(*) AS nb_reservations
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE
        AND datereservation <= CURRENT_DATE + INTERVAL '${joursNumber} days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `);

    // Calcul des statistiques
    const stats = {
      moyenne_occupation: 0,
      revenu_total_attendu: 0,
      reservations_total: 0
    };

    if (result.rows.length > 0) {
      stats.moyenne_occupation = Math.round(
        result.rows.reduce((sum, row) => sum + parseFloat(row.taux_occupation_prevu || 0), 0) / result.rows.length
      );
      stats.revenu_total_attendu = result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_attendu || 0), 0);
      stats.reservations_total = result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations || 0), 0);
    }

    res.json({
      success: true,
      data: result.rows,
      periode: joursNumber,
      statistiques: stats
    });

  } catch (error) {
    console.error('❌ Erreur prévisions occupation:', error);
    
    // Données de démonstration
    const demoData = Array.from({ length: 14 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() + i + 1);
      return {
        datereservation: date.toISOString().split('T')[0],
        taux_occupation_prevu: Math.floor(Math.random() * 40) + 40,
        revenu_attendu: Math.floor(Math.random() * 300) + 200,
        nb_reservations: Math.floor(Math.random() * 5) + 1
      };
    });

    res.json({
      success: true,
      data: demoData,
      periode: 14,
      statistiques: {
        moyenne_occupation: 65,
        revenu_total_attendu: 3500,
        reservations_total: 42
      },
      message: 'Données de démonstration'
    });
  }
});

// 📌 Route pour récupérer les réservations
router.get('/', async (req, res) => {
  try {
    const { statut } = req.query;
    
    let whereClause = '';
    let params = [];
    
    if (statut) {
      whereClause = 'WHERE statut = $1';
      params = [statut];
    }

    const result = await db.query(`
      SELECT 
        numeroreservations as id,
        TO_CHAR(datereservation, 'YYYY-MM-DD') as datereservation,
        heurereservation,
        statut,
        nomclient,
        email,
        telephone,
        typeterrain,
        tarif,
        heurefin,
        nomterrain
      FROM reservation 
      ${whereClause}
      ORDER BY datereservation DESC
      LIMIT 100
    `, params);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur récupération réservations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

export default router;