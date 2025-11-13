// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (version annulations)
router.get('/dashboard-annulations', async (req, res) => {
  try {
    // Récupérer les statistiques d'annulation en parallèle
    const [
      revenusPerdusMois,
      annulationsMois,
      clientsAnnulant,
      tauxAnnulation,
      statsTempsReel,
      revenusPerdusAnnee,
      motifsAnnulation
    ] = await Promise.all([
      // Revenus perdus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Annulations du mois
      db.query(`
        SELECT COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Clients ayant annulé ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_annulant
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux d'annulation du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel annulations
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as total_aujourdhui,
          ROUND(
            (COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END), 0)
            ), 2
          ) as taux_annulation_aujourdhui
        FROM reservation
      `),
      
      // Revenus perdus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Motifs d'annulation les plus fréquents
      db.query(`
        SELECT 
          motifannulation,
          COUNT(*) as nombre_annulations,
          ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée')), 2) as pourcentage
        FROM reservation 
        WHERE statut = 'annulée'
        AND motifannulation IS NOT NULL
        GROUP BY motifannulation
        ORDER BY nombre_annulations DESC
        LIMIT 5
      `)
    ]);

    const stats = {
      revenus_perdus_mois: parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      clients_annulant: parseInt(clientsAnnulant.rows[0]?.clients_annulant || 0),
      taux_annulation: parseFloat(tauxAnnulation.rows[0]?.taux_annulation || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      taux_annulation_aujourdhui: parseFloat(statsTempsReel.rows[0]?.taux_annulation_aujourdhui || 0),
      revenus_perdus_annee: parseFloat(revenusPerdusAnnee.rows[0]?.revenus_perdus_annee || 0),
      motifs_annulation: motifsAnnulation.rows
    };

    // Calcul des trends pour les annulations
    const trends = await calculateTrendsAnnulations(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Évolution des annulations sur 12 mois
router.get('/evolution-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      WITH mois_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '11 months',
          CURRENT_DATE,
          '1 month'::interval
        )::date as mois
      )
      SELECT 
        TO_CHAR(ms.mois, 'YYYY-MM') as periode,
        TO_CHAR(ms.mois, 'Mon YYYY') as periode_affichage,
        COALESCE(COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END), 0) as annulations,
        COALESCE(COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END), 0) as confirmations,
        COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(r.numeroreservations), 0)
          ), 2
        ) as taux_annulation_mensuel
      FROM mois_series ms
      LEFT JOIN reservation r ON 
        EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
        AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
      GROUP BY ms.mois
      ORDER BY ms.mois ASC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur évolution annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🎯 Analyse des terrains les plus affectés par les annulations
router.get('/terrains-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(*) as total_annulations,
        COALESCE(SUM(tarif), 0) as revenus_perdus,
        COUNT(DISTINCT idclient) as clients_annulant,
        ROUND(
          (COUNT(*) * 100.0 / 
          (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days')
          ), 2
        ) as part_annulations_total,
        ROUND(
          (COUNT(*) * 100.0 / 
          NULLIF(
            (SELECT COUNT(*) FROM reservation 
             WHERE numeroterrain = r.numeroterrain 
             AND datereservation >= CURRENT_DATE - INTERVAL '30 days'), 0
          )), 2
        ) as taux_annulation_terrain
      FROM reservation r
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY total_annulations DESC, revenus_perdus DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur analyse terrains annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 👥 Analyse des clients qui annulent le plus
router.get('/clients-annulations', async (req, res) => {
  try {
    const [
      clientsFrequentsAnnulations,
      statsAnnulationsClients,
      nouveauxClientsAnnulant
    ] = await Promise.all([
      // Clients qui annulent le plus
      db.query(`
        SELECT 
          c.idclient,
          c.nom,
          c.prenom,
          c.email,
          c.telephone,
          COUNT(r.numeroreservations) as total_annulations,
          COALESCE(SUM(r.tarif), 0) as total_revenus_perdus,
          COUNT(DISTINCT r.numeroterrain) as terrains_affectes,
          MAX(r.datereservation) as derniere_annulation,
          ROUND(
            (COUNT(r.numeroreservations) * 100.0 / 
            NULLIF(
              (SELECT COUNT(*) FROM reservation r2 WHERE r2.idclient = c.idclient), 0
            )), 2
          ) as taux_annulation_personnel
        FROM clients c
        JOIN reservation r ON c.idclient = r.idclient
        WHERE r.statut = 'annulée'
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone
        HAVING COUNT(r.numeroreservations) >= 2
        ORDER BY total_annulations DESC, total_revenus_perdus DESC
        LIMIT 15
      `),
      
      // Statistiques générales annulations clients
      db.query(`
        SELECT 
          COUNT(DISTINCT idclient) as total_clients_annulant,
          ROUND(AVG(annulations_par_client), 2) as annulations_moyennes,
          MAX(annulations_par_client) as annulations_max,
          COUNT(DISTINCT CASE WHEN annulations_par_client >= 3 THEN idclient END) as clients_recurrents_annulation
        FROM (
          SELECT 
            idclient,
            COUNT(*) as annulations_par_client
          FROM reservation 
          WHERE statut = 'annulée'
          GROUP BY idclient
        ) stats_annulations
      `),
      
      // Nouveaux clients ayant annulé ce mois-ci
      db.query(`
        SELECT 
          c.idclient,
          c.nom,
          c.prenom,
          c.email,
          c.telephone,
          c.dateinscription,
          COUNT(r.numeroreservations) as annulations_mois,
          COALESCE(SUM(r.tarif), 0) as revenus_perdus
        FROM clients c
        JOIN reservation r ON c.idclient = r.idclient
        WHERE r.statut = 'annulée'
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND c.dateinscription >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.dateinscription
        ORDER BY annulations_mois DESC
      `)
    ]);

    res.json({
      success: true,
      data: {
        clients_frequents_annulations: clientsFrequentsAnnulations.rows,
        statistiques_annulations: statsAnnulationsClients.rows[0],
        nouveaux_clients_annulant: nouveauxClientsAnnulant.rows
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse clients annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions des risques d'annulation
router.get('/previsions-risques-annulation', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH historique_annulations AS (
        -- Analyse des patterns d'annulation historiques
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          EXTRACT(HOUR FROM heurestime) as heure_jour,
          numeroterrain,
          typeterrain,
          COUNT(*) as annulations_historiques,
          ROUND(
            (COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée' AND datereservation >= CURRENT_DATE - INTERVAL '90 days')
            ), 2
          ) as frequence_relative
        FROM reservation 
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY jour_semaine, heure_jour, numeroterrain, typeterrain
      ),
      reservations_futures AS (
        -- Réservations futures avec analyse de risque
        SELECT 
          r.numeroreservations,
          r.datereservation,
          r.heurestime,
          r.numeroterrain,
          r.typeterrain,
          r.idclient,
          r.tarif,
          EXTRACT(DOW FROM r.datereservation) as jour_semaine,
          EXTRACT(HOUR FROM r.heurestime) as heure_jour,
          COALESCE(ha.annulations_historiques, 0) as annulations_similaires_historique,
          COALESCE(ha.frequence_relative, 0) as score_risque,
          CASE 
            WHEN COALESCE(ha.frequence_relative, 0) > 10 THEN 'Élevé'
            WHEN COALESCE(ha.frequence_relative, 0) > 5 THEN 'Moyen'
            ELSE 'Faible'
          END as niveau_risque,
          -- Vérifier si le client a des antécédents d'annulation
          (
            SELECT COUNT(*) 
            FROM reservation r2 
            WHERE r2.idclient = r.idclient 
            AND r2.statut = 'annulée'
            AND r2.datereservation >= CURRENT_DATE - INTERVAL '60 days'
          ) as annulations_client_60j
        FROM reservation r
        LEFT JOIN historique_annulations ha ON 
          ha.jour_semaine = EXTRACT(DOW FROM r.datereservation)
          AND ha.heure_jour = EXTRACT(HOUR FROM r.heurestime)
          AND ha.numeroterrain = r.numeroterrain
        WHERE r.statut = 'confirmée'
          AND r.datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      )
      SELECT 
        *,
        CASE 
          WHEN annulations_client_60j >= 2 THEN score_risque + 15
          WHEN annulations_client_60j = 1 THEN score_risque + 5
          ELSE score_risque
        END as score_risque_ajuste,
        CASE 
          WHEN (score_risque + 
                CASE WHEN annulations_client_60j >= 2 THEN 15
                     WHEN annulations_client_60j = 1 THEN 5
                     ELSE 0 END) > 15 THEN 'Élevé'
          WHEN (score_risque + 
                CASE WHEN annulations_client_60j >= 2 THEN 15
                     WHEN annulations_client_60j = 1 THEN 5
                     ELSE 0 END) > 8 THEN 'Moyen'
          ELSE 'Faible'
        END as niveau_risque_ajuste
      FROM reservations_futures
      ORDER BY score_risque_ajuste DESC, datereservation ASC
    `);

    // Calcul des statistiques de risque
    const statsRisque = {
      total_reservations_risque: result.rows.length,
      reservations_risque_eleve: result.rows.filter(row => row.niveau_risque_ajuste === 'Élevé').length,
      reservations_risque_moyen: result.rows.filter(row => row.niveau_risque_ajuste === 'Moyen').length,
      revenus_risque_eleve: result.rows
        .filter(row => row.niveau_risque_ajuste === 'Élevé')
        .reduce((sum, row) => sum + parseFloat(row.tarif), 0),
      clients_recurrents_risque: new Set(
        result.rows
          .filter(row => row.annulations_client_60j >= 2)
          .map(row => row.idclient)
      ).size
    };

    statsRisque.pourcentage_risque_eleve = Math.round(
      (statsRisque.reservations_risque_eleve / statsRisque.total_reservations_risque) * 100
    );

    res.json({
      success: true,
      data: result.rows,
      statistiques_risque: statsRisque,
      periode_analyse: parseInt(periode)
    });
  } catch (error) {
    console.error('❌ Erreur prévisions risques annulation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📅 Analyse des créneaux à haut risque d'annulation
router.get('/creneaux-risque-annulation', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as num_jour_semaine,
        CASE 
          WHEN EXTRACT(HOUR FROM heurestime) BETWEEN 8 AND 12 THEN 'Matin'
          WHEN EXTRACT(HOUR FROM heurestime) BETWEEN 13 AND 17 THEN 'Après-midi'
          WHEN EXTRACT(HOUR FROM heurestime) BETWEEN 18 AND 22 THEN 'Soir'
          ELSE 'Nuit'
        END as periode_journee,
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(AVG(CASE WHEN statut = 'annulée' THEN tarif END), 2) as revenu_moyen_perdu
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY jour_semaine, num_jour_semaine, periode_journee
      ORDER BY taux_annulation DESC, revenus_perdus DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Erreur analyse créneaux risque:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends des annulations
async function calculateTrendsAnnulations(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenus_perdus_mois_dernier,
        COUNT(*) as annulations_mois_dernier
      FROM reservation 
      WHERE statut = 'annulée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    const trends = {
      annulations: {
        value: calculatePercentageChange(currentStats.annulations_mois, lastMonth.annulations_mois_dernier),
        isPositive: currentStats.annulations_mois < lastMonth.annulations_mois_dernier // Moins d'annulations = positif
      },
      revenus_perdus: {
        value: calculatePercentageChange(currentStats.revenus_perdus_mois, lastMonth.revenus_perdus_mois_dernier),
        isPositive: currentStats.revenus_perdus_mois < lastMonth.revenus_perdus_mois_dernier // Moins de revenus perdus = positif
      },
      taux_annulation: {
        value: calculatePercentageChange(currentStats.taux_annulation, 
          lastMonth.annulations_mois_dernier / (lastMonth.annulations_mois_dernier + 100) * 100), // Approximation
        isPositive: currentStats.taux_annulation < (lastMonth.annulations_mois_dernier / (lastMonth.annulations_mois_dernier + 100) * 100)
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends annulations:', error);
    return {};
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;