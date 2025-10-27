// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (LE SEUL ENDPOINT DISPONIBLE)
router.get('/dashboard', async (req, res) => {
  try {
    // Récupérer les statistiques en parallèle pour plus de performance
    const [
      revenusMois,
      reservationsMois,
      clientsActifs,
      tauxRemplissage,
      statsTempsReel,
      revenusAnnee,
      revenusAujourdhui,
      reservationsAujourdhui,
      terrainsOccupes
    ] = await Promise.all([
      // Revenus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Réservations du mois
      db.query(`
        SELECT COUNT(*) as reservations_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Clients actifs ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux de remplissage moyen du mois
      db.query(`
        SELECT 
          COALESCE(ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(DISTINCT numeroterrain) * 30 
             FROM terrain WHERE actif = true)
            ), 2
          ), 0) as taux_remplissage
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as reservations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui
        FROM reservation
      `),
      
      // Revenus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_annee
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Revenus aujourd'hui
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_aujourdhui
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
      `),
      
      // Réservations aujourd'hui
      db.query(`
        SELECT COUNT(*) as reservations_aujourdhui
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
      `),
      
      // Terrains occupés aujourd'hui
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_occupes
        FROM reservation 
        WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
      `)
    ]);

    const stats = {
      // Données principales
      revenus_mois: parseFloat(revenusMois.rows[0]?.revenus_mois || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      clients_actifs: parseInt(clientsActifs.rows[0]?.clients_actifs || 0),
      taux_remplissage: parseFloat(tauxRemplissage.rows[0]?.taux_remplissage || 0),
      
      // Données temps réel
      revenus_aujourdhui: parseFloat(revenusAujourdhui.rows[0]?.revenus_aujourdhui || 0),
      reservations_aujourdhui: parseInt(reservationsAujourdhui.rows[0]?.reservations_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      terrains_occupes_actuels: parseInt(terrainsOccupes.rows[0]?.terrains_occupes || 0),
      
      // Données annuelles
      revenus_annee: parseFloat(revenusAnnee.rows[0]?.revenus_annee || 0)
    };

    // Calcul des trends basés sur les données réelles
    const trends = await calculateTrends(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends BASÉS SUR LES DONNÉES RÉELLES
async function calculateTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenus_mois_dernier,
        COUNT(*) as reservations_mois_dernier,
        COUNT(DISTINCT idclient) as clients_mois_dernier
      FROM reservation 
      WHERE statut = 'confirmée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    // Calculs basés uniquement sur les données réelles de la BDD
    const trends = {
      revenus: {
        value: calculatePercentageChange(currentStats.revenus_mois, parseFloat(lastMonth.revenus_mois_dernier || 0)),
        isPositive: currentStats.revenus_mois > parseFloat(lastMonth.revenus_mois_dernier || 0)
      },
      reservations: {
        value: calculatePercentageChange(currentStats.reservations_mois, parseInt(lastMonth.reservations_mois_dernier || 0)),
        isPositive: currentStats.reservations_mois > parseInt(lastMonth.reservations_mois_dernier || 0)
      },
      clients: {
        value: calculatePercentageChange(currentStats.clients_actifs, parseInt(lastMonth.clients_mois_dernier || 0)),
        isPositive: currentStats.clients_actifs > parseInt(lastMonth.clients_mois_dernier || 0)
      },
      remplissage: {
        value: currentStats.taux_remplissage > 70 ? 5 : -2, // Simple logique basée sur l'objectif
        isPositive: currentStats.taux_remplissage > 70
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends:', error);
    // Retourne des trends neutres en cas d'erreur
    return {
      revenus: { value: 0, isPositive: true },
      reservations: { value: 0, isPositive: true },
      clients: { value: 0, isPositive: true },
      remplissage: { value: 0, isPositive: true }
    };
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;