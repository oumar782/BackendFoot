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
        ROUND(((CASE 
            WHEN tc.total_creneaux_disponibles > 0 
            THEN COALESCE(co.creneaux_occupes, 0) * 100.0 / tc.total_creneaux_disponibles
            ELSE 0
          END)::NUMERIC), 2) as taux_occupation_pct,
        CASE 
          WHEN tc.total_creneaux_disponibles > 0 
          THEN CASE 
            WHEN (COALESCE(co.creneaux_occupes, 0) * 100.0 / tc.total_creneaux_disponibles) >= 80 THEN 'TRÈS DEMANDÉ'
            WHEN (COALESCE(co.creneaux_occupes, 0) * 100.0 / tc.total_creneaux_disponibles) >= 60 THEN 'DEMANDÉ'
            WHEN (COALESCE(co.creneaux_occupes, 0) * 100.0 / tc.total_creneaux_disponibles) >= 40 THEN 'MODÉRÉMENT DEMANDÉ'
            ELSE 'PEU DEMANDÉ'
          END
          ELSE 'INDÉTERMINÉ'
        END as niveau_demande
      FROM total_creneaux tc
      LEFT JOIN creneaux_occupes co ON tc.typeTerrain = co.typeTerrain
      ORDER BY taux_occupation_pct DESC
    `, params);

    // 2. Analyse horaire
    const patternsHoraires = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heure) as heure_debut,
        EXTRACT(HOUR FROM heurefin) as heure_fin,
        COUNT(*) as total_creneaux,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
        COUNT(*) FILTER (WHERE statut = 'disponible') as creneaux_disponibles,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(((CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END)::NUMERIC), 2) as taux_occupation_heure,
        ROUND((AVG(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')))::NUMERIC, 2) as tarif_moyen_heure
      FROM creneaux
      ${whereClause.replace(/c\./g, '')}
      GROUP BY EXTRACT(HOUR FROM heure), EXTRACT(HOUR FROM heurefin)
      ORDER BY taux_occupation_heure DESC
    `, params);

    // 3. Analyse par jour de la semaine
    const patternsHebdomadaires = await db.query(`
      SELECT 
        CASE 
          WHEN EXTRACT(DOW FROM datecreneaux) = 0 THEN 'Dimanche'
          WHEN EXTRACT(DOW FROM datecreneaux) = 1 THEN 'Lundi'
          WHEN EXTRACT(DOW FROM datecreneaux) = 2 THEN 'Mardi'
          WHEN EXTRACT(DOW FROM datecreneaux) = 3 THEN 'Mercredi'
          WHEN EXTRACT(DOW FROM datecreneaux) = 4 THEN 'Jeudi'
          WHEN EXTRACT(DOW FROM datecreneaux) = 5 THEN 'Vendredi'
          WHEN EXTRACT(DOW FROM datecreneaux) = 6 THEN 'Samedi'
        END as jour_semaine,
        COUNT(*) as total_creneaux_jour,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes_jour,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_jour,
        ROUND(((CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END)::NUMERIC), 2) as taux_occupation_jour,
        ROUND((AVG(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')))::NUMERIC, 2) as tarif_moyen_jour
      FROM creneaux
      ${whereClause.replace(/c\./g, '')}
      GROUP BY EXTRACT(DOW FROM datecreneaux)
      ORDER BY taux_occupation_jour DESC
    `, params);

    // 4. Analyse des créneaux à optimiser
    const creneauxOptimiser = await db.query(`
      WITH performance_creneaux AS (
        SELECT 
          idcreneaux, datecreneaux, heure, heurefin, typeTerrain, nomterrain, tarif, statut,
          CASE WHEN EXTRACT(DOW FROM datecreneaux) IN (5, 6) THEN 'WEEK-END' ELSE 'SEMAINE' END as type_jour,
          CASE 
            WHEN EXTRACT(HOUR FROM heure) BETWEEN 18 AND 22 THEN 'SOIRÉE'
            WHEN EXTRACT(HOUR FROM heure) BETWEEN 12 AND 14 THEN 'MIDI'
            WHEN EXTRACT(HOUR FROM heure) BETWEEN 8 AND 12 THEN 'MATIN'
            ELSE 'NUIT'
          END as periode_journee
        FROM creneaux
        ${whereClause.replace(/c\./g, '').replace("c.statut IN ('réservé', 'occupé')", "statut IN ('réservé', 'occupé')")}
      ),
      stats_par_categorie AS (
        SELECT 
          typeTerrain, type_jour, periode_journee,
          AVG(tarif) as tarif_moyen_categorie,
          COUNT(*) as total_creneaux_categorie,
          COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as occupation_categorie
        FROM performance_creneaux
        GROUP BY typeTerrain, type_jour, periode_journee
      )
      SELECT 
        pc.idcreneaux, pc.datecreneaux, pc.heure, pc.heurefin, pc.typeTerrain, pc.nomterrain,
        pc.tarif, pc.statut, pc.type_jour, pc.periode_journee, sc.tarif_moyen_categorie,
        CASE 
          WHEN pc.tarif > sc.tarif_moyen_categorie * 1.2 AND sc.occupation_categorie < sc.total_creneaux_categorie * 0.5 
          THEN 'TROP CHER - PEU DEMANDÉ'
          WHEN pc.tarif < sc.tarif_moyen_categorie * 0.8 AND sc.occupation_categorie > sc.total_creneaux_categorie * 0.8 
          THEN 'TROP PEU CHER - SUR-DEMANDÉ'
          WHEN sc.occupation_categorie < sc.total_creneaux_categorie * 0.3 
          THEN 'POTENTIEL AMÉLIORATION'
          ELSE 'ÉQUILIBRÉ'
        END as recommandation_optimisation,
        ROUND((((pc.tarif - sc.tarif_moyen_categorie) * 100.0 / NULLIF(sc.tarif_moyen_categorie, 0))::NUMERIC), 2) as ecart_tarif_pct,
        ROUND(((sc.occupation_categorie * 100.0 / NULLIF(sc.total_creneaux_categorie, 0))::NUMERIC), 2) as taux_occupation_categorie
      FROM performance_creneaux pc
      JOIN stats_par_categorie sc ON pc.typeTerrain = sc.typeTerrain 
        AND pc.type_jour = sc.type_jour 
        AND pc.periode_journee = sc.periode_journee
      WHERE pc.statut = 'disponible'
        AND (sc.occupation_categorie < sc.total_creneaux_categorie * 0.5 
             OR pc.tarif > sc.tarif_moyen_categorie * 1.2)
      ORDER BY pc.tarif DESC
      LIMIT 20
    `, params);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        occupation_globale: occupationGlobale.rows,
        patterns_horaires: patternsHoraires.rows,
        patterns_hebdomadaires: patternsHebdomadaires.rows,
        creneaux_optimiser: creneauxOptimiser.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans occupation-analyse:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse d\'occupation des créneaux',
      error: error.message
    });
  }
});

// 📈 Analyse des performances tarifaires
router.get('/performance-tarifaire', async (req, res) => {
  try {
    const { periode = '30jours' } = req.query;
    let whereClause = `WHERE statut IN ('réservé', 'occupé')`;
    
    if (periode === '30jours') {
      whereClause += ` AND datecreneaux >= CURRENT_DATE - INTERVAL '30 days'`;
    } else if (periode === '7jours') {
      whereClause += ` AND datecreneaux >= CURRENT_DATE - INTERVAL '7 days'`;
    }

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
          COUNT(DISTINCT nomterrain) as terrains_concernes
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
        ROUND(((CASE WHEN total_creneaux > 0 THEN creneaux_occupes * 100.0 / total_creneaux ELSE 0 END)::NUMERIC, 2) as taux_occupation,
        ROUND(((CASE WHEN creneaux_occupes > 0 THEN revenu_total / creneaux_occupes ELSE 0 END)::NUMERIC, 2) as tarif_moyen_effectif,
        ROUND((revenu_total * 100.0 / NULLIF(SUM(revenu_total) OVER(), 0))::NUMERIC, 2) as part_revenu_total,
        CASE 
          WHEN (creneaux_occupes * 100.0 / NULLIF(total_creneaux, 0)) >= 80 THEN 'OPTIMAL'
          WHEN (creneaux_occupes * 100.0 / NULLIF(total_creneaux, 0)) >= 60 THEN 'BON'
          WHEN (creneaux_occupes * 100.0 / NULLIF(total_creneaux, 0)) >= 40 THEN 'ACCEPTABLE'
          ELSE 'À AMÉLIORER'
        END as performance_segment
      FROM segments_tarifaires
      ORDER BY revenu_total DESC
    `);

    const tarifsParTerrain = await db.query(`
      SELECT 
        nomterrain, typeTerrain, SurfaceTerrains,
        COUNT(*) as total_creneaux,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(AVG(tarif)::NUMERIC, 2) as tarif_moyen,
        MIN(tarif) as tarif_min, MAX(tarif) as tarif_max,
        ROUND(((CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*) ELSE 0 END)::NUMERIC), 2) as taux_occupation,
        ROUND(((CASE WHEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) > 0 
              THEN SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')) / COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé'))
              ELSE 0 END)::NUMERIC), 2) as tarif_moyen_vendu
      FROM creneaux
      ${whereClause}
      GROUP BY nomterrain, typeTerrain, SurfaceTerrains
      HAVING COUNT(*) >= 5
      ORDER BY revenu_total DESC
    `);

    const recommandationsTarifaires = await db.query(`
      WITH analyse_tarifaire AS (
        SELECT 
          nomterrain, typeTerrain, tarif,
          COUNT(*) OVER (PARTITION BY nomterrain, typeTerrain) as total_creneaux_terrain,
          COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) OVER (PARTITION BY nomterrain, typeTerrain) as occupation_terrain,
          AVG(tarif) OVER (PARTITION BY typeTerrain) as tarif_moyen_type,
          COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) OVER (PARTITION BY typeTerrain) as occupation_type,
          COUNT(*) OVER (PARTITION BY typeTerrain) as total_creneaux_type
        FROM creneaux ${whereClause}
      ),
      recommandations AS (
        SELECT DISTINCT
          nomterrain, typeTerrain, tarif_moyen_type as tarif_reference,
          CASE 
            WHEN (occupation_terrain * 100.0 / NULLIF(total_creneaux_terrain, 0)) > 80 AND tarif > tarif_moyen_type * 1.1
            THEN 'POURRAIT AUGMENTER TARIF'
            WHEN (occupation_terrain * 100.0 / NULLIF(total_creneaux_terrain, 0)) < 40 AND tarif > tarif_moyen_type * 0.9
            THEN 'DEVRAIT RÉDUIRE TARIF'
            WHEN (occupation_terrain * 100.0 / NULLIF(total_creneaux_terrain, 0)) > 80 AND tarif < tarif_moyen_type * 0.9
            THEN 'OPPORTUNITÉ AUGMENTATION'
            WHEN (occupation_terrain * 100.0 / NULLIF(total_creneaux_terrain, 0)) < 40 AND tarif < tarif_moyen_type * 0.9
            THEN 'TARIF COMPÉTITIF MAIS DEMANDE FAIBLE'
            ELSE 'TARIF ADÉQUAT'
          END as recommandation,
          ROUND(((occupation_terrain * 100.0 / NULLIF(total_creneaux_terrain, 0))::NUMERIC), 2) as taux_occupation_actuel,
          ROUND(((tarif - tarif_moyen_type) * 100.0 / NULLIF(tarif_moyen_type, 0))::NUMERIC, 2) as ecart_tarif_pct
        FROM analyse_tarifaire
        WHERE total_creneaux_terrain >= 3
      )
      SELECT * FROM recommandations
      WHERE recommandation != 'TARIF ADÉQUAT'
      ORDER BY taux_occupation_actuel DESC
      LIMIT 15
    `);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        performance_tarifs: performanceTarifs.rows,
        tarifs_par_terrain: tarifsParTerrain.rows,
        recommandations: recommandationsTarifaires.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans performance-tarifaire:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse de performance tarifaire', error: error.message });
  }
});

// 🎯 Analyse des créneaux stratégiques
router.get('/creneaux-strategiques', async (req, res) => {
  try {
    const { horizon = '7 days' } = req.query;
    let whereClause = `WHERE datecreneaux BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${horizon}'`;

    const creneauxValeur = await db.query(`
      SELECT 
        idcreneaux, datecreneaux, heure, heurefin, typeTerrain, nomterrain, tarif, statut,
        CASE WHEN EXTRACT(DOW FROM datecreneaux) IN (5, 6) THEN 'WEEK-END' ELSE 'SEMAINE' END as contexte_temporel,
        CASE 
          WHEN EXTRACT(HOUR FROM heure) BETWEEN 18 AND 22 THEN 'CRÉNEAU PRIME'
          WHEN EXTRACT(HOUR FROM heure) BETWEEN 12 AND 14 THEN 'CRÉNEAU MIDI'
          WHEN EXTRACT(HOUR FROM heure) BETWEEN 8 AND 12 THEN 'CRÉNEAU MATIN'
          ELSE 'CRÉNEAU NUIT'
        END as periode_strategique,
        CASE 
          WHEN tarif > 50 THEN 'TRÈS HAUTE VALEUR'
          WHEN tarif > 30 THEN 'HAUTE VALEUR'
          WHEN tarif > 20 THEN 'VALEUR MOYENNE'
          ELSE 'VALEUR STANDARD'
        END as categorie_valeur,
        CASE 
          WHEN statut = 'disponible' THEN 'DISPONIBLE MAINTENANT'
          WHEN statut = 'réservé' THEN 'DÉJÀ RÉSERVÉ'
          ELSE 'INDISPONIBLE'
        END as disponibilite
      FROM creneaux ${whereClause}
      ORDER BY 
        CASE WHEN statut = 'disponible' AND tarif > 30 THEN 1 WHEN statut = 'disponible' THEN 2 ELSE 3 END,
        tarif DESC, datecreneaux, heure
      LIMIT 25
    `);

    const creneauxRisque = await db.query(`
      WITH performance_similaire AS (
        SELECT 
          typeTerrain,
          EXTRACT(DOW FROM datecreneaux) as jour_semaine,
          EXTRACT(HOUR FROM heure) as heure_debut,
          COUNT(*) as total_creneaux_similaires,
          COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes_similaires,
          ROUND(((COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / NULLIF(COUNT(*), 0))::NUMERIC), 2) as taux_occupation_habituel
        FROM creneaux
        WHERE datecreneaux >= CURRENT_DATE - INTERVAL '30 days' AND datecreneaux < CURRENT_DATE
        GROUP BY typeTerrain, EXTRACT(DOW FROM datecreneaux), EXTRACT(HOUR FROM heure)
        HAVING COUNT(*) >= 3
      )
      SELECT 
        c.idcreneaux, c.datecreneaux, c.heure, c.heurefin, c.typeTerrain, c.nomterrain, c.tarif,
        ps.taux_occupation_habituel,
        CASE 
          WHEN ps.taux_occupation_habituel >= 80 THEN 'CRÉNEAU TRÈS DEMANDÉ NORMALEMENT'
          WHEN ps.taux_occupation_habituel >= 60 THEN 'CRÉNEAU DEMANDÉ NORMALEMENT'
          WHEN ps.taux_occupation_habituel >= 40 THEN 'CRÉNEAU MODÉRÉMENT DEMANDÉ'
          ELSE 'CRÉNEAU PEU DEMANDÉ HABITUELLEMENT'
        END as profil_habituel,
        CASE 
          WHEN c.tarif > 40 AND ps.taux_occupation_habituel >= 80 THEN 'PERTE REVENUE ÉLEVÉE'
          WHEN c.tarif > 20 AND ps.taux_occupation_habituel >= 60 THEN 'PERTE REVENUE MODÉRÉE'
          WHEN ps.taux_occupation_habituel >= 80 THEN 'ANOMALIE DISPONIBILITÉ'
          ELSE 'SURVEILLER'
        END as niveau_risque,
        ROUND((c.tarif * (ps.taux_occupation_habituel / 100.0))::NUMERIC, 2) as revenu_attendu_estime
      FROM creneaux c
      JOIN performance_similaire ps ON c.typeTerrain = ps.typeTerrain
        AND EXTRACT(DOW FROM c.datecreneaux) = ps.jour_semaine
        AND EXTRACT(HOUR FROM c.heure) = ps.heure_debut
      ${whereClause}
      WHERE c.statut = 'disponible' AND ps.taux_occupation_habituel >= 60
      ORDER BY 
        CASE WHEN c.tarif * (ps.taux_occupation_habituel / 100.0) > 50 THEN 1 WHEN ps.taux_occupation_habituel >= 80 THEN 2 ELSE 3 END,
        revenu_attendu_estime DESC
      LIMIT 20
    `);

    const optimisationRemplissage = await db.query(`
      WITH creneaux_disponibles AS (
        SELECT idcreneaux, datecreneaux, heure, heurefin, typeTerrain, nomterrain, tarif,
          EXTRACT(DOW FROM datecreneaux) as jour_semaine, EXTRACT(HOUR FROM heure) as heure_debut
        FROM creneaux ${whereClause} WHERE statut = 'disponible'
      ),
      potentiel_remplissage AS (
        SELECT cd.*,
          CASE 
            WHEN cd.jour_semaine IN (5, 6) AND cd.heure_debut BETWEEN 18 AND 22 THEN 'POTENTIEL TRÈS ÉLEVÉ'
            WHEN cd.jour_semaine IN (5, 6) AND cd.heure_debut BETWEEN 14 AND 18 THEN 'POTENTIEL ÉLEVÉ'
            WHEN cd.jour_semaine NOT IN (0, 6) AND cd.heure_debut BETWEEN 18 AND 22 THEN 'POTENTIEL ÉLEVÉ'
            WHEN cd.heure_debut BETWEEN 12 AND 14 THEN 'POTENTIEL MODÉRÉ'
            ELSE 'POTENTIEL FAIBLE'
          END as potentiel_demande,
          CASE 
            WHEN cd.tarif > 50 THEN 'ACTION URGENTE'
            WHEN cd.tarif > 30 AND cd.jour_semaine IN (5, 6) THEN 'ACTION RECOMMANDÉE'
            WHEN cd.tarif > 20 AND cd.heure_debut BETWEEN 18 AND 22 THEN 'ACTION SUGGÉRÉE'
            ELSE 'SURVEILLANCE'
          END as priorite_action
        FROM creneaux_disponibles cd
      )
      SELECT 
        idcreneaux, datecreneaux, heure, heurefin, typeTerrain, nomterrain, tarif,
        potentiel_demande, priorite_action,
        CASE 
          WHEN potentiel_demande = 'POTENTIEL TRÈS ÉLEVÉ' AND priorite_action = 'ACTION URGENTE' THEN 'PROMOTION IMMÉDIATE RECOMMANDÉE'
          WHEN potentiel_demande IN ('POTENTIEL TRÈS ÉLEVÉ', 'POTENTIEL ÉLEVÉ') THEN 'PROMOTION SUGGÉRÉE'
          WHEN priorite_action = 'ACTION URGENTE' THEN 'RÉDUCTION TARIF RECOMMANDÉE'
          ELSE 'STATU QUO'
        END as recommandation_action
      FROM potentiel_remplissage
      ORDER BY 
        CASE WHEN priorite_action = 'ACTION URGENTE' THEN 1 WHEN priorite_action = 'ACTION RECOMMANDÉE' THEN 2 WHEN priorite_action = 'ACTION SUGGÉRÉE' THEN 3 ELSE 4 END,
        tarif DESC
      LIMIT 30
    `);

    res.json({
      success: true,
      horizon_analyse: horizon,
      date_generation: new Date().toISOString(),
      analyses: {
        creneaux_valeur: creneauxValeur.rows,
        creneaux_risque: creneauxRisque.rows,
        optimisation_remplissage: optimisationRemplissage.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans creneaux-strategiques:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse des créneaux stratégiques', error: error.message });
  }
});

// 📅 Analyse par mois des créneaux - CORRIGÉE DÉFINITIVEMENT
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

    // 1. Vue d'ensemble mensuelle - ROUND avec cast NUMERIC sur TOUTE l'expression
    const vueMensuelle = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datecreneaux) as annee,
        EXTRACT(MONTH FROM datecreneaux) as mois,
        TO_CHAR(datecreneaux, 'Month') as nom_mois,
        COUNT(*) as total_creneaux,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
        COUNT(*) FILTER (WHERE statut = 'disponible') as creneaux_disponibles,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(((CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END)::NUMERIC, 2) as taux_occupation,
        ROUND(((CASE 
            WHEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) > 0 
            THEN SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')) / COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé'))
            ELSE 0
          END)::NUMERIC, 2) as tarif_moyen_vendu
      FROM creneaux
      ${whereClause}
      GROUP BY EXTRACT(YEAR FROM datecreneaux), EXTRACT(MONTH FROM datecreneaux), TO_CHAR(datecreneaux, 'Month')
      ORDER BY annee DESC, mois DESC
    `, params);

    // 2. Évolution mensuelle par type de terrain
    const evolutionParType = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datecreneaux) as annee,
        EXTRACT(MONTH FROM datecreneaux) as mois,
        TO_CHAR(datecreneaux, 'Month') as nom_mois,
        typeTerrain,
        COUNT(*) as total_creneaux,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(((CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END)::NUMERIC), 2) as taux_occupation
      FROM creneaux
      ${whereClause}
      GROUP BY EXTRACT(YEAR FROM datecreneaux), EXTRACT(MONTH FROM datecreneaux), 
               TO_CHAR(datecreneaux, 'Month'), typeTerrain
      ORDER BY annee DESC, mois DESC, taux_occupation DESC
    `, params);

    // 3. Analyse comparative mois par mois
    const analyseComparative = await db.query(`
      WITH stats_mensuelles AS (
        SELECT 
          EXTRACT(YEAR FROM datecreneaux) as annee,
          EXTRACT(MONTH FROM datecreneaux) as mois,
          COUNT(*) as total_creneaux,
          COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as creneaux_occupes,
          COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total
        FROM creneaux ${whereClause}
        GROUP BY EXTRACT(YEAR FROM datecreneaux), EXTRACT(MONTH FROM datecreneaux)
      )
      SELECT 
        annee, mois, total_creneaux, creneaux_occupes, revenu_total,
        ROUND(((CASE WHEN total_creneaux > 0 THEN creneaux_occupes * 100.0 / total_creneaux ELSE 0 END)::NUMERIC), 2) as taux_occupation,
        LAG(creneaux_occupes) OVER (ORDER BY annee, mois) as occupation_mois_precedent,
        LAG(revenu_total) OVER (ORDER BY annee, mois) as revenu_mois_precedent,
        CASE 
          WHEN LAG(creneaux_occupes) OVER (ORDER BY annee, mois) > 0 
          THEN ROUND((((creneaux_occupes - LAG(creneaux_occupes) OVER (ORDER BY annee, mois)) * 100.0 / 
                LAG(creneaux_occupes) OVER (ORDER BY annee, mois))::NUMERIC), 2)
          ELSE NULL
        END as variation_occupation_pct,
        CASE 
          WHEN LAG(revenu_total) OVER (ORDER BY annee, mois) > 0 
          THEN ROUND((((revenu_total - LAG(revenu_total) OVER (ORDER BY annee, mois)) * 100.0 / 
                LAG(revenu_total) OVER (ORDER BY annee, mois))::NUMERIC), 2)
          ELSE NULL
        END as variation_revenu_pct,
        CASE 
          WHEN (creneaux_occupes - LAG(creneaux_occupes) OVER (ORDER BY annee, mois)) > 0 THEN '📈 CROISSANCE'
          WHEN (creneaux_occupes - LAG(creneaux_occupes) OVER (ORDER BY annee, mois)) < 0 THEN '📉 DÉCROISSANCE'
          ELSE '➡️ STABLE'
        END as tendance_occupation,
        CASE 
          WHEN (revenu_total - LAG(revenu_total) OVER (ORDER BY annee, mois)) > 0 THEN '📈 HAUSSE'
          WHEN (revenu_total - LAG(revenu_total) OVER (ORDER BY annee, mois)) < 0 THEN '📉 BAISSE'
          ELSE '➡️ STABLE'
        END as tendance_revenu
      FROM stats_mensuelles
      ORDER BY annee DESC, mois DESC
    `, params);

    // 4. Meilleurs et pires mois
    const meilleursMois = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datecreneaux) as annee,
        EXTRACT(MONTH FROM datecreneaux) as mois,
        TO_CHAR(datecreneaux, 'Month') as nom_mois,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as total_reservations,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(((CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END)::NUMERIC), 2) as taux_occupation,
        RANK() OVER (ORDER BY COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) DESC) as rang_occupation,
        RANK() OVER (ORDER BY COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) DESC) as rang_revenu
      FROM creneaux ${whereClause}
      GROUP BY EXTRACT(YEAR FROM datecreneaux), EXTRACT(MONTH FROM datecreneaux), TO_CHAR(datecreneaux, 'Month')
      ORDER BY revenu_total DESC
      LIMIT 5
    `, params);

    const piresMois = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datecreneaux) as annee,
        EXTRACT(MONTH FROM datecreneaux) as mois,
        TO_CHAR(datecreneaux, 'Month') as nom_mois,
        COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) as total_reservations,
        COALESCE(SUM(tarif) FILTER (WHERE statut IN ('réservé', 'occupé')), 0) as revenu_total,
        ROUND(((CASE 
            WHEN COUNT(*) > 0 
            THEN COUNT(*) FILTER (WHERE statut IN ('réservé', 'occupé')) * 100.0 / COUNT(*)
            ELSE 0
          END)::NUMERIC), 2) as taux_occupation
      FROM creneaux ${whereClause}
      GROUP BY EXTRACT(YEAR FROM datecreneaux), EXTRACT(MONTH FROM datecreneaux), TO_CHAR(datecreneaux, 'Month')
      ORDER BY revenu_total ASC
      LIMIT 5
    `, params);

    res.json({
      success: true,
      filtres: { annee: annee || 'Toutes', typeTerrain: typeTerrain || 'Tous' },
      date_generation: new Date().toISOString(),
      analyses: {
        vue_mensuelle: vueMensuelle.rows,
        evolution_par_type: evolutionParType.rows,
        analyse_comparative: analyseComparative.rows,
        top_meilleurs_mois: meilleursMois.rows,
        top_pires_mois: piresMois.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans analyse-mensuelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse mensuelle des créneaux',
      error: error.message
    });
  }
});

export default router;