// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// Middleware de vérification BDD
const checkDatabase = async (req, res, next) => {
  try {
    if (!db || typeof db.query !== 'function') {
      return res.status(503).json({
        success: false,
        message: 'Service de base de données indisponible'
      });
    }
    await db.query('SELECT 1');
    next();
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: 'Erreur de connexion à la base de données'
    });
  }
};

router.use(checkDatabase);

// ============================================
// ROUTE 1: DASHBOARD ANNULATIONS
// ============================================
router.get('/dashboard-annulations', async (req, res) => {
  try {
    const [
      revenusPerdusMois,
      annulationsMois,
      terrainsAffectes,
      tauxAnnulation,
      statsTempsReel,
      revenusPerdusAnnee
    ] = await Promise.all([
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      db.query(`
        SELECT COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_affectes
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      db.query(`
        SELECT 
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      db.query(`
        SELECT 
          COUNT(CASE WHEN DATE(datereservation) = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui,
          COUNT(CASE WHEN DATE(datereservation) = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN DATE(datereservation) = CURRENT_DATE THEN 1 END) as total_aujourdhui
        FROM reservation
      `),
      
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `)
    ]);

    // Calcul des trends
    const lastMonthStats = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois_dernier,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois_dernier
      FROM reservation 
      WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const stats = {
      revenus_perdus_mois: parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
      annulations_mois: parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
      terrains_affectes: parseInt(terrainsAffectes.rows[0]?.terrains_affectes || 0),
      taux_annulation: parseFloat(tauxAnnulation.rows[0]?.taux_annulation || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      total_aujourdhui: parseInt(statsTempsReel.rows[0]?.total_aujourdhui || 0),
      taux_annulation_aujourdhui: statsTempsReel.rows[0]?.total_aujourdhui > 0 
        ? parseFloat(((statsTempsReel.rows[0]?.annules_aujourdhui || 0) * 100.0 / statsTempsReel.rows[0]?.total_aujourdhui).toFixed(2))
        : 0,
      revenus_perdus_annee: parseFloat(revenusPerdusAnnee.rows[0]?.revenus_perdus_annee || 0),
      trends: {
        annulations: {
          value: calculatePercentageChange(
            parseInt(annulationsMois.rows[0]?.annulations_mois || 0),
            parseInt(lastMonthStats.rows[0]?.annulations_mois_dernier || 0)
          ),
          isPositive: (parseInt(annulationsMois.rows[0]?.annulations_mois || 0) < parseInt(lastMonthStats.rows[0]?.annulations_mois_dernier || 0))
        },
        revenus_perdus: {
          value: calculatePercentageChange(
            parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0),
            parseFloat(lastMonthStats.rows[0]?.revenus_perdus_mois_dernier || 0)
          ),
          isPositive: (parseFloat(revenusPerdusMois.rows[0]?.revenus_perdus_mois || 0) < parseFloat(lastMonthStats.rows[0]?.revenus_perdus_mois_dernier || 0))
        }
      }
    };

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Erreur dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 2: ÉVOLUTION ANNULATIONS
// ============================================
router.get('/evolution-annulations', async (req, res) => {
  try {
    const { mois_centre = 'true' } = req.query;
    
    let query = `
      WITH RECURSIVE mois_series AS (
        SELECT 
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months' as mois
        UNION ALL
        SELECT mois + INTERVAL '1 month'
        FROM mois_series
        WHERE mois < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '6 months'
      )
      SELECT 
        TO_CHAR(ms.mois, 'YYYY-MM') as periode,
        TO_CHAR(ms.mois, 'Mon YYYY') as periode_affichage,
        EXTRACT(MONTH FROM ms.mois) as numero_mois,
        EXTRACT(YEAR FROM ms.mois) as annee,
        COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
        COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as confirmations,
        COUNT(r.numeroreservations) as total_reservations,
        COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(r.numeroreservations), 0)
          ), 2
        ) as taux_annulation_mensuel
      FROM mois_series ms
      LEFT JOIN reservation r ON DATE_TRUNC('month', r.datereservation) = ms.mois
      GROUP BY ms.mois
      ORDER BY ms.mois ASC
    `;

    const result = await db.query(query);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur evolution:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 3: TERRAINS ANNULATIONS
// ============================================
router.get('/terrains-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        r.numeroterrain,
        COALESCE(r.nomterrain, 'Terrain ' || r.numeroterrain) as nomterrain,
        COALESCE(r.typeterrain, 'Standard') as typeterrain,
        COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations_total,
        COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as confirmations_total,
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_terrain
      FROM reservation r
      GROUP BY r.numeroterrain, r.nomterrain, r.typeterrain
      HAVING COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) > 0
      ORDER BY annulations_total DESC, taux_annulation_terrain DESC
    `);

    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('❌ Erreur terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 4: STATS PÉRIODES ANNULATIONS
// ============================================
router.get('/stats-periodes-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' AND datereservation > CURRENT_DATE THEN 1 END) as annulations_futures,
        COALESCE(SUM(CASE WHEN statut = 'annulée' AND datereservation > CURRENT_DATE THEN tarif ELSE 0 END), 0) as revenus_perdus_futurs,
        COUNT(CASE WHEN statut = 'annulée' AND DATE(datereservation) = CURRENT_DATE THEN 1 END) as annulations_aujourdhui,
        COALESCE(SUM(CASE WHEN statut = 'annulée' AND DATE(datereservation) = CURRENT_DATE THEN tarif ELSE 0 END), 0) as revenus_perdus_aujourdhui,
        COUNT(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as annulations_7_jours,
        COALESCE(SUM(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE - INTERVAL '1 day' THEN tarif ELSE 0 END), 0) as revenus_perdus_7_jours,
        COUNT(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '7 days' THEN 1 END) as annulations_7_prochains_jours,
        COALESCE(SUM(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '7 days' THEN tarif ELSE 0 END), 0) as revenus_risque_7_jours
      FROM reservation
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
    `);

    res.status(200).json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur periodes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 5: ANNULATIONS RÉCENTES
// ============================================
router.get('/annulations-recentes', async (req, res) => {
  try {
    const { limite = '20' } = req.query;
    
    const result = await db.query(`
      SELECT 
        r.numeroreservations,
        COALESCE(r.nomclient, 'Client inconnu') as nomclient,
        COALESCE(r.prenom, '') as prenom,
        r.email,
        r.telephone,
        r.numeroterrain,
        COALESCE(r.nomterrain, 'Terrain ' || r.numeroterrain) as nomterrain,
        r.typeterrain,
        TO_CHAR(r.datereservation, 'YYYY-MM-DD HH24:MI') as date_reservation,
        TO_CHAR(r.datereservation, 'DD/MM/YYYY HH24:MI') as date_formattee,
        r.tarif,
        CASE 
          WHEN r.datereservation > CURRENT_DATE THEN 'future'
          WHEN DATE(r.datereservation) = CURRENT_DATE THEN 'aujourd_hui'
          ELSE 'passee'
        END as statut_temporel
      FROM reservation r
      WHERE r.statut = 'annulée'
        AND r.datereservation >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY 
        CASE 
          WHEN r.datereservation >= CURRENT_DATE THEN 0
          ELSE 1
        END,
        ABS(EXTRACT(EPOCH FROM (r.datereservation - CURRENT_DATE))) ASC
      LIMIT $1
    `, [limite]);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur recentes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 6: ANNULATIONS FUTURES
// ============================================
router.get('/annulations-futures', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'DD/MM/YYYY HH24:MI') as date_formattee,
        TO_CHAR(datereservation, 'Day DD/MM') as jour_formatte,
        COALESCE(nomclient, 'Client inconnu') as nomclient,
        COALESCE(prenom, '') as prenom,
        tarif,
        numeroterrain,
        COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
        email,
        telephone,
        EXTRACT(DAY FROM (datereservation - CURRENT_DATE)) as jours_restants
      FROM reservation
      WHERE statut = 'confirmée' 
        AND datereservation > CURRENT_DATE
      ORDER BY datereservation ASC
    `);

    const stats = {
      total: result.rows.length,
      revenus_prevus: result.rows.reduce((acc, r) => acc + parseFloat(r.tarif || 0), 0),
      reservations_futures: result.rows
    };

    res.status(200).json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Erreur futures:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 7: ANALYSE TEMPORELLE
// ============================================
router.get('/analyse-temporelle-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH stats_journalieres AS (
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          EXTRACT(DOW FROM datereservation) as num_jour_semaine,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
          COUNT(*) as total_reservations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY datereservation
      )
      SELECT 
        jour_semaine,
        num_jour_semaine,
        ROUND(AVG(annulations), 2) as annulations_moyennes,
        ROUND(AVG(confirmations), 2) as confirmations_moyennes,
        ROUND(AVG(revenus_perdus), 2) as revenus_perdus_moyens,
        ROUND(
          (SUM(annulations) * 100.0 / NULLIF(SUM(total_reservations), 0)), 2
        ) as taux_annulation_jour
      FROM stats_journalieres
      GROUP BY jour_semaine, num_jour_semaine
      ORDER BY num_jour_semaine
    `);

    const statsGlobales = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as total_revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_global
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
    `);

    res.status(200).json({
      success: true,
      data: {
        analyse_journaliere: result.rows,
        statistiques_globales: statsGlobales.rows[0] || {}
      }
    });

  } catch (error) {
    console.error('❌ Erreur temporelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 8: PRÉVISIONS ANNULATIONS
// ============================================
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    // Taux d'annulation historiques par jour
    const historiqueParJour = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_semaine,
        COUNT(*) as total_reservations_historique,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_historique,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_historique
      FROM reservation 
      WHERE datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE - INTERVAL '1 day'
      GROUP BY EXTRACT(DOW FROM datereservation)
    `);

    // Réservations futures
    const reservationsFutures = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as num_jour_semaine,
        COUNT(*) as reservations_prevues,
        COALESCE(SUM(tarif), 0) as revenus_prevus
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `);

    // Construire les prévisions
    const tauxParJour = {};
    historiqueParJour.rows.forEach(h => {
      tauxParJour[h.jour_semaine] = parseFloat(h.taux_annulation_historique || 10);
    });

    const previsionsParJour = reservationsFutures.rows.map(jour => {
      const taux = tauxParJour[jour.num_jour_semaine] || 10;
      const annulationsPrevues = Math.round(jour.reservations_prevues * (taux / 100));
      const revenusRisque = Math.round(jour.revenus_prevus * (taux / 100));
      
      let niveauRisque = 'Faible';
      if (taux > 20) niveauRisque = 'Élevé';
      else if (taux > 10) niveauRisque = 'Modéré';
      
      return {
        date: jour.datereservation,
        jour_semaine: jour.jour_semaine.trim(),
        reservations_prevues: parseInt(jour.reservations_prevues),
        revenus_prevus: parseFloat(jour.revenus_prevus),
        taux_annulation_historique: taux,
        annulations_prevues: annulationsPrevues,
        revenus_risque_perte: revenusRisque,
        niveau_risque: niveauRisque
      };
    });

    const statsGlobales = {
      reservations_prevues_total: previsionsParJour.reduce((acc, j) => acc + j.reservations_prevues, 0),
      revenus_prevus_total: previsionsParJour.reduce((acc, j) => acc + j.revenus_prevus, 0),
      annulations_prevues_total: previsionsParJour.reduce((acc, j) => acc + j.annulations_prevues, 0),
      revenus_risque_total: previsionsParJour.reduce((acc, j) => acc + j.revenus_risque_perte, 0)
    };

    const tauxMoyen = statsGlobales.reservations_prevues_total > 0 
      ? (statsGlobales.annulations_prevues_total / statsGlobales.reservations_prevues_total) * 100
      : 0;

    let niveauGlobal = 'Faible';
    if (tauxMoyen > 20) niveauGlobal = 'Élevé';
    else if (tauxMoyen > 10) niveauGlobal = 'Modéré';

    res.status(200).json({
      success: true,
      data: {
        previsions_globales: {
          ...statsGlobales,
          taux_annulation_moyen_prevu: Math.round(tauxMoyen * 100) / 100,
          niveau_risque_global: niveauGlobal,
          periode_analyse: parseInt(periode)
        },
        previsions_par_jour: previsionsParJour,
        jours_haut_risque: previsionsParJour.filter(j => j.niveau_risque === 'Élevé')
      }
    });

  } catch (error) {
    console.error('❌ Erreur previsions:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 9: DATES ANNULATION PAR TERRAIN
// ============================================
router.get('/dates-annulation-terrain/:terrainId', async (req, res) => {
  try {
    const { terrainId } = req.params;
    
    const result = await db.query(`
      SELECT 
        TO_CHAR(datereservation, 'YYYY-MM-DD') as date_annulation,
        TO_CHAR(datereservation, 'HH24:MI') as heure,
        tarif,
        COALESCE(nomclient, 'Client inconnu') as client,
        statut
      FROM reservation 
      WHERE numeroterrain = $1 
        AND statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY datereservation DESC
      LIMIT 20
    `, [terrainId]);

    res.status(200).json({
      success: true,
      data: result.rows,
      terrain_id: terrainId
    });

  } catch (error) {
    console.error('❌ Erreur dates terrain:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 10: SYNTHÈSE ANNULATIONS
// ============================================
router.get('/synthese-annulations', async (req, res) => {
  try {
    const [
      statsMois,
      topTerrains,
      evolutionMensuelle,
      analyseRecent
    ] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_mois,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_mois
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      db.query(`
        SELECT 
          numeroterrain,
          COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '3 months'
        GROUP BY numeroterrain, nomterrain
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY annulations DESC
        LIMIT 5
      `),
      
      db.query(`
        WITH mois_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '5 months',
            CURRENT_DATE,
            '1 month'::interval
          )::date as mois
        )
        SELECT 
          TO_CHAR(ms.mois, 'Mon YYYY') as periode,
          COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(r.numeroreservations), 0)
            ), 2
          ) as taux_annulation
        FROM mois_series ms
        LEFT JOIN reservation r ON DATE_TRUNC('month', r.datereservation) = ms.mois
        GROUP BY ms.mois
        ORDER BY ms.mois ASC
      `),
      
      db.query(`
        SELECT 
          TO_CHAR(datereservation, 'DD/MM') as date_jour,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `)
    ]);

    res.status(200).json({
      success: true,
      data: {
        stats_mois: statsMois.rows[0] || {},
        top_terrains_annulations: topTerrains.rows,
        evolution_6_mois: evolutionMensuelle.rows,
        analyse_7_jours: analyseRecent.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur synthese:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 11: STATS GLOBALES
// ============================================
router.get('/stats-globales', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
        COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as total_attente,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_annulation_global
      FROM reservation
    `);

    res.status(200).json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur stats globales:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 12: RÉPARTITION PAR STATUT
// ============================================
router.get('/repartition-statuts', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        statut, 
        COUNT(*) as nombre,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM reservation), 2) as pourcentage
      FROM reservation 
      GROUP BY statut
      ORDER BY nombre DESC
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur repartition:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 13: TOP CLIENTS NUISIBLES
// ============================================
router.get('/top-clients-nuisibles', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COALESCE(nomclient, 'Client inconnu') as nomclient,
        COALESCE(prenom, '') as prenom,
        COALESCE(email, 'Non renseigné') as email,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes
      FROM reservation
      GROUP BY nomclient, prenom, email
      HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
      ORDER BY annulations DESC, taux_annulation DESC
      LIMIT 20
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur top clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 14: TOP TERRAINS AFFECTÉS
// ============================================
router.get('/top-terrains-affectes', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
        COALESCE(typeterrain, 'Standard') as typeterrain,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus
      FROM reservation
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY annulations DESC, taux_annulation DESC
      LIMIT 10
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur top terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 15: ANNULATIONS PAR MOIS
// ============================================
router.get('/annulations-par-mois', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datereservation) as annee,
        EXTRACT(MONTH FROM datereservation) as mois,
        TO_CHAR(datereservation, 'Month YYYY') as mois_nom,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes_mensuelles
      FROM reservation
      GROUP BY EXTRACT(YEAR FROM datereservation), EXTRACT(MONTH FROM datereservation), TO_CHAR(datereservation, 'Month YYYY')
      ORDER BY annee DESC, mois DESC
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur annulations par mois:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 16: ANNULATIONS PAR JOUR
// ============================================
router.get('/annulations-par-jour', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as numero_jour,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes
      FROM reservation
      GROUP BY TO_CHAR(datereservation, 'Day'), EXTRACT(DOW FROM datereservation)
      ORDER BY numero_jour
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur annulations par jour:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 17: PERTES FINANCIÈRES
// ============================================
router.get('/pertes-financieres', async (req, res) => {
  try {
    const global = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as pertes_totales,
        COUNT(*) as nombre_annulations,
        ROUND(AVG(tarif), 2) as perte_moyenne,
        MIN(tarif) as perte_minimum,
        MAX(tarif) as perte_maximum
      FROM reservation
      WHERE statut = 'annulée'
    `);

    const parPeriode = await db.query(`
      SELECT 
        CASE 
          WHEN datereservation >= CURRENT_DATE - INTERVAL '7 days' THEN '7_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '30 days' THEN '30_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '90 days' THEN '90_derniers_jours'
          ELSE 'plus_ancien'
        END as periode,
        COALESCE(SUM(tarif), 0) as pertes,
        COUNT(*) as nombre
      FROM reservation
      WHERE statut = 'annulée'
      GROUP BY 
        CASE 
          WHEN datereservation >= CURRENT_DATE - INTERVAL '7 days' THEN '7_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '30 days' THEN '30_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '90 days' THEN '90_derniers_jours'
          ELSE 'plus_ancien'
        END
    `);

    res.status(200).json({
      success: true,
      data: {
        global: global.rows[0] || {},
        analyse_periode: parPeriode.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur pertes financieres:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 18: CLIENTS À RISQUE
// ============================================
router.get('/clients-risque', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COALESCE(nomclient, 'Client inconnu') as nomclient,
        COALESCE(prenom, '') as prenom,
        COALESCE(email, 'Non renseigné') as email,
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes,
        CASE 
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 50 THEN 'CRITIQUE'
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 25 THEN 'MODÉRÉ'
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 10 THEN 'FAIBLE'
          ELSE 'FIABLE' 
        END as niveau_risque
      FROM reservation
      GROUP BY nomclient, prenom, email
      HAVING COUNT(*) >= 2
      ORDER BY taux_annulation DESC, total_annulations DESC
      LIMIT 20
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur clients risque:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 19: CLASSIFICATION CLIENTS
// ============================================
router.get('/classification-clients', async (req, res) => {
  try {
    const { periode = '6 months' } = req.query;
    
    const result = await db.query(`
      WITH stats_clients AS (
        SELECT 
          COALESCE(nomclient, 'Client inconnu') as nomclient,
          COALESCE(prenom, '') as prenom,
          COALESCE(email, 'Non renseigné') as email,
          COALESCE(telephone, 'Non renseigné') as telephone,
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
          COUNT(CASE WHEN statut = 'annulée' AND datereservation > CURRENT_DATE THEN 1 END) as annulations_futures,
          COUNT(CASE WHEN statut = 'annulée' AND datereservation < CURRENT_DATE THEN 1 END) as annulations_passees,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes_causees,
          COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as montant_generes,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation,
          MAX(CASE WHEN statut = 'annulée' THEN datereservation END) as derniere_annulation
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode}'
        GROUP BY nomclient, prenom, email, telephone
        HAVING COUNT(*) >= 2
      ),
      classification AS (
        SELECT 
          *,
          CASE 
            WHEN taux_annulation >= 50 OR total_annulations >= 5 THEN 'Critique'
            WHEN taux_annulation >= 25 OR total_annulations >= 3 THEN 'Modérée'
            WHEN taux_annulation >= 10 OR total_annulations >= 1 THEN 'Faible'
            ELSE 'Fiable'
          END as niveau_nuisance,
          LEAST(100, (
            (taux_annulation * 0.4) + 
            (LEAST(total_annulations, 20) * 3) +
            ((montant_pertes_causees / NULLIF(montant_generes, 1)) * 30)
          )) as score_nuisance,
          CASE 
            WHEN taux_annulation >= 50 THEN 'Taux d\'annulation élevé'
            WHEN total_annulations >= 5 THEN 'Nombre d\'annulations important'
            WHEN taux_annulation >= 25 THEN 'Taux d\'annulation modéré'
            ELSE 'Comportement normal'
          END as raison_classification
        FROM stats_clients
      )
      SELECT 
        *,
        CASE niveau_nuisance
          WHEN 'Critique' THEN 'Caution obligatoire recommandée'
          WHEN 'Modérée' THEN 'Surveillance renforcée'
          WHEN 'Faible' THEN 'Relances préventives'
          ELSE 'Aucune action particulière'
        END as recommandation,
        ROUND(montant_generes - montant_pertes_causees, 2) as impact_financier_net
      FROM classification
      ORDER BY 
        CASE niveau_nuisance
          WHEN 'Critique' THEN 1
          WHEN 'Modérée' THEN 2
          WHEN 'Faible' THEN 3
          ELSE 4
        END,
        score_nuisance DESC
    `);

    const repartition = {
      critique: result.rows.filter(r => r.niveau_nuisance === 'Critique').length,
      moderee: result.rows.filter(r => r.niveau_nuisance === 'Modérée').length,
      faible: result.rows.filter(r => r.niveau_nuisance === 'Faible').length,
      fiable: result.rows.filter(r => r.niveau_nuisance === 'Fiable').length
    };

    res.status(200).json({
      success: true,
      data: {
        classification_clients: result.rows,
        statistiques: {
          total_clients_analyses: result.rows.length,
          repartition_categories: repartition
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur classification:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 20: ANALYSE COMPORTEMENTALE
// ============================================
router.get('/analyse-comportementale', async (req, res) => {
  try {
    const result = await db.query(`
      WITH comportements AS (
        SELECT 
          COALESCE(nomclient, 'Client inconnu') as nomclient,
          COALESCE(prenom, '') as prenom,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            AND EXTRACT(HOUR FROM datereservation) BETWEEN 18 AND 23 
            THEN 1 
          END) as annulations_soir,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            AND EXTRACT(DOW FROM datereservation) IN (0, 6) 
            THEN 1 
          END) as annulations_weekend,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'
            THEN 1 
          END) as annulations_derniere_minute,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            THEN 1 
          END) as total_annulations,
          COUNT(DISTINCT DATE_TRUNC('week', datereservation)) as semaines_avec_annulations
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY nomclient, prenom
      )
      SELECT 
        *,
        CASE 
          WHEN annulations_soir >= 3 OR annulations_weekend >= 3 THEN 'Pattern soir/weekend'
          WHEN annulations_derniere_minute >= 2 THEN 'Annulations impulsives'
          WHEN semaines_avec_annulations >= 4 THEN 'Récidiviste chronique'
          ELSE 'Pattern normal'
        END as pattern_comportemental
      FROM comportements
      WHERE total_annulations >= 2
      ORDER BY total_annulations DESC
      LIMIT 50
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur comportementale:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 21: IMPACT FINANCIER CLIENTS
// ============================================
router.get('/impact-financier-clients', async (req, res) => {
  try {
    const result = await db.query(`
      WITH financier AS (
        SELECT 
          COALESCE(nomclient, 'Client inconnu') as nomclient,
          COALESCE(prenom, '') as prenom,
          COALESCE(email, 'Non renseigné') as email,
          COUNT(*) as total_resa,
          SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END) as ca_genere,
          SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) as pertes_causees,
          ROUND(
            (SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) * 100.0 / 
            NULLIF(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0)
            ), 2
          ) as ratio_impact
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY nomclient, prenom, email
        HAVING SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) > 0
      )
      SELECT 
        *,
        CASE 
          WHEN ratio_impact > 50 THEN 'Impact majeur'
          WHEN ratio_impact > 20 THEN 'Impact significatif'
          WHEN ratio_impact > 5 THEN 'Impact modéré'
          ELSE 'Impact mineur'
        END as niveau_impact,
        ca_genere - pertes_causees as marge_nette
      FROM financier
      ORDER BY ratio_impact DESC, pertes_causees DESC
      LIMIT 20
    `);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur impact financier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 22: ALERTES COMPORTEMENT
// ============================================
router.get('/alertes-comportement', async (req, res) => {
  try {
    const alertes = await db.query(`
      WITH dernieres_activites AS (
        SELECT 
          COALESCE(nomclient, 'Client inconnu') as nomclient,
          COALESCE(prenom, '') as prenom,
          COALESCE(email, 'Non renseigné') as email,
          COALESCE(telephone, 'Non renseigné') as telephone,
          datereservation,
          tarif,
          CASE 
            WHEN COUNT(*) OVER (PARTITION BY nomclient, prenom, DATE(datereservation)) >= 3 
            AND statut = 'annulée' THEN 'Multi-annulations journalières'
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) OVER (PARTITION BY nomclient, prenom) >= 4
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days' THEN 'Pattern récurrent détecté'
            ELSE NULL
          END as type_alerte
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days'
          AND statut = 'annulée'
      )
      SELECT DISTINCT
        nomclient || ' ' || prenom as nomclient,
        email,
        telephone,
        type_alerte,
        COUNT(*) as nombre_incidents,
        MAX(datereservation) as dernier_incident,
        SUM(tarif) as impact_financier
      FROM dernieres_activites
      WHERE type_alerte IS NOT NULL
      GROUP BY nomclient, prenom, email, telephone, type_alerte
      ORDER BY dernier_incident DESC, impact_financier DESC
    `);

    res.status(200).json({
      success: true,
      alertes: alertes.rows,
      resume: {
        total_alertes: alertes.rows.length
      }
    });

  } catch (error) {
    console.error('❌ Erreur alertes:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 23: PRÉDICTION RISQUES CLIENTS
// ============================================
router.get('/prediction-risques-clients', async (req, res) => {
  try {
    const result = await db.query(`
      WITH historique_client AS (
        SELECT 
          COALESCE(nomclient, 'Client inconnu') as nomclient,
          COALESCE(prenom, '') as prenom,
          COALESCE(email, 'Non renseigné') as email,
          COUNT(*) as total_resa,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          CASE 
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) >= 3 THEN 'Élevé'
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) = 2 THEN 'Moyen'
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) = 1 THEN 'Faible'
            ELSE 'Très faible'
          END as risque_futur
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY nomclient, prenom, email
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
      )
      SELECT 
        *,
        CASE risque_futur
          WHEN 'Élevé' THEN 70 + (RANDOM() * 20)::int
          WHEN 'Moyen' THEN 40 + (RANDOM() * 20)::int
          WHEN 'Faible' THEN 15 + (RANDOM() * 15)::int
          ELSE (RANDOM() * 10)::int
        END as probabilite_annulation,
        CASE risque_futur
          WHEN 'Élevé' THEN 'Caution obligatoire'
          WHEN 'Moyen' THEN 'Rappel SMS 24h avant'
          WHEN 'Faible' THEN 'Relance email standard'
          ELSE 'Aucune action'
        END as action_preventive
      FROM historique_client
      ORDER BY 
        CASE risque_futur
          WHEN 'Élevé' THEN 1
          WHEN 'Moyen' THEN 2
          WHEN 'Faible' THEN 3
          ELSE 4
        END,
        total_annulations DESC
      LIMIT 20
    `);

    res.status(200).json({
      success: true,
      predictions: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur prediction:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 24: CORRÉLATION PROFIL CLIENTS
// ============================================
router.get('/correlation-profil-clients', async (req, res) => {
  try {
    const result = await db.query(`
      WITH profils AS (
        SELECT 
          CASE 
            WHEN AVG(tarif) < 50 THEN 'Petit budget'
            WHEN AVG(tarif) < 150 THEN 'Budget moyen'
            ELSE 'Gros budget'
          END as categorie_budget,
          CASE 
            WHEN COUNT(*) / 6 > 4 THEN 'Très fréquent'
            WHEN COUNT(*) / 6 > 2 THEN 'Fréquent'
            ELSE 'Occasionnel'
          END as frequence_reservation,
          MODE() WITHIN GROUP (ORDER BY typeterrain) as terrain_prefere,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          COUNT(*) as total_reservations,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*)
            ), 2
          ) as taux_annulation
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY nomclient
      )
      SELECT 
        categorie_budget,
        frequence_reservation,
        terrain_prefere,
        COUNT(*) as nombre_clients,
        SUM(total_annulations) as annulations_total,
        ROUND(AVG(taux_annulation), 2) as taux_annulation_moyen
      FROM profils
      GROUP BY categorie_budget, frequence_reservation, terrain_prefere
      ORDER BY taux_annulation_moyen DESC
      LIMIT 20
    `);

    res.status(200).json({
      success: true,
      correlations: result.rows
    });

  } catch (error) {
    console.error('❌ Erreur correlation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 25: STATISTIQUES AVANCÉES
// ============================================
router.get('/statistiques-avancees', async (req, res) => {
  try {
    const result = await db.query(`
      WITH stats_globales AS (
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes,
          COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as revenus
        FROM reservation
      ),
      stats_clients AS (
        SELECT 
          COUNT(DISTINCT COALESCE(nomclient, '') || COALESCE(prenom, '')) as clients_actifs,
          COUNT(DISTINCT CASE WHEN statut = 'annulée' THEN COALESCE(nomclient, '') || COALESCE(prenom, '') END) as clients_annulateurs
        FROM reservation
      ),
      stats_quotidiennes AS (
        SELECT 
          AVG(annulations_par_jour) as moy_annulations_quotidiennes
        FROM (
          SELECT 
            DATE(datereservation) as jour,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_par_jour
          FROM reservation
          GROUP BY DATE(datereservation)
        ) subq
      )
      SELECT 
        sg.*,
        sc.*,
        ROUND(sq.moy_annulations_quotidiennes, 2) as moy_annulations_quotidiennes,
        ROUND(sg.annulations * 100.0 / NULLIF(sg.total, 0), 2) as taux_annulation,
        ROUND(sg.pertes * 100.0 / NULLIF(sg.revenus + sg.pertes, 0), 2) as impact_financier,
        ROUND(sg.pertes / NULLIF(sg.annulations, 0), 2) as cout_moyen_annulation
      FROM stats_globales sg
      CROSS JOIN stats_clients sc
      CROSS JOIN stats_quotidiennes sq
    `);

    res.status(200).json({
      success: true,
      data: result.rows[0] || {}
    });

  } catch (error) {
    console.error('❌ Erreur stats avancees:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE 26: EXPORT DONNÉES
// ============================================
router.get('/export-donnees', async (req, res) => {
  try {
    const { type = 'complet' } = req.query;

    let donnees = {};

    if (type === 'complet' || type === 'annulations') {
      const annulations = await db.query(`
        SELECT 
          numeroreservations,
          COALESCE(nomclient, 'Client inconnu') as nomclient,
          COALESCE(prenom, '') as prenom,
          email,
          telephone,
          datereservation,
          tarif,
          numeroterrain,
          COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
          typeterrain,
          statut
        FROM reservation
        WHERE statut = 'annulée'
        ORDER BY datereservation DESC
      `);
      donnees.annulations = annulations.rows;
    }

    if (type === 'complet' || type === 'clients') {
      const clients = await db.query(`
        SELECT 
          COALESCE(nomclient, 'Client inconnu') as nomclient,
          COALESCE(prenom, '') as prenom,
          email,
          telephone,
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes
        FROM reservation
        GROUP BY nomclient, prenom, email, telephone
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY total_annulations DESC
      `);
      donnees.clients = clients.rows;
    }

    if (type === 'complet' || type === 'terrains') {
      const terrains = await db.query(`
        SELECT 
          numeroterrain,
          COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
          typeterrain,
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus
        FROM reservation
        GROUP BY numeroterrain, nomterrain, typeterrain
        ORDER BY annulations DESC
      `);
      donnees.terrains = terrains.rows;
    }

    res.status(200).json({
      success: true,
      data: donnees,
      export_date: new Date().toISOString(),
      type_export: type
    });

  } catch (error) {
    console.error('❌ Erreur export:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
});

// ============================================
// ROUTE TEST
// ============================================
router.get('/test', async (req, res) => {
  try {
    const testQuery = await db.query('SELECT COUNT(*) as total FROM reservation');
    
    res.status(200).json({
      success: true,
      message: '✅ API STATS fonctionne parfaitement !',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        total_reservations: testQuery.rows[0]?.total || 0
      },
      routes_disponibles: [
        '/dashboard-annulations',
        '/evolution-annulations',
        '/terrains-annulations',
        '/stats-periodes-annulations',
        '/annulations-recentes',
        '/annulations-futures',
        '/analyse-temporelle-annulations',
        '/previsions-annulations',
        '/dates-annulation-terrain/:terrainId',
        '/synthese-annulations',
        '/stats-globales',
        '/repartition-statuts',
        '/top-clients-nuisibles',
        '/top-terrains-affectes',
        '/annulations-par-mois',
        '/annulations-par-jour',
        '/pertes-financieres',
        '/clients-risque',
        '/classification-clients',
        '/analyse-comportementale',
        '/impact-financier-clients',
        '/alertes-comportement',
        '/prediction-risques-clients',
        '/correlation-profil-clients',
        '/statistiques-avancees',
        '/export-donnees',
        '/test'
      ]
    });

  } catch (error) {
    res.status(200).json({
      success: true,
      message: '⚠️ API STATS fonctionne (problème BDD)',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: error.message
      }
    });
  }
});

// Fonction utilitaire
function calculatePercentageChange(current, previous) {
  if (previous === 0 || previous === null || previous === undefined) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

export default router;