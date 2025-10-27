import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 STATISTIQUES RÉELLES POUR LE DASHBOARD
router.get('/statistiques-temps-reel', async (req, res) => {
  try {
    // Statistiques basées uniquement sur les réservations CONFIRMÉES
    const stats = await db.query(`
      SELECT 
        -- Aujourd'hui (réservations confirmées)
        COUNT(*) FILTER (WHERE statut = 'confirmée' AND datereservation = CURRENT_DATE) AS reservations_aujourdhui,
        COALESCE(SUM(tarif) FILTER (WHERE statut = 'confirmée' AND datereservation = CURRENT_DATE), 0) AS revenu_aujourdhui,
        
        -- Ce mois (réservations confirmées)
        COUNT(*) FILTER (WHERE statut = 'confirmée' AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)) AS reservations_mois,
        COALESCE(SUM(tarif) FILTER (WHERE statut = 'confirmée' AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)), 0) AS revenu_mois,
        
        -- Terrains actifs cette semaine (réservations confirmées)
        COUNT(DISTINCT numeroterrain) FILTER (WHERE statut = 'confirmée' AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS terrains_actifs_semaine,
        
        -- Annulations cette semaine
        COUNT(*) FILTER (WHERE statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS annulations_semaine
      FROM reservation
    `);

    // Terrains occupés en ce moment (réservations confirmées aujourd'hui aux heures actuelles)
    const terrainsOccupes = await db.query(`
      SELECT COUNT(DISTINCT numeroterrain) AS terrains_occupes_actuels
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation = CURRENT_DATE
        AND heurereservation <= CURRENT_TIME
        AND heurefin >= CURRENT_TIME
    `);

    const result = {
      terrains_occupes_actuels: terrainsOccupes.rows[0]?.terrains_occupes_actuels || 0,
      annulations_semaine: stats.rows[0]?.annulations_semaine || 0,
      terrains_actifs_semaine: stats.rows[0]?.terrains_actifs_semaine || 0,
      reservations_aujourdhui: stats.rows[0]?.reservations_aujourdhui || 0,
      revenu_aujourdhui: parseFloat(stats.rows[0]?.revenu_aujourdhui) || 0,
      reservations_mois: stats.rows[0]?.reservations_mois || 0,
      revenu_mois: parseFloat(stats.rows[0]?.revenu_mois) || 0,
      date_actualisation: new Date().toISOString()
    };

    res.json({
      success: true,
      data: result,
      metriques: {
        periode: 'temps_réel',
        heure_serveur: new Date().toLocaleTimeString('fr-FR'),
        source: 'réservations_confirmées'
      }
    });

  } catch (error) {
    console.error('❌ Erreur statistiques temps réel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 💰 REVENUS TOTAUX BASÉS SUR RÉSERVATIONS CONFIRMÉES
router.get('/revenus-totaux', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;
    
    let condition = '';
    switch (periode) {
      case 'jour':
        condition = `AND datereservation = CURRENT_DATE`;
        break;
      case 'semaine':
        condition = `AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE`;
        break;
      case 'mois':
        condition = `AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)`;
        break;
      case 'annee':
        condition = `AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)`;
        break;
      default:
        condition = `AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)`;
    }

    const result = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) AS revenu_total,
        COUNT(*) AS nb_reservations,
        COUNT(DISTINCT email) AS clients_uniques,
        ROUND(AVG(tarif), 2) AS revenu_moyen_par_reservation,
        MAX(tarif) AS revenu_max,
        MIN(tarif) AS revenu_min
      FROM reservation 
      WHERE statut = 'confirmée'
      ${condition}
    `);

    res.json({
      success: true,
      periode: periode,
      data: {
        revenu_total: parseFloat(result.rows[0]?.revenu_total) || 0,
        nb_reservations: parseInt(result.rows[0]?.nb_reservations) || 0,
        clients_uniques: parseInt(result.rows[0]?.clients_uniques) || 0,
        revenu_moyen_par_reservation: parseFloat(result.rows[0]?.revenu_moyen_par_reservation) || 0,
        revenu_max: parseFloat(result.rows[0]?.revenu_max) || 0,
        revenu_min: parseFloat(result.rows[0]?.revenu_min) || 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération revenus totaux:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 TAUX DE REMPLISSAGE RÉEL
router.get('/taux-remplissage', async (req, res) => {
  try {
    const { type = 'mensuel' } = req.query;

    let sql = '';
    
    if (type === 'journalier') {
      sql = `
        WITH dates_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '15 days', 
            CURRENT_DATE, 
            '1 day'::interval
          )::date AS date_jour
        ),
        reservations_par_jour AS (
          SELECT 
            datereservation,
            COUNT(*) as nb_reservations
          FROM reservation
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '15 days' AND CURRENT_DATE
          GROUP BY datereservation
        )
        SELECT 
          ds.date_jour AS date,
          TO_CHAR(ds.date_jour, 'DD/MM') AS date_formattee,
          EXTRACT(DOW FROM ds.date_jour) AS jour_semaine,
          COALESCE(rj.nb_reservations, 0) AS nb_reservations,
          -- Calcul basé sur 12 terrains disponibles, 3 créneaux par terrain par jour
          CASE 
            WHEN COALESCE(rj.nb_reservations, 0) > 0 
            THEN ROUND((COALESCE(rj.nb_reservations, 0) * 100.0 / 36), 2) -- 12 terrains × 3 créneaux = 36 créneaux max
            ELSE 0
          END AS taux_remplissage,
          COALESCE((
            SELECT SUM(tarif) 
            FROM reservation r2 
            WHERE r2.datereservation = ds.date_jour 
            AND r2.statut = 'confirmée'
          ), 0) AS revenu_jour
        FROM dates_series ds
        LEFT JOIN reservations_par_jour rj ON ds.date_jour = rj.datereservation
        ORDER BY ds.date_jour ASC
      `;
    } else {
      sql = `
        WITH mois_series AS (
          SELECT 
            date_trunc('month', generate_series(
              CURRENT_DATE - INTERVAL '5 months', 
              CURRENT_DATE, 
              '1 month'::interval
            )) AS debut_mois
        ),
        reservations_par_mois AS (
          SELECT 
            date_trunc('month', datereservation) AS debut_mois,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as revenu_mois
          FROM reservation
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '5 months' AND CURRENT_DATE
          GROUP BY date_trunc('month', datereservation)
        )
        SELECT 
          ms.debut_mois AS date_debut_mois,
          TO_CHAR(ms.debut_mois, 'MM/YYYY') AS periode_mois,
          TO_CHAR(ms.debut_mois, 'Month YYYY') AS periode_mois_complet,
          COALESCE(rm.nb_reservations, 0) AS nb_reservations,
          COALESCE(rm.revenu_mois, 0) AS revenu_mois,
          -- Calcul basé sur 12 terrains, 30 jours, 3 créneaux par jour = 1080 créneaux max par mois
          CASE 
            WHEN COALESCE(rm.nb_reservations, 0) > 0 
            THEN ROUND((COALESCE(rm.nb_reservations, 0) * 100.0 / 1080), 2)
            ELSE 0
          END AS taux_remplissage
        FROM mois_series ms
        LEFT JOIN reservations_par_mois rm ON ms.debut_mois = rm.debut_mois
        ORDER BY ms.debut_mois ASC
      `;
    }

    const result = await db.query(sql);

    // Calcul des statistiques réelles
    const tauxList = result.rows.map(row => parseFloat(row.taux_remplissage) || 0);
    const tauxMoyen = tauxList.length > 0 ? 
      Math.round(tauxList.reduce((a, b) => a + b, 0) / tauxList.length) : 0;

    const stats = {
      taux_remplissage_moyen: tauxMoyen,
      periode_max_remplissage: result.rows.reduce((max, row) => {
        const taux = parseFloat(row.taux_remplissage) || 0;
        const maxTaux = parseFloat(max.taux_remplissage) || 0;
        return taux > maxTaux ? row : max;
      }, result.rows[0]),
      periode_min_remplissage: result.rows.reduce((min, row) => {
        const taux = parseFloat(row.taux_remplissage) || 0;
        const minTaux = parseFloat(min.taux_remplissage) || 0;
        return taux < minTaux ? row : min;
      }, result.rows[0]),
      total_periodes: result.rows.length
    };

    res.json({
      success: true,
      type_remplissage: type,
      data: result.rows,
      statistiques: stats,
      metriques: {
        date_generation: new Date().toISOString(),
        source: 'réservations_confirmées'
      }
    });

  } catch (error) {
    console.error('❌ Erreur taux remplissage:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 PRÉVISIONS RÉELLES BASÉES SUR RÉSERVATIONS CONFIRMÉES
router.get('/previsions/detaillees', async (req, res) => {
  try {
    const { jours = 14 } = req.query;
    const joursNumber = parseInt(jours);

    const sql = `
      WITH reservations_futures AS (
        SELECT 
          datereservation,
          COUNT(*) as nb_reservations,
          COUNT(DISTINCT numeroterrain) as nb_terrains,
          COALESCE(SUM(tarif), 0) as revenu_attendu,
          STRING_AGG(DISTINCT typeterrain, ', ') as types_terrains
        FROM reservation
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE
          AND datereservation <= CURRENT_DATE + INTERVAL '${joursNumber} days'
        GROUP BY datereservation
      )
      SELECT 
        rf.datereservation,
        rf.nb_reservations,
        rf.nb_terrains,
        rf.revenu_attendu,
        rf.types_terrains,
        TO_CHAR(rf.datereservation, 'DD Mon') AS date_formattee,
        EXTRACT(DOW FROM rf.datereservation) AS jour_semaine,
        -- Taux d'occupation basé sur 12 terrains et 3 créneaux par jour
        CASE 
          WHEN rf.nb_reservations > 0 
          THEN ROUND((rf.nb_reservations * 100.0 / 36), 2) -- 12 terrains × 3 créneaux
          ELSE 0
        END AS taux_occupation_prevu,
        CASE 
          WHEN rf.nb_reservations >= 24 THEN 'Très élevée'  -- >66%
          WHEN rf.nb_reservations >= 18 THEN 'Élevée'       -- >50%
          WHEN rf.nb_reservations >= 12 THEN 'Moyenne'      -- >33%
          ELSE 'Faible'
        END AS niveau_occupation
      FROM reservations_futures rf
      ORDER BY rf.datereservation ASC
    `;

    const result = await db.query(sql);

    // Compléter avec les dates manquantes
    const today = new Date();
    const dateFin = new Date(today);
    dateFin.setDate(today.getDate() + joursNumber);
    
    const toutesLesDates = [];
    const dateCourante = new Date(today);
    
    while (dateCourante <= dateFin) {
      const dateStr = dateCourante.toISOString().split('T')[0];
      const dateFormatee = dateCourante.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const jourSemaine = dateCourante.getDay();
      
      const reservationExistante = result.rows.find(row => 
        new Date(row.datereservation).toISOString().split('T')[0] === dateStr
      );
      
      if (reservationExistante) {
        toutesLesDates.push(reservationExistante);
      } else {
        toutesLesDates.push({
          datereservation: dateStr,
          taux_occupation_prevu: 0,
          nb_reservations: 0,
          revenu_attendu: 0,
          nb_terrains: 0,
          types_terrains: 'Aucun',
          date_formattee: dateFormatee,
          jour_semaine: jourSemaine,
          niveau_occupation: 'Faible'
        });
      }
      
      dateCourante.setDate(dateCourante.getDate() + 1);
    }

    // Statistiques réelles
    const joursAvecReservations = toutesLesDates.filter(row => row.nb_reservations > 0).length;
    const moyenneOccupation = joursAvecReservations > 0 ? 
      Math.round(toutesLesDates.reduce((sum, row) => sum + parseFloat(row.taux_occupation_prevu), 0) / joursAvecReservations) : 0;

    const stats = {
      moyenne_occupation: moyenneOccupation,
      jour_plus_charge: toutesLesDates.reduce(
        (max, row) => parseFloat(row.taux_occupation_prevu) > parseFloat(max.taux_occupation_prevu) ? row : max,
        toutesLesDates[0]
      ),
      jour_moins_charge: toutesLesDates.reduce(
        (min, row) => parseFloat(row.taux_occupation_prevu) < parseFloat(min.taux_occupation_prevu) ? row : min,
        toutesLesDates[0]
      ),
      revenu_total_attendu: toutesLesDates.reduce((sum, row) => sum + parseFloat(row.revenu_attendu), 0),
      reservations_total: toutesLesDates.reduce((sum, row) => sum + parseInt(row.nb_reservations), 0),
      jours_avec_reservations: joursAvecReservations
    };

    res.json({
      success: true,
      data: toutesLesDates,
      periode: joursNumber,
      statistiques: stats,
      metriques: {
        date_debut: today.toISOString().split('T')[0],
        date_fin: dateFin.toISOString().split('T')[0],
        total_jours: toutesLesDates.length,
        source: 'réservations_confirmées_futures'
      }
    });

  } catch (error) {
    console.error('❌ Erreur prévisions détaillées:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;