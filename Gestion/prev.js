// routes/statistiques.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Route principale pour les statistiques du dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;

    // Exécuter toutes les requêtes en parallèle pour de meilleures performances
    const [
      revenusResult,
      reservationsResult,
      clientsResult,
      tempsReelResult,
      previsionsResult
    ] = await Promise.all([
      getRevenusStats(periode),
      getReservationsStats(periode),
      getClientsStats(periode),
      getStatsTempsReel(),
      getPrevisionsOccupation()
    ]);

    const stats = {
      revenus: revenusResult,
      reservations: reservationsResult,
      clients: clientsResult,
      temps_reel: tempsReelResult,
      previsions: previsionsResult,
      metriques: {
        periode: periode,
        date_actualisation: new Date().toISOString(),
        generation: 'temps_reel'
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

// 📈 Fonction pour les statistiques de revenus
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
      conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
      break;
    default:
      conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
  }

  const sql = `
    SELECT 
      COALESCE(SUM(tarif), 0) AS total,
      COUNT(*) AS nombre_reservations,
      ROUND(AVG(tarif), 2) AS moyenne_par_reservation,
      MAX(tarif) AS maximum,
      MIN(tarif) AS minimum,
      COUNT(DISTINCT datereservation) AS jours_avec_reservations,
      ROUND(SUM(tarif) / NULLIF(COUNT(DISTINCT datereservation), 0), 2) AS moyenne_journaliere
    FROM reservation 
    WHERE statut = 'confirmée'
    ${conditionPeriode}
  `;

  const result = await db.query(sql);
  const data = result.rows[0];

  // Calcul de l'évolution par rapport à la période précédente
  const evolution = await calculerEvolutionRevenus(periode);

  return {
    total: parseFloat(data.total),
    nombre_reservations: parseInt(data.nombre_reservations),
    moyenne_par_reservation: parseFloat(data.moyenne_par_reservation),
    maximum: parseFloat(data.maximum),
    minimum: parseFloat(data.minimum),
    moyenne_journaliere: parseFloat(data.moyenne_journaliere),
    evolution: evolution
  };
}

// 📊 Fonction pour les statistiques de réservations
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
      conditionPeriode = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
      break;
  }

  const sql = `
    SELECT 
      COUNT(*) AS total,
      COUNT(DISTINCT idclient) AS clients_uniques,
      COUNT(DISTINCT numeroterrain) AS terrains_utilises,
      COUNT(DISTINCT datereservation) AS jours_occupes,
      statut,
      COUNT(*) AS par_statut
    FROM reservation 
    WHERE 1=1 ${conditionPeriode}
    GROUP BY statut
  `;

  const result = await db.query(sql);
  
  let total = 0;
  const parStatut = {};
  let clientsUniques = 0;
  let terrainsUtilises = 0;
  let joursOccupes = 0;

  result.rows.forEach(row => {
    total += parseInt(row.par_statut);
    parStatut[row.statut] = parseInt(row.par_statut);
    clientsUniques = Math.max(clientsUniques, parseInt(row.clients_uniques));
    terrainsUtilises = Math.max(terrainsUtilises, parseInt(row.terrains_utilises));
    joursOccupes = Math.max(joursOccupes, parseInt(row.jours_occupes));
  });

  // Taux de confirmation
  const tauxConfirmation = total > 0 ? 
    Math.round((parStatut['confirmée'] || 0) / total * 100) : 0;

  // Évolution
  const evolution = await calculerEvolutionReservations(periode);

  return {
    total: total,
    par_statut: parStatut,
    clients_uniques: clientsUniques,
    terrains_utilises: terrainsUtilises,
    jours_occupes: joursOccupes,
    taux_confirmation: tauxConfirmation,
    evolution: evolution
  };
}

// 👥 Fonction pour les statistiques clients
async function getClientsStats(periode) {
  let conditionPeriode = '';
  switch (periode) {
    case 'jour':
      conditionPeriode = `AND date_inscription >= CURRENT_DATE`;
      break;
    case 'semaine':
      conditionPeriode = `AND date_inscription >= CURRENT_DATE - INTERVAL '7 days'`;
      break;
    case 'mois':
      conditionPeriode = `AND date_inscription >= CURRENT_DATE - INTERVAL '30 days'`;
      break;
  }

  // Clients totaux et nouveaux
  const sqlClients = `
    SELECT 
      COUNT(*) AS total_clients,
      COUNT(CASE WHEN date_inscription >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS nouveaux_30j,
      COUNT(CASE WHEN statut = 'actif' THEN 1 END) AS clients_actifs,
      COUNT(CASE WHEN statut = 'inactif' THEN 1 END) AS clients_inactifs
    FROM clients
    WHERE 1=1 ${conditionPeriode}
  `;

  // Clients avec réservations
  const sqlReservations = `
    SELECT 
      COUNT(DISTINCT idclient) AS clients_avec_reservations,
      COUNT(DISTINCT CASE WHEN r.datereservation >= CURRENT_DATE - INTERVAL '30 days' THEN r.idclient END) AS clients_actifs_30j
    FROM reservation r
    WHERE r.statut = 'confirmée'
    ${conditionPeriode.replace('date_inscription', 'r.datereservation')}
  `;

  const [resultClients, resultReservations] = await Promise.all([
    db.query(sqlClients),
    db.query(sqlReservations)
  ]);

  const dataClients = resultClients.rows[0];
  const dataReservations = resultReservations.rows[0];

  // Taux de fidélisation
  const tauxFidelisation = dataClients.total_clients > 0 ?
    Math.round((dataReservations.clients_avec_reservations / dataClients.total_clients) * 100) : 0;

  // Évolution
  const evolution = await calculerEvolutionClients(periode);

  return {
    total: parseInt(dataClients.total_clients),
    nouveaux_30j: parseInt(dataClients.nouveaux_30j),
    actifs: parseInt(dataClients.clients_actifs),
    inactifs: parseInt(dataClients.clients_inactifs),
    avec_reservations: parseInt(dataReservations.clients_avec_reservations),
    actifs_30j: parseInt(dataReservations.clients_actifs_30j),
    taux_fidelisation: tauxFidelisation,
    evolution: evolution
  };
}

// ⚡ Fonction pour les statistiques temps réel
async function getStatsTempsReel() {
  const maintenant = new Date();
  const heureActuelle = maintenant.toTimeString().split(' ')[0];

  const sql = `
    -- Terrains occupés en ce moment
    SELECT COUNT(DISTINCT numeroterrain) AS terrains_occupes_actuels
    FROM reservation 
    WHERE statut = 'confirmée'
      AND datereservation = CURRENT_DATE
      AND heurereservation <= $1
      AND heurefin >= $1
    
    UNION ALL
    
    -- Réservations aujourd'hui
    SELECT COUNT(*) AS reservations_aujourdhui
    FROM reservation 
    WHERE statut = 'confirmée'
      AND datereservation = CURRENT_DATE
    
    UNION ALL
    
    -- Revenus aujourd'hui
    SELECT COALESCE(SUM(tarif), 0) AS revenu_aujourdhui
    FROM reservation 
    WHERE statut = 'confirmée'
      AND datereservation = CURRENT_DATE
    
    UNION ALL
    
    -- Prochaines réservations (dans les 2h)
    SELECT COUNT(*) AS prochaines_reservations
    FROM reservation 
    WHERE statut = 'confirmée'
      AND datereservation = CURRENT_DATE
      AND heurereservation BETWEEN $1 AND (CURRENT_TIME + INTERVAL '2 hours')
  `;

  const result = await db.query(sql, [heureActuelle]);
  
  return {
    terrains_occupes_actuels: parseInt(result.rows[0]?.terrains_occupes_actuels || 0),
    reservations_aujourdhui: parseInt(result.rows[1]?.reservations_aujourdhui || 0),
    revenu_aujourdhui: parseFloat(result.rows[2]?.revenu_aujourdhui || 0),
    prochaines_reservations: parseInt(result.rows[3]?.prochaines_reservations || 0),
    heure_actualisation: heureActuelle
  };
}

// 🔮 Fonction pour les prévisions d'occupation
async function getPrevisionsOccupation() {
  const sql = `
    WITH previsions_14j AS (
      SELECT 
        datereservation,
        COUNT(*) AS nb_reservations,
        COALESCE(SUM(tarif), 0) AS revenu_prevue,
        COUNT(DISTINCT numeroterrain) AS terrains_occupes,
        ROUND(
          (COUNT(DISTINCT numeroterrain) * 12.0 / 
          NULLIF((SELECT COUNT(DISTINCT numeroterrain) FROM terrain) * 12, 0)) * 100, 2
        ) AS taux_occupation_prevue
      FROM reservation
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
      GROUP BY datereservation
    )
    SELECT 
      AVG(taux_occupation_prevue) AS taux_moyen_prevue,
      MAX(taux_occupation_prevue) AS taux_max_prevue,
      MIN(taux_occupation_prevue) AS taux_min_prevue,
      SUM(nb_reservations) AS reservations_totales_prevues,
      SUM(revenu_prevue) AS revenu_total_prevue,
      COUNT(*) AS jours_avec_reservations
    FROM previsions_14j
  `;

  const result = await db.query(sql);
  const data = result.rows[0];

  return {
    taux_moyen_prevue: parseFloat(data.taux_moyen_prevue || 0),
    taux_max_prevue: parseFloat(data.taux_max_prevue || 0),
    taux_min_prevue: parseFloat(data.taux_min_prevue || 0),
    reservations_totales_prevues: parseInt(data.reservations_totales_prevues || 0),
    revenu_total_prevue: parseFloat(data.revenu_total_prevue || 0),
    jours_avec_reservations: parseInt(data.jours_avec_reservations || 0),
    periode_prevision: '14_jours'
  };
}

// 📈 Fonctions de calcul d'évolution
async function calculerEvolutionRevenus(periode) {
  let conditionActuelle = '';
  let conditionPrecedente = '';
  
  switch (periode) {
    case 'jour':
      conditionActuelle = `AND datereservation = CURRENT_DATE`;
      conditionPrecedente = `AND datereservation = CURRENT_DATE - INTERVAL '1 day'`;
      break;
    case 'semaine':
      conditionActuelle = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE`;
      conditionPrecedente = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '14 days' AND CURRENT_DATE - INTERVAL '7 days'`;
      break;
    case 'mois':
      conditionActuelle = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE`;
      conditionPrecedente = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '30 days'`;
      break;
  }

  const sql = `
    SELECT 
      (SELECT COALESCE(SUM(tarif), 0) FROM reservation WHERE statut = 'confirmée' ${conditionActuelle}) AS actuel,
      (SELECT COALESCE(SUM(tarif), 0) FROM reservation WHERE statut = 'confirmée' ${conditionPrecedente}) AS precedent
  `;

  const result = await db.query(sql);
  const actuel = parseFloat(result.rows[0].actuel);
  const precedent = parseFloat(result.rows[0].precedent);

  const evolution = precedent > 0 ? 
    Math.round(((actuel - precedent) / precedent) * 100) : 
    (actuel > 0 ? 100 : 0);

  return {
    valeur: evolution,
    est_positif: evolution >= 0,
    periode_comparaison: periode
  };
}

async function calculerEvolutionReservations(periode) {
  // Implémentation similaire à calculerEvolutionRevenus
  // ... (code similaire adapté pour les réservations)
}

async function calculerEvolutionClients(periode) {
  // Implémentation similaire à calculerEvolutionRevenus
  // ... (code similaire adapté pour les clients)
}

export default router;