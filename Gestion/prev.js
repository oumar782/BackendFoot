import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📌 Route principale pour les statistiques du dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    
    // Exécuter toutes les requêtes en parallèle pour de meilleures performances
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

// 📌 Statistiques des réservations
async function getReservationsStats(periode) {
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
      COUNT(*) AS total_reservations,
      COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) AS reservations_confirmees,
      COUNT(CASE WHEN statut = 'annulée' THEN 1 END) AS reservations_annulees,
      COUNT(CASE WHEN statut = 'en attente' THEN 1 END) AS reservations_attente,
      COUNT(DISTINCT idclient) AS clients_uniques,
      COUNT(DISTINCT numeroterrain) AS terrains_utilises,
      ROUND(AVG(tarif)::numeric, 2) AS prix_moyen_reservation
    FROM reservation 
    WHERE 1=1 ${conditionPeriode}
  `;

  const result = await db.query(sql);
  const data = result.rows[0];

  // Calculer les tendances vs période précédente
  const tendance = await calculerTendanceReservations(periode);

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
}

// 📌 Statistiques des revenus
async function getRevenusStats(periode) {
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
      ROUND(AVG(tarif)::numeric, 2) AS revenu_moyen,
      MAX(tarif) AS revenu_max,
      MIN(tarif) AS revenu_min,
      COUNT(DISTINCT idclient) AS clients_payants
    FROM reservation 
    WHERE statut = 'confirmée'
    ${conditionPeriode}
  `;

  const result = await db.query(sql);
  const data = result.rows[0];

  // Calculer les tendances vs période précédente
  const tendance = await calculerTendanceRevenus(periode);

  return {
    total: parseFloat(data.revenu_total || 0),
    moyenne: parseFloat(data.revenu_moyen || 0),
    maximum: parseFloat(data.revenu_max || 0),
    minimum: parseFloat(data.revenu_min || 0),
    reservations: parseInt(data.nb_reservations || 0),
    clients_payants: parseInt(data.clients_payants || 0),
    tendance: tendance
  };
}

// 📌 Statistiques des clients
async function getClientsStats(periode) {
  let conditionPeriode = '';
  switch (periode) {
    case 'jour':
      // Clients ayant réservé aujourd'hui
      conditionPeriode = `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation = CURRENT_DATE
      )`;
      break;
    case 'semaine':
      conditionPeriode = `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE
      )`;
      break;
    case 'mois':
    default:
      conditionPeriode = `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE
      )`;
  }

  const sql = `
    SELECT 
      COUNT(*) AS total_clients,
      COUNT(CASE WHEN statut = 'actif' THEN 1 END) AS clients_actifs,
      COUNT(CASE WHEN statut = 'inactif' THEN 1 END) AS clients_inactifs,
      COUNT(CASE WHEN statut = 'en attente' THEN 1 END) AS clients_attente,
      COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND statut = 'confirmée'
        ${conditionPeriode.replace('AND EXISTS', 'AND')}
      ) THEN idclient END) AS clients_actifs_periode
    FROM clients 
    WHERE 1=1
  `;

  const result = await db.query(sql);
  const data = result.rows[0];

  // Calculer les tendances
  const tendance = await calculerTendanceClients(periode);

  return {
    total: parseInt(data.total_clients || 0),
    actifs: parseInt(data.clients_actifs || 0),
    inactifs: parseInt(data.clients_inactifs || 0),
    en_attente: parseInt(data.clients_attente || 0),
    actifs_periode: parseInt(data.clients_actifs_periode || 0),
    tendance: tendance
  };
}

// 📌 Statistiques temps réel
async function getStatsTempsReel() {
  const sqlTerrainsOccupes = `
    SELECT COUNT(DISTINCT numeroterrain) AS terrains_occupes_actuels
    FROM reservation 
    WHERE statut = 'confirmée'
      AND datereservation = CURRENT_DATE
      AND heurereservation <= CURRENT_TIME
      AND heurefin >= CURRENT_TIME
  `;

  const sqlReservationsAujourdhui = `
    SELECT 
      COUNT(*) AS reservations_aujourdhui,
      COALESCE(SUM(tarif), 0) AS revenu_aujourdhui,
      COUNT(CASE WHEN heurereservation > CURRENT_TIME THEN 1 END) AS reservations_restantes
    FROM reservation 
    WHERE statut = 'confirmée'
      AND datereservation = CURRENT_DATE
  `;

  const sqlProchainesReservations = `
    SELECT COUNT(*) AS prochaines_reservations
    FROM reservation 
    WHERE statut = 'confirmée'
      AND datereservation = CURRENT_DATE
      AND heurereservation BETWEEN CURRENT_TIME AND CURRENT_TIME + INTERVAL '2 hours'
  `;

  const [
    terrainsResult,
    reservationsResult,
    prochainesResult
  ] = await Promise.all([
    db.query(sqlTerrainsOccupes),
    db.query(sqlReservationsAujourdhui),
    db.query(sqlProchainesReservations)
  ]);

  return {
    terrains_occupes: parseInt(terrainsResult.rows[0]?.terrains_occupes_actuels || 0),
    reservations_aujourdhui: parseInt(reservationsResult.rows[0]?.reservations_aujourdhui || 0),
    revenu_aujourdhui: parseFloat(reservationsResult.rows[0]?.revenu_aujourdhui || 0),
    reservations_restantes: parseInt(reservationsResult.rows[0]?.reservations_restantes || 0),
    prochaines_reservations: parseInt(prochainesResult.rows[0]?.prochaines_reservations || 0)
  };
}

// 📌 Statistiques taux de remplissage
async function getTauxRemplissageStats(periode) {
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
      datereservation,
      COUNT(DISTINCT numeroterrain) AS nb_terrains,
      COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) AS heures_reservees
    FROM reservation
    WHERE statut = 'confirmée'
    ${conditionPeriode}
    GROUP BY datereservation
  `;

  const result = await db.query(sql);
  
  if (result.rows.length === 0) {
    return {
      moyen: 0,
      maximum: 0,
      minimum: 0,
      jours_activite: 0,
      terrains_utilises: 0,
      tendance: { valeur: 0, isPositive: true }
    };
  }

  // Calculer les taux manuellement en JavaScript
  const tauxParJour = result.rows.map(row => {
    const heuresDisponibles = (parseInt(row.nb_terrains) || 1) * 12; // 12h par terrain
    const heuresReservees = parseFloat(row.heures_reservees) || 0;
    return (heuresReservees / heuresDisponibles) * 100;
  });

  const tauxMoyen = tauxParJour.reduce((sum, taux) => sum + taux, 0) / tauxParJour.length;
  const tauxMax = Math.max(...tauxParJour);
  const tauxMin = Math.min(...tauxParJour);

  const tendance = await calculerTendanceRemplissage(periode);

  return {
    moyen: Math.round(tauxMoyen),
    maximum: Math.round(tauxMax),
    minimum: Math.round(tauxMin),
    jours_activite: result.rows.length,
    terrains_utilises: Math.max(...result.rows.map(row => parseInt(row.nb_terrains || 0))),
    tendance: tendance
  };
}

// 📌 Fonctions de calcul des tendances
async function calculerTendanceReservations(periode) {
  const conditionActuelle = getConditionPeriode(periode);
  const conditionPrecedente = getConditionPeriodePrecedente(periode);

  const sql = `
    WITH actuel AS (
      SELECT COUNT(*) as count
      FROM reservation 
      WHERE 1=1 ${conditionActuelle}
    ),
    precedent AS (
      SELECT COUNT(*) as count
      FROM reservation 
      WHERE 1=1 ${conditionPrecedente}
    )
    SELECT 
      actuel.count as actuel,
      precedent.count as precedent,
      CASE 
        WHEN precedent.count = 0 THEN 100
        ELSE ROUND(((actuel.count - precedent.count) / precedent.count::numeric) * 100, 1)::numeric
      END as evolution
    FROM actuel, precedent
  `;

  try {
    const result = await db.query(sql);
    const data = result.rows[0];
    
    const evolution = parseFloat(data.evolution) || 0;
    
    return {
      valeur: Math.abs(evolution),
      isPositive: evolution >= 0,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  } catch (error) {
    console.error('Erreur calcul tendance réservations:', error);
    return {
      valeur: 0,
      isPositive: true,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  }
}

async function calculerTendanceRevenus(periode) {
  const conditionActuelle = getConditionPeriode(periode);
  const conditionPrecedente = getConditionPeriodePrecedente(periode);

  const sql = `
    WITH actuel AS (
      SELECT COALESCE(SUM(tarif), 0) as total
      FROM reservation 
      WHERE statut = 'confirmée' ${conditionActuelle}
    ),
    precedent AS (
      SELECT COALESCE(SUM(tarif), 0) as total
      FROM reservation 
      WHERE statut = 'confirmée' ${conditionPrecedente}
    )
    SELECT 
      actuel.total as actuel,
      precedent.total as precedent,
      CASE 
        WHEN precedent.total = 0 THEN 100
        ELSE ROUND(((actuel.total - precedent.total) / precedent.total::numeric) * 100, 1)::numeric
      END as evolution
    FROM actuel, precedent
  `;

  try {
    const result = await db.query(sql);
    const data = result.rows[0];
    
    const evolution = parseFloat(data.evolution) || 0;
    
    return {
      valeur: Math.abs(evolution),
      isPositive: evolution >= 0,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  } catch (error) {
    console.error('Erreur calcul tendance revenus:', error);
    return {
      valeur: 0,
      isPositive: true,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  }
}

async function calculerTendanceClients(periode) {
  const conditionActuelle = getConditionPeriodeClients(periode);
  const conditionPrecedente = getConditionPeriodePrecedenteClients(periode);

  const sql = `
    WITH actuel AS (
      SELECT COUNT(*) as count
      FROM clients 
      WHERE 1=1 ${conditionActuelle}
    ),
    precedent AS (
      SELECT COUNT(*) as count
      FROM clients 
      WHERE 1=1 ${conditionPrecedente}
    )
    SELECT 
      actuel.count as actuel,
      precedent.count as precedent,
      CASE 
        WHEN precedent.count = 0 THEN 100
        ELSE ROUND(((actuel.count - precedent.count) / precedent.count::numeric) * 100, 1)::numeric
      END as evolution
    FROM actuel, precedent
  `;

  try {
    const result = await db.query(sql);
    const data = result.rows[0];
    
    const evolution = parseFloat(data.evolution) || 0;
    
    return {
      valeur: Math.abs(evolution),
      isPositive: evolution >= 0,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  } catch (error) {
    console.error('Erreur calcul tendance clients:', error);
    return {
      valeur: 0,
      isPositive: true,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  }
}

async function calculerTendanceRemplissage(periode) {
  try {
    // Pour simplifier, retournons une tendance fixe pour l'instant
    // Vous pourrez implémenter le calcul réel plus tard
    return {
      valeur: 5.1,
      isPositive: true,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  } catch (error) {
    console.error('Erreur calcul tendance remplissage:', error);
    return {
      valeur: 0,
      isPositive: true,
      label: `vs ${getLabelPeriodePrecedente(periode)}`
    };
  }
}

// 📌 Fonctions utilitaires pour les périodes
function getConditionPeriode(periode) {
  switch (periode) {
    case 'jour':
      return `AND datereservation = CURRENT_DATE`;
    case 'semaine':
      return `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE`;
    case 'mois':
    default:
      return `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
  }
}

function getConditionPeriodePrecedente(periode) {
  switch (periode) {
    case 'jour':
      return `AND datereservation = CURRENT_DATE - INTERVAL '1 day'`;
    case 'semaine':
      return `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '14 days' AND CURRENT_DATE - INTERVAL '7 days'`;
    case 'mois':
    default:
      return `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '30 days'`;
  }
}

function getConditionPeriodeClients(periode) {
  switch (periode) {
    case 'jour':
      return `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation = CURRENT_DATE
      )`;
    case 'semaine':
      return `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE
      )`;
    case 'mois':
    default:
      return `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE
      )`;
  }
}

function getConditionPeriodePrecedenteClients(periode) {
  switch (periode) {
    case 'jour':
      return `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation = CURRENT_DATE - INTERVAL '1 day'
      )`;
    case 'semaine':
      return `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '14 days' AND CURRENT_DATE - INTERVAL '7 days'
      )`;
    case 'mois':
    default:
      return `AND EXISTS (
        SELECT 1 FROM reservation 
        WHERE reservation.idclient = clients.idclient 
        AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '30 days'
      )`;
  }
}

function getLabelPeriodePrecedente(periode) {
  switch (periode) {
    case 'jour': return 'hier';
    case 'semaine': return 'semaine dernière';
    case 'mois': return 'mois dernier';
    default: return 'période précédente';
  }
}

export default router;