import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 Route principale pour les statistiques du dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    
    console.log(`📊 Génération des statistiques pour la période: ${periode}`);
    
    // Exécuter toutes les requêtes en parallèle
    const [
      reservationsResult,
      revenusResult,
      clientsResult,
      tempsReelResult,
      tauxRemplissageResult
    ] = await Promise.all([
      getReservationsStats(periode),
      getRevenusStats(periode),
      getClientsStats(periode),
      getStatsTempsReel(),
      getTauxRemplissageStats(periode)
    ]);

    const stats = {
      reservations: reservationsResult,
      revenus: revenusResult,
      clients: clientsResult,
      temps_reel: tempsReelResult,
      taux_remplissage: tauxRemplissageResult,
      metriques: {
        periode: periode,
        date_actualisation: new Date().toISOString(),
        generation: 'dashboard_complet'
      }
    };

    console.log('✅ Statistiques générées avec succès');
    res.json({
      success: true,
      data: stats
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

// 📌 Statistiques des réservations - SIMPLIFIÉE
async function getReservationsStats(periode) {
  try {
    let conditionPeriode = '';
    let params = [];
    
    switch (periode) {
      case 'jour':
        conditionPeriode = `AND datereservation = CURRENT_DATE`;
        break;
      case 'semaine':
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE`;
        break;
      case 'mois':
      default:
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
    }

    const sql = `
      SELECT 
        COUNT(*) AS total_reservations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) AS reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) AS reservations_annulees,
        COUNT(CASE WHEN statut = 'en attente' THEN 1 END) AS reservations_attente,
        COUNT(DISTINCT idclient) AS clients_uniques,
        COUNT(DISTINCT numeroterrain) AS terrains_utilises,
        COALESCE(ROUND(AVG(tarif)::numeric, 2), 0) AS prix_moyen_reservation
      FROM reservation 
      WHERE 1=1 ${conditionPeriode}
    `;

    console.log('📋 SQL Réservations:', sql);
    const result = await db.query(sql, params);
    const data = result.rows[0] || {};

    // Tendance simplifiée
    const tendance = await calculerTendanceReservationsSimple(periode);

    return {
      total: parseInt(data.total_reservations || 0),
      confirmees: parseInt(data.reservations_confirmees || 0),
      annulees: parseInt(data.reservations_annulees || 0),
      en_attente: parseInt(data.reservations_attente || 0),
      clients_uniques: parseInt(data.clients_uniques || 0),
      terrains_utilises: parseInt(data.terrains_utilises || 0),
      prix_moyen: parseFloat(data.prix_moyen_reservation || 0),
      tendance: tendance
    };
  } catch (error) {
    console.error('❌ Erreur getReservationsStats:', error);
    return getDefaultReservationsStats();
  }
}

// 📌 Statistiques des revenus - SIMPLIFIÉE
async function getRevenusStats(periode) {
  try {
    let conditionPeriode = '';
    
    switch (periode) {
      case 'jour':
        conditionPeriode = `AND datereservation = CURRENT_DATE`;
        break;
      case 'semaine':
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE`;
        break;
      case 'mois':
      default:
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
    }

    const sql = `
      SELECT 
        COALESCE(SUM(tarif), 0) AS revenu_total,
        COUNT(*) AS nb_reservations,
        COALESCE(ROUND(AVG(tarif)::numeric, 2), 0) AS revenu_moyen,
        COALESCE(MAX(tarif), 0) AS revenu_max,
        COALESCE(MIN(tarif), 0) AS revenu_min,
        COUNT(DISTINCT idclient) AS clients_payants
      FROM reservation 
      WHERE statut = 'confirmée'
      ${conditionPeriode}
    `;

    console.log('💰 SQL Revenus:', sql);
    const result = await db.query(sql);
    const data = result.rows[0] || {};

    // Tendance simplifiée
    const tendance = await calculerTendanceRevenusSimple(periode);

    return {
      total: parseFloat(data.revenu_total || 0),
      moyenne: parseFloat(data.revenu_moyen || 0),
      maximum: parseFloat(data.revenu_max || 0),
      minimum: parseFloat(data.revenu_min || 0),
      reservations: parseInt(data.nb_reservations || 0),
      clients_payants: parseInt(data.clients_payants || 0),
      tendance: tendance
    };
  } catch (error) {
    console.error('❌ Erreur getRevenusStats:', error);
    return getDefaultRevenusStats();
  }
}

// 📌 Statistiques des clients - SIMPLIFIÉE
async function getClientsStats(periode) {
  try {
    // Requête simple pour tous les clients
    const sql = `
      SELECT 
        COUNT(*) AS total_clients,
        COUNT(CASE WHEN statut = 'actif' THEN 1 END) AS clients_actifs,
        COUNT(CASE WHEN statut = 'inactif' THEN 1 END) AS clients_inactifs,
        COUNT(CASE WHEN statut = 'en attente' THEN 1 END) AS clients_attente
      FROM clients 
    `;

    console.log('👥 SQL Clients:', sql);
    const result = await db.query(sql);
    const data = result.rows[0] || {};

    // Clients actifs cette période (requête séparée)
    const clientsActifsPeriode = await getClientsActifsPeriode(periode);

    // Tendance simplifiée
    const tendance = await calculerTendanceClientsSimple(periode);

    return {
      total: parseInt(data.total_clients || 0),
      actifs: parseInt(data.clients_actifs || 0),
      inactifs: parseInt(data.clients_inactifs || 0),
      en_attente: parseInt(data.clients_attente || 0),
      actifs_periode: clientsActifsPeriode,
      tendance: tendance
    };
  } catch (error) {
    console.error('❌ Erreur getClientsStats:', error);
    return getDefaultClientsStats();
  }
}

// 📌 Clients actifs par période
async function getClientsActifsPeriode(periode) {
  try {
    let conditionPeriode = '';
    
    switch (periode) {
      case 'jour':
        conditionPeriode = `AND datereservation = CURRENT_DATE`;
        break;
      case 'semaine':
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE`;
        break;
      case 'mois':
      default:
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
    }

    const sql = `
      SELECT COUNT(DISTINCT idclient) AS count
      FROM reservation 
      WHERE statut = 'confirmée'
      ${conditionPeriode}
    `;

    const result = await db.query(sql);
    return parseInt(result.rows[0]?.count || 0);
  } catch (error) {
    console.error('❌ Erreur getClientsActifsPeriode:', error);
    return 0;
  }
}

// 📌 Statistiques temps réel - SIMPLIFIÉE
async function getStatsTempsReel() {
  try {
    // Terrains occupés actuellement
    const sqlTerrainsOccupes = `
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_occupes_actuels
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heurereservation <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
    `;

    // Réservations aujourd'hui
    const sqlReservationsAujourdhui = `
      SELECT 
        COUNT(*) AS reservations_aujourdhui,
        COALESCE(SUM(tarif), 0) AS revenu_aujourdhui
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
    `;

    const [terrainsResult, reservationsResult] = await Promise.all([
      db.query(sqlTerrainsOccupes),
      db.query(sqlReservationsAujourdhui)
    ]);

    return {
      terrains_occupes: parseInt(terrainsResult.rows[0]?.terrains_occupes_actuels || 0),
      reservations_aujourdhui: parseInt(reservationsResult.rows[0]?.reservations_aujourdhui || 0),
      revenu_aujourdhui: parseFloat(reservationsResult.rows[0]?.revenu_aujourdhui || 0),
      reservations_restantes: 0, // Simplifié
      prochaines_reservations: 0  // Simplifié
    };
  } catch (error) {
    console.error('❌ Erreur getStatsTempsReel:', error);
    return getDefaultTempsReelStats();
  }
}

// 📌 Statistiques taux de remplissage - SIMPLIFIÉE
async function getTauxRemplissageStats(periode) {
  try {
    let conditionPeriode = '';
    
    switch (periode) {
      case 'jour':
        conditionPeriode = `AND datereservation = CURRENT_DATE`;
        break;
      case 'semaine':
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE`;
        break;
      case 'mois':
      default:
        conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
    }

    // Calcul simplifié du taux de remplissage
    const sql = `
      SELECT 
        COUNT(DISTINCT datereservation) AS jours_activite,
        COUNT(DISTINCT numeroterrain) AS terrains_utilises,
        COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_reservees_total
      FROM reservation
      WHERE statut = 'confirmée'
      ${conditionPeriode}
    `;

    console.log('📈 SQL Remplissage:', sql);
    const result = await db.query(sql);
    const data = result.rows[0] || {};

    const joursActivite = parseInt(data.jours_activite || 0);
    const terrainsUtilises = parseInt(data.terrains_utilises || 1);
    const heuresReserveesTotal = parseFloat(data.heures_reservees_total || 0);
    
    // Calcul du taux moyen (simplifié)
    const heuresDisponiblesTotal = joursActivite * terrainsUtilises * 12; // 12h par jour par terrain
    const tauxMoyen = heuresDisponiblesTotal > 0 ? (heuresReserveesTotal / heuresDisponiblesTotal) * 100 : 0;

    const tendance = await calculerTendanceRemplissageSimple(periode);

    return {
      moyen: Math.round(tauxMoyen),
      maximum: Math.round(tauxMoyen * 1.2), // Estimation
      minimum: Math.round(tauxMoyen * 0.8), // Estimation
      jours_activite: joursActivite,
      terrains_utilises: terrainsUtilises,
      tendance: tendance
    };
  } catch (error) {
    console.error('❌ Erreur getTauxRemplissageStats:', error);
    return getDefaultRemplissageStats();
  }
}

// 📌 Tendances SIMPLIFIÉES (valeurs fixes pour l'instant)
async function calculerTendanceReservationsSimple(periode) {
  return {
    valeur: 12.5,
    isPositive: true,
    label: `vs ${getLabelPeriodePrecedente(periode)}`
  };
}

async function calculerTendanceRevenusSimple(periode) {
  return {
    valeur: 8.2,
    isPositive: true,
    label: `vs ${getLabelPeriodePrecedente(periode)}`
  };
}

async function calculerTendanceClientsSimple(periode) {
  return {
    valeur: 3.1,
    isPositive: true,
    label: `vs ${getLabelPeriodePrecedente(periode)}`
  };
}

async function calculerTendanceRemplissageSimple(periode) {
  return {
    valeur: 5.5,
    isPositive: true,
    label: `vs ${getLabelPeriodePrecedente(periode)}`
  };
}

// 📌 Données par défaut en cas d'erreur
function getDefaultReservationsStats() {
  return {
    total: 0,
    confirmees: 0,
    annulees: 0,
    en_attente: 0,
    clients_uniques: 0,
    terrains_utilises: 0,
    prix_moyen: 0,
    tendance: { valeur: 0, isPositive: true, label: 'vs période précédente' }
  };
}

function getDefaultRevenusStats() {
  return {
    total: 0,
    moyenne: 0,
    maximum: 0,
    minimum: 0,
    reservations: 0,
    clients_payants: 0,
    tendance: { valeur: 0, isPositive: true, label: 'vs période précédente' }
  };
}

function getDefaultClientsStats() {
  return {
    total: 0,
    actifs: 0,
    inactifs: 0,
    en_attente: 0,
    actifs_periode: 0,
    tendance: { valeur: 0, isPositive: true, label: 'vs période précédente' }
  };
}

function getDefaultTempsReelStats() {
  return {
    terrains_occupes: 0,
    reservations_aujourdhui: 0,
    revenu_aujourdhui: 0,
    reservations_restantes: 0,
    prochaines_reservations: 0
  };
}

function getDefaultRemplissageStats() {
  return {
    moyen: 0,
    maximum: 0,
    minimum: 0,
    jours_activite: 0,
    terrains_utilises: 0,
    tendance: { valeur: 0, isPositive: true, label: 'vs période précédente' }
  };
}

// 📌 Fonction utilitaire pour les labels de période
function getLabelPeriodePrecedente(periode) {
  switch (periode) {
    case 'jour': return 'hier';
    case 'semaine': return 'semaine dernière';
    case 'mois': return 'mois dernier';
    default: return 'période précédente';
  }
}

export default router;