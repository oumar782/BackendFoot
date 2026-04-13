import express from 'express';
import db from '../db.js';

const router = express.Router();

// 🔍 Analyse de l'occupation des créneaux par période
router.get('/occupation-analyse', async (req, res) => {
  try {
    const { periode = '30jours', typeTerrain = null } = req.query;

    let whereClause = `WHERE c.statut IN ('réservé', 'occupé')`;
    let params = [];

    if (periode === '30jours') {
      whereClause += ` AND c.datecreneaux >= CURRENT_DATE - INTERVAL '30 days'`;
    } else if (periode === '7jours') {
      whereClause += ` AND c.datecreneaux >= CURRENT_DATE - INTERVAL '7 days'`;
    } else if (periode === 'aujourdhui') {
      whereClause += ` AND c.datecreneaux = CURRENT_DATE`;
    }

    if (typeTerrain) {
      whereClause += ` AND c.typeTerrain = $${params.length + 1}`;
      params.push(typeTerrain);
    }

    // 1. Taux d'occupation global par type de terrain
    const occupationGlobale = await db.query(`
      WITH total_creneaux AS (
        SELECT 
          typeTerrain,
          COUNT(*) as total_creneaux_disponibles
        FROM creneaux c
        ${whereClause}
        GROUP BY typeTerrain
      ),
      creneaux_occupes AS (
        SELECT 
          typeTerrain,
          COUNT(*) as creneaux_occupes,
          COALESCE(SUM(tarif), 0) as revenu_potentiel
        FROM creneaux c
        ${whereClause.replace("c.statut IN ('réservé', 'occupé')", "statut IN ('réservé', 'occupé')")}
        GROUP BY typeTerrain
      )
      SELECT 
        tc.typeTerrain,
        tc.total_creneaux_disponibles,
        COALESCE(co.creneaux_occupes, 0) as creneaux_occupes,
        COALESCE(co.revenu_potentiel, 0) as revenu_genere,
        ROUND(
          CASE 
            WHEN tc.total_creneaux_disponibles > 0 
            THEN COALESCE(co.creneaux_occupes, 0) * 100.0 / tc.total_creneaux_disponibles
            ELSE 0
          END::numeric, 2
        ) as taux_occupation_pct
      FROM total_creneaux tc
      LEFT JOIN creneaux_occupes co ON tc.typeTerrain = co.typeTerrain
    `, params);

    // 2. Analyse des patterns horaires
    const patternsHoraires = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heure) as heure_debut,
        EXTRACT(HOUR FROM heurefin) as heure_fin,
        COUNT(*) as total_creneaux,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
        COUNT(*) FILTER (WHERE statut = 'disponible') as creneaux_disponibles,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(
          CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END::numeric, 2
        ) as taux_occupation_heure,
        ROUND(AVG(tarif) FILTER (WHERE statut IN ('réservé', 'occupé'))::numeric, 2) as tarif_moyen_heure
      FROM creneaux
      ${whereClause.replace(/c\./g, '')}
      GROUP BY EXTRACT(HOUR FROM heure), EXTRACT(HOUR FROM heurefin)
      ORDER BY taux_occupation_heure DESC
    `, params);

    // 3. Analyse des patterns hebdomadaires
    const patternsHebdomadaires = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datecreneaux) as jour_semaine,
        TO_CHAR(datecreneaux, 'Day') as nom_jour,
        COUNT(*) as total_creneaux_jour,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes_jour,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_jour,
        ROUND(
          CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END::numeric, 2
        ) as taux_occupation_jour,
        ROUND(AVG(tarif) FILTER (WHERE statut IN ('réservé', 'occupé'))::numeric, 2) as tarif_moyen_jour
      FROM creneaux
      ${whereClause.replace(/c\./g, '')}
      GROUP BY EXTRACT(DOW FROM datecreneaux)
      ORDER BY taux_occupation_jour DESC
    `, params);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        occupation_globale: occupationGlobale.rows,
        patterns_horaires: patternsHoraires.rows,
        patterns_hebdomadaires: patternsHebdomadaires.rows
      }
    });

  } catch (error) {
    console.error('Erreur occupation-analyse:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse d\'occupation',
      error: error.message
    });
  }
});

// 💰 Analyse de la performance tarifaire
router.get('/performance-tarifaire', async (req, res) => {
  try {
    const { periode = '30jours', typeTerrain = null } = req.query;

    let whereClause = `WHERE 1=1`;
    let params = [];

    if (periode === '30jours') {
      whereClause += ` AND datecreneaux >= CURRENT_DATE - INTERVAL '30 days'`;
    }

    if (typeTerrain) {
      whereClause += ` AND typeTerrain = $${params.length + 1}`;
      params.push(typeTerrain);
    }

    // 1. Performance par segment tarifaire
    const performanceTarifs = await db.query(`
      WITH segments_tarifaires AS (
        SELECT 
          CASE 
            WHEN tarif < 20 THEN 'BAS (<20€)'
            WHEN tarif BETWEEN 20 AND 40 THEN 'MOYEN (20-40€)'
            WHEN tarif BETWEEN 40 AND 60 THEN 'ÉLEVÉ (40-60€)'
            ELSE 'TRÈS ÉLEVÉ (>60€)'
          END as segment_tarifaire,
          COUNT(*) as total_creneaux,
          COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
          COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
          COUNT(DISTINCT nomterrain) as terrains_concernes,
          ROUND(
            CASE 
              WHEN COUNT(*) > 0 
              THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
              ELSE 0
            END::numeric, 2
          ) as taux_occupation
        FROM creneaux
        ${whereClause}
        GROUP BY 
          CASE 
            WHEN tarif < 20 THEN 'BAS (<20€)'
            WHEN tarif BETWEEN 20 AND 40 THEN 'MOYEN (20-40€)'
            WHEN tarif BETWEEN 40 AND 60 THEN 'ÉLEVÉ (40-60€)'
            ELSE 'TRÈS ÉLEVÉ (>60€)'
          END
      )
      SELECT 
        segment_tarifaire, total_creneaux, creneaux_occupes, revenu_total, terrains_concernes,
        taux_occupation,
        ROUND(
          CASE 
            WHEN creneaux_occupes > 0 
            THEN revenu_total / creneaux_occupes
            ELSE 0
          END::numeric, 2
        ) as tarif_moyen_effectif,
        ROUND((revenu_total * 100.0 / NULLIF(SUM(revenu_total) OVER(), 0))::numeric, 2) as part_revenu_total
      FROM segments_tarifaires
      ORDER BY revenu_total DESC
    `, params);

    // 2. Analyse par terrain
    const tarifsParTerrain = await db.query(`
      SELECT 
        nomterrain,
        typeTerrain,
        COUNT(*) as total_creneaux,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(AVG(tarif)::numeric, 2) as tarif_moyen,
        MIN(tarif) as tarif_min, 
        MAX(tarif) as tarif_max,
        ROUND(
          CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END::numeric, 2
        ) as taux_occupation,
        ROUND(
          CASE 
            WHEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) > 0 
            THEN SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')) / COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé'))
            ELSE 0
          END::numeric, 2
        ) as tarif_moyen_vendu
      FROM creneaux
      ${whereClause}
      GROUP BY nomterrain, typeTerrain
      ORDER BY revenu_total DESC
    `, params);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        performance_tarifs: performanceTarifs.rows,
        tarifs_par_terrain: tarifsParTerrain.rows
      }
    });

  } catch (error) {
    console.error('Erreur performance-tarifaire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse performance tarifaire',
      error: error.message
    });
  }
});

// 🎯 Analyse des créneaux stratégiques
router.get('/creneaux-strategiques', async (req, res) => {
  try {
    const { horizon = 'semaine', typeTerrain = null } = req.query;

    let whereClause = `WHERE 1=1`;
    
    if (horizon === 'semaine') {
      whereClause += ` AND datecreneaux <= CURRENT_DATE + INTERVAL '7 days' AND datecreneaux >= CURRENT_DATE`;
    } else if (horizon === 'mois') {
      whereClause += ` AND datecreneaux <= CURRENT_DATE + INTERVAL '30 days' AND datecreneaux >= CURRENT_DATE`;
    }

    if (typeTerrain) {
      whereClause += ` AND typeTerrain = '${typeTerrain}'`;
    }

    // 1. Créneaux à haute valeur
    const creneauxValeur = await db.query(`
      SELECT 
        idcreneaux,
        datecreneaux,
        heure,
        heurefin,
        nomterrain,
        typeTerrain,
        tarif,
        statut,
        CASE 
          WHEN EXTRACT(DOW FROM datecreneaux) IN (5, 6) THEN 'WEEK-END'
          ELSE 'SEMAINE'
        END as type_jour,
        CASE 
          WHEN EXTRACT(HOUR FROM heure) BETWEEN 18 AND 22 THEN 'CRÉNEAU PRIME'
          WHEN EXTRACT(HOUR FROM heure) BETWEEN 12 AND 14 THEN 'CRÉNEAU MIDI'
          ELSE 'CRÉNEAU STANDARD'
        END as type_creneau,
        ROUND(tarif * 1.5::numeric, 2) as valeur_estimee
      FROM creneaux
      ${whereClause}
      ORDER BY tarif DESC
      LIMIT 25
    `);

    // 2. Analyse des créneaux à risque
    const creneauxRisque = await db.query(`
      WITH performance_similaire AS (
        SELECT 
          typeTerrain,
          EXTRACT(DOW FROM datecreneaux) as jour_semaine,
          EXTRACT(HOUR FROM heure) as heure_debut,
          COUNT(*) as total_creneaux_similaires,
          COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes_similaires,
          ROUND(
            (COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 2
          ) as taux_occupation_habituel
        FROM creneaux
        WHERE datecreneaux >= CURRENT_DATE - INTERVAL '30 days' AND datecreneaux < CURRENT_DATE
        GROUP BY typeTerrain, EXTRACT(DOW FROM datecreneaux), EXTRACT(HOUR FROM heure)
      )
      SELECT 
        c.idcreneaux,
        c.datecreneaux,
        c.heure,
        c.heurefin,
        c.nomterrain,
        c.typeTerrain,
        c.tarif,
        c.statut,
        ps.taux_occupation_habituel,
        CASE 
          WHEN ps.taux_occupation_habituel >= 80 THEN 'ANOMALIE DISPONIBILITÉ'
          WHEN ps.taux_occupation_habituel >= 60 THEN 'SURVEILLER'
          ELSE 'RISQUE FAIBLE'
        END as niveau_risque,
        ROUND((c.tarif * (ps.taux_occupation_habituel / 100.0))::numeric, 2) as revenu_attendu_estime
      FROM creneaux c
      JOIN performance_similaire ps ON c.typeTerrain = ps.typeTerrain
        AND EXTRACT(DOW FROM c.datecreneaux) = ps.jour_semaine
        AND EXTRACT(HOUR FROM c.heure) = ps.heure_debut
      ${whereClause}
      WHERE c.statut = 'disponible'
        AND ps.taux_occupation_habituel >= 60
      ORDER BY ps.taux_occupation_habituel DESC, c.tarif DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      horizon_analyse: horizon,
      date_generation: new Date().toISOString(),
      analyses: {
        creneaux_valeur: creneauxValeur.rows,
        creneaux_risque: creneauxRisque.rows
      }
    });

  } catch (error) {
    console.error('Erreur creneaux-strategiques:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse créneaux stratégiques',
      error: error.message
    });
  }
});

// 📅 Analyse mensuelle des créneaux
router.get('/analyse-mensuelle', async (req, res) => {
  try {
    const { annee = null, typeTerrain = null } = req.query;

    let whereClause = `WHERE 1=1`;
    let params = [];

    if (annee) {
      whereClause += ` AND EXTRACT(YEAR FROM datecreneaux) = $${params.length + 1}`;
      params.push(annee);
    }

    if (typeTerrain) {
      whereClause += ` AND typeTerrain = $${params.length + 1}`;
      params.push(typeTerrain);
    }

    // Vue d'ensemble mensuelle
    const vueMensuelle = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datecreneaux) as annee,
        EXTRACT(MONTH FROM datecreneaux) as mois,
        TO_CHAR(datecreneaux, 'Month') as nom_mois,
        COUNT(*) as total_creneaux,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
        COUNT(*) FILTER (WHERE statut = 'disponible') as creneaux_disponibles,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(
          CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END::numeric, 2
        ) as taux_occupation
      FROM creneaux
      ${whereClause}
      GROUP BY EXTRACT(YEAR FROM datecreneaux), EXTRACT(MONTH FROM datecreneaux), TO_CHAR(datecreneaux, 'Month')
      ORDER BY annee DESC, mois DESC
    `, params);

    res.json({
      success: true,
      filtres: {
        annee: annee || 'toutes',
        typeTerrain: typeTerrain || 'tous'
      },
      date_generation: new Date().toISOString(),
      analyses: {
        vue_mensuelle: vueMensuelle.rows
      }
    });

  } catch (error) {
    console.error('Erreur analyse-mensuelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse mensuelle des créneaux',
      error: error.message
    });
  }
});

// Route de test pour vérifier que le routeur fonctionne
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: '✅ Routeur creneaux_analyse fonctionne correctement',
    routes_disponibles: [
      '/occupation-analyse',
      '/performance-tarifaire',
      '/creneaux-strategiques',
      '/analyse-mensuelle',
      '/test'
    ]
  });ç
});

export default router;
