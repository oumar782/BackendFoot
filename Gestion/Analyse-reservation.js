import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

const calculerEvolution = (valeurCourante, valeurReference) => {
  if (!valeurReference || valeurReference === 0) return 0;
  return ((parseFloat(valeurCourante || 0) - parseFloat(valeurReference)) / parseFloat(valeurReference)) * 100;
};

const getJourSemaine = (jour) => {
  const jours = {
    0: 'DIMANCHE', 1: 'LUNDI', 2: 'MARDI', 3: 'MERCREDI',
    4: 'JEUDI', 5: 'VENDREDI', 6: 'SAMEDI'
  };
  return jours[jour] || 'INCONNU';
};

const formaterNombre = (valeur) => {
  return parseInt(valeur || 0);
};

const formaterDecimal = (valeur, decimales = 2) => {
  return parseFloat(valeur || 0).toFixed(decimales);
};

const calculerTaux = (partie, total) => {
  if (!total || total === 0) return "0.00";
  return ((partie || 0) / total * 100).toFixed(2);
};

// ============================================
// 📊 ANALYSE DÉTAILLÉE DES TERRAINS PAR VILLE ET QUARTIER
// ============================================

router.get('/analyse-terrains-ville-quartier', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 90;
    
    const terrainsDetail = await db.query(`
      WITH stats_terrain AS (
        SELECT 
          COALESCE(r.ville, 'Non spécifiée') as ville,
          COALESCE(r.quartier, 'Non spécifié') as quartier,
          r.numeroterrain,
          COALESCE(r.nomterrain, 'Terrain ' || r.numeroterrain) as nomterrain,
          COALESCE(r.typeterrain, 'Non spécifié') as sport,
          COUNT(*) as total_reservations,
          COUNT(DISTINCT r.email) as clients_uniques,
          COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN r.statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
          COALESCE(SUM(r.tarif), 0) as revenu_total,
          COALESCE(AVG(r.tarif), 0) as prix_moyen,
          MIN(r.datereservation) as premiere_reservation,
          MAX(r.datereservation) as derniere_reservation,
          COUNT(DISTINCT EXTRACT(MONTH FROM r.datereservation)) as mois_actifs,
          COUNT(DISTINCT DATE_TRUNC('week', r.datereservation)) as semaines_actives
        FROM reservation r
        WHERE r.datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
          AND r.statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY r.ville, r.quartier, r.numeroterrain, r.nomterrain, r.typeterrain
      ),
      tendance_terrain AS (
        SELECT 
          r.ville,
          r.quartier,
          r.numeroterrain,
          DATE_TRUNC('week', r.datereservation) as semaine,
          COUNT(*) as reservations_semaine
        FROM reservation r
        WHERE r.datereservation >= CURRENT_DATE - INTERVAL '${Math.min(periodeJours * 2, 180)} days'
          AND r.statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY r.ville, r.quartier, r.numeroterrain, DATE_TRUNC('week', r.datereservation)
      ),
      evolution_terrain AS (
        SELECT 
          ville,
          quartier,
          numeroterrain,
          AVG(reservations_semaine) as moyenne_semaine,
          CORR(EXTRACT(EPOCH FROM semaine)::numeric, reservations_semaine) as tendance_correlation
        FROM tendance_terrain
        GROUP BY ville, quartier, numeroterrain
      )
      SELECT 
        st.*,
        COALESCE(et.moyenne_semaine, 0) as moyenne_reservations_semaine,
        COALESCE(et.tendance_correlation, 0) as tendance_correlation
      FROM stats_terrain st
      LEFT JOIN evolution_terrain et ON st.ville = et.ville 
        AND st.quartier = et.quartier 
        AND st.numeroterrain = et.numeroterrain
      ORDER BY st.ville, st.quartier, st.total_reservations DESC
    `);

    const churnTerrain = await db.query(`
      WITH clients_terrain AS (
        SELECT 
          ville,
          quartier,
          numeroterrain,
          COUNT(DISTINCT email) as total_clients
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${Math.min(periodeJours * 2, 180)} days'
          AND statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY ville, quartier, numeroterrain
      ),
      clients_actifs_terrain AS (
        SELECT 
          ville,
          quartier,
          numeroterrain,
          COUNT(DISTINCT email) as clients_actifs
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${Math.min(periodeJours / 3, 30)} days'
          AND statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY ville, quartier, numeroterrain
      )
      SELECT 
        ct.ville,
        ct.quartier,
        ct.numeroterrain,
        ct.total_clients,
        COALESCE(ca.clients_actifs, 0) as clients_actifs,
        CASE 
          WHEN ct.total_clients > 0 THEN 
            ROUND(((ct.total_clients - COALESCE(ca.clients_actifs, 0))::numeric / ct.total_clients * 100), 2)
          ELSE 0
        END as taux_churn
      FROM clients_terrain ct
      LEFT JOIN clients_actifs_terrain ca ON ct.ville = ca.ville 
        AND ct.quartier = ca.quartier 
        AND ct.numeroterrain = ca.numeroterrain
    `);

    // Organisation des données par ville et quartier
    const analyseParVille = {};
    
    terrainsDetail.rows.forEach(terrain => {
      const ville = terrain.ville;
      const quartier = terrain.quartier;
      
      if (!analyseParVille[ville]) {
        analyseParVille[ville] = {
          ville: ville,
          quartiers: {},
          total_terrains: 0,
          total_reservations: 0,
          total_clients_uniques: new Set(),
          total_revenu: 0
        };
      }
      
      if (!analyseParVille[ville].quartiers[quartier]) {
        analyseParVille[ville].quartiers[quartier] = {
          quartier: quartier,
          terrains: [],
          total_reservations: 0,
          total_clients_uniques: new Set(),
          total_revenu: 0,
          nb_terrains: 0,
          moyenne_reservations_terrain: 0
        };
      }
      
      const reservations = formaterNombre(terrain.total_reservations);
      const annulations = formaterNombre(terrain.annulations || 0);
      const revenu = parseFloat(terrain.revenu_total || 0);
      const churn = churnTerrain.rows.find(c => 
        c.ville === terrain.ville && 
        c.quartier === terrain.quartier && 
        c.numeroterrain === terrain.numeroterrain
      );
      
      const terrainData = {
        numeroterrain: terrain.numeroterrain,
        nom: terrain.nomterrain,
        sport: terrain.sport,
        total_reservations: reservations,
        clients_uniques: formaterNombre(terrain.clients_uniques),
        annulations: annulations,
        reservations_confirmees: formaterNombre(terrain.reservations_confirmees),
        taux_annulation: calculerTaux(annulations, reservations),
        revenu_total: formaterDecimal(revenu),
        prix_moyen: formaterDecimal(terrain.prix_moyen),
        premiere_reservation: terrain.premiere_reservation,
        derniere_reservation: terrain.derniere_reservation,
        jours_activite: Math.floor((new Date() - new Date(terrain.premiere_reservation)) / (1000 * 60 * 60 * 24)),
        mois_actifs: formaterNombre(terrain.mois_actifs || 0),
        semaines_actives: formaterNombre(terrain.semaines_actives || 0),
        moyenne_reservations_semaine: formaterDecimal(terrain.moyenne_reservations_semaine || 0, 1),
        tendance_correlation: formaterDecimal(terrain.tendance_correlation || 0, 3),
        taux_churn: churn ? formaterDecimal(churn.taux_churn) : "0.00",
        clients_totaux: churn ? formaterNombre(churn.total_clients) : 0,
        clients_actifs: churn ? formaterNombre(churn.clients_actifs) : 0,
        performance: 'MOYENNE'
      };
      
      const performanceScore = (terrainData.total_reservations * 2) + 
                              (terrainData.clients_uniques * 3) + 
                              (parseFloat(terrainData.revenu_total) / 10) -
                              (parseFloat(terrainData.taux_churn) * 2);
      
      if (performanceScore > 100) terrainData.performance = 'EXCELLENT';
      else if (performanceScore > 50) terrainData.performance = 'BON';
      else if (performanceScore > 20) terrainData.performance = 'MOYEN';
      else terrainData.performance = 'FAIBLE';
      
      analyseParVille[ville].quartiers[quartier].terrains.push(terrainData);
      analyseParVille[ville].quartiers[quartier].total_reservations += reservations;
      analyseParVille[ville].quartiers[quartier].total_revenu += revenu;
      analyseParVille[ville].quartiers[quartier].nb_terrains += 1;
      
      analyseParVille[ville].total_reservations += reservations;
      analyseParVille[ville].total_revenu += revenu;
      analyseParVille[ville].total_terrains += 1;
    });

    // Calcul des moyennes et tri des terrains
    Object.values(analyseParVille).forEach(ville => {
      Object.values(ville.quartiers).forEach(quartier => {
        quartier.terrains.sort((a, b) => b.total_reservations - a.total_reservations);
        quartier.moyenne_reservations_terrain = quartier.nb_terrains > 0 
          ? formaterDecimal(quartier.total_reservations / quartier.nb_terrains)
          : "0.00";
        
        quartier.top_terrains = quartier.terrains.slice(0, 3).map(t => ({
          nom: t.nom,
          numeroterrain: t.numeroterrain,
          reservations: t.total_reservations,
          revenu: t.revenu_total,
          performance: t.performance
        }));
        
        quartier.terrains_en_declin = quartier.terrains
          .filter(t => parseFloat(t.taux_churn) > 40 || parseFloat(t.tendance_correlation) < -0.3)
          .sort((a, b) => parseFloat(b.taux_churn) - parseFloat(a.taux_churn))
          .map(t => ({
            nom: t.nom,
            numeroterrain: t.numeroterrain,
            taux_churn: t.taux_churn,
            tendance: t.tendance_correlation,
            reservations: t.total_reservations,
            recommandation: parseFloat(t.taux_churn) > 60 
              ? 'URGENT - Risque élevé de perte de clients'
              : parseFloat(t.taux_churn) > 40 
                ? 'Attention - Taux de churn élevé'
                : 'Tendance à la baisse'
          }));
        
        quartier.terrains_en_croissance = quartier.terrains
          .filter(t => parseFloat(t.tendance_correlation) > 0.3 && t.total_reservations > 5)
          .sort((a, b) => parseFloat(b.tendance_correlation) - parseFloat(a.tendance_correlation))
          .map(t => ({
            nom: t.nom,
            numeroterrain: t.numeroterrain,
            tendance: t.tendance_correlation,
            reservations: t.total_reservations,
            croissance: t.total_reservations > 20 ? 'Forte croissance' : 'Croissance modérée'
          }));
      });
    });

    const resumeVilles = Object.values(analyseParVille).map(ville => {
      const quartiers = Object.values(ville.quartiers);
      const meilleurQuartier = quartiers.reduce((best, q) => 
        q.total_reservations > best.total_reservations ? q : best, 
        quartiers[0]
      );
      
      const tousTerrains = quartiers.flatMap(q => q.terrains);
      const meilleurTerrain = tousTerrains.reduce((best, t) => 
        t.total_reservations > best.total_reservations ? t : best, 
        tousTerrains[0]
      );
      
      const terrainsEnDeclin = tousTerrains
        .filter(t => parseFloat(t.taux_churn) > 40 || parseFloat(t.tendance_correlation) < -0.3);
      
      const terrainsEnCroissance = tousTerrains
        .filter(t => parseFloat(t.tendance_correlation) > 0.3 && t.total_reservations > 5);
      
      return {
        ville: ville.ville,
        total_terrains: ville.total_terrains,
        total_reservations: ville.total_reservations,
        total_revenu: formaterDecimal(ville.total_revenu),
        nb_quartiers: quartiers.length,
        meilleur_quartier: {
          nom: meilleurQuartier?.quartier || 'N/A',
          reservations: meilleurQuartier?.total_reservations || 0,
          nb_terrains: meilleurQuartier?.nb_terrains || 0
        },
        meilleur_terrain: {
          nom: meilleurTerrain?.nom || 'N/A',
          reservations: meilleurTerrain?.total_reservations || 0,
          performance: meilleurTerrain?.performance || 'N/A'
        },
        terrains_en_declin: terrainsEnDeclin.length,
        terrains_en_croissance: terrainsEnCroissance.length,
        taux_churn_moyen: formaterDecimal(
          tousTerrains.reduce((sum, t) => sum + parseFloat(t.taux_churn), 0) / tousTerrains.length || 0
        ),
        alertes: [
          terrainsEnDeclin.length > 0 
            ? `${terrainsEnDeclin.length} terrain(s) en déclin à ${ville.ville}`
            : 'Aucun terrain en déclin',
          terrainsEnCroissance.length > 0
            ? `${terrainsEnCroissance.length} terrain(s) en croissance à ${ville.ville}`
            : 'Tendance stable'
        ].filter(Boolean)
      };
    });

    const topTerrainsGlobaux = [];
    const terrainsEnDeclinGlobaux = [];
    const terrainsEnCroissanceGlobaux = [];
    
    Object.values(analyseParVille).forEach(ville => {
      Object.values(ville.quartiers).forEach(quartier => {
        quartier.terrains.forEach(terrain => {
          topTerrainsGlobaux.push({
            ...terrain,
            ville: ville.ville,
            quartier: quartier.quartier
          });
          
          if (parseFloat(terrain.taux_churn) > 40 || parseFloat(terrain.tendance_correlation) < -0.3) {
            terrainsEnDeclinGlobaux.push({
              ...terrain,
              ville: ville.ville,
              quartier: quartier.quartier
            });
          }
          
          if (parseFloat(terrain.tendance_correlation) > 0.3 && terrain.total_reservations > 5) {
            terrainsEnCroissanceGlobaux.push({
              ...terrain,
              ville: ville.ville,
              quartier: quartier.quartier
            });
          }
        });
      });
    });

    topTerrainsGlobaux.sort((a, b) => b.total_reservations - a.total_reservations);
    terrainsEnDeclinGlobaux.sort((a, b) => parseFloat(b.taux_churn) - parseFloat(a.taux_churn));
    terrainsEnCroissanceGlobaux.sort((a, b) => parseFloat(b.tendance_correlation) - parseFloat(a.tendance_correlation));

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      synthese_globale: {
        total_villes: Object.keys(analyseParVille).length,
        total_quartiers: Object.values(analyseParVille).reduce((sum, v) => 
          sum + Object.keys(v.quartiers).length, 0
        ),
        total_terrains: topTerrainsGlobaux.length,
        total_reservations: topTerrainsGlobaux.reduce((sum, t) => sum + t.total_reservations, 0),
        total_terrains_en_declin: terrainsEnDeclinGlobaux.length,
        total_terrains_en_croissance: terrainsEnCroissanceGlobaux.length,
        taux_churn_moyen_global: formaterDecimal(
          topTerrainsGlobaux.reduce((sum, t) => sum + parseFloat(t.taux_churn), 0) / topTerrainsGlobaux.length || 0
        ),
        alertes_majeures: terrainsEnDeclinGlobaux.length > 3 
          ? [`${terrainsEnDeclinGlobaux.length} terrains en déclin critique`]
          : ['Situation globale stable']
      },
      analyse_par_ville: resumeVilles,
      analyse_detaillee_par_ville: analyseParVille,
      top_terrains_global: topTerrainsGlobaux.slice(0, 20).map(t => ({
        ville: t.ville,
        quartier: t.quartier,
        nom: t.nom,
        numeroterrain: t.numeroterrain,
        sport: t.sport,
        reservations: t.total_reservations,
        revenu: t.revenu_total,
        performance: t.performance,
        taux_churn: t.taux_churn,
        tendance: t.tendance_correlation
      })),
      terrains_en_declin_global: terrainsEnDeclinGlobaux.slice(0, 20).map(t => ({
        ville: t.ville,
        quartier: t.quartier,
        nom: t.nom,
        numeroterrain: t.numeroterrain,
        taux_churn: t.taux_churn,
        tendance: t.tendance_correlation,
        reservations: t.total_reservations,
        niveau_alerte: parseFloat(t.taux_churn) > 60 ? 'CRITIQUE' : 'ÉLEVÉ',
        recommandation: parseFloat(t.taux_churn) > 60 
          ? 'Action immédiate requise - Révision de la stratégie nécessaire'
          : 'Plan d\'action à court terme recommandé'
      })),
      terrains_en_croissance_global: terrainsEnCroissanceGlobaux.slice(0, 20).map(t => ({
        ville: t.ville,
        quartier: t.quartier,
        nom: t.nom,
        numeroterrain: t.numeroterrain,
        tendance: t.tendance_correlation,
        reservations: t.total_reservations,
        croissance: t.total_reservations > 20 ? 'FORTE' : 'MODÉRÉE',
        recommandation: 'Capitaliser sur cette croissance'
      })),
      recommandations_strategiques: [
        terrainsEnDeclinGlobaux.length > 0 
          ? `Priorité 1: Analyser ${terrainsEnDeclinGlobaux.length} terrains en déclin critique`
          : 'Aucun terrain en déclin critique',
        terrainsEnCroissanceGlobaux.length > 5
          ? `Priorité 2: Investir dans ${terrainsEnCroissanceGlobaux.length} terrains en forte croissance`
          : 'Opportunités de croissance à explorer',
        topTerrainsGlobaux[0] 
          ? `Priorité 3: Étudier le succès de ${topTerrainsGlobaux[0].nom} (${topTerrainsGlobaux[0].ville})`
          : 'Benchmarking à réaliser'
      ].filter(Boolean)
    });
  } catch (error) {
    console.error('Erreur analyse terrains par ville/quartier:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse des terrains',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ANALYSE PAR VILLE ET QUARTIER AVEC PERFORMANCES DES TERRAINS
// ============================================

router.get('/analyse-par-ville-quartier', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 90;
    
    const statsResult = await db.query(`
      SELECT 
        COALESCE(ville, 'Non spécifiée') as ville,
        COALESCE(quartier, 'Non spécifié') as quartier,
        COUNT(*) as total_reservations,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COALESCE(SUM(tarif), 0) as revenu_total,
        COALESCE(AVG(tarif), 0) as panier_moyen,
        COUNT(DISTINCT numeroterrain) as terrains_actifs
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY ville, quartier
      ORDER BY total_reservations DESC
    `);

    const terrainsResult = await db.query(`
      SELECT 
        COALESCE(ville, 'Non spécifiée') as ville,
        COALESCE(quartier, 'Non spécifié') as quartier,
        numeroterrain,
        COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
        COUNT(*) as reservations,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COALESCE(SUM(tarif), 0) as revenu,
        COALESCE(AVG(tarif), 0) as prix_moyen,
        COUNT(DISTINCT EXTRACT(MONTH FROM datereservation)) as mois_actifs,
        MIN(datereservation) as premiere_reservation,
        MAX(datereservation) as derniere_reservation
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${Math.min(periodeJours * 2, 180)} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY ville, quartier, numeroterrain, nomterrain
      ORDER BY reservations DESC
    `);

    const churnResult = await db.query(`
      WITH 
      clients_totaux AS (
        SELECT 
          COALESCE(ville, 'Non spécifiée') as ville,
          COALESCE(quartier, 'Non spécifié') as quartier,
          numeroterrain,
          COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
          COUNT(DISTINCT email) as total_clients
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${Math.min(periodeJours * 2, 180)} days'
          AND statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY ville, quartier, numeroterrain, nomterrain
      ),
      clients_actifs AS (
        SELECT 
          COALESCE(ville, 'Non spécifiée') as ville,
          COALESCE(quartier, 'Non spécifié') as quartier,
          numeroterrain,
          nomterrain,
          COUNT(DISTINCT email) as clients_actifs
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${Math.min(periodeJours / 3, 30)} days'
          AND statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY ville, quartier, numeroterrain, nomterrain
      )
      SELECT 
        ct.ville,
        ct.quartier,
        ct.numeroterrain,
        ct.nomterrain,
        ct.total_clients,
        COALESCE(ca.clients_actifs, 0) as clients_actifs,
        CASE 
          WHEN ct.total_clients > 0 THEN 
            ROUND(((ct.total_clients - COALESCE(ca.clients_actifs, 0))::numeric / ct.total_clients * 100), 2)
          ELSE 0
        END as taux_churn
      FROM clients_totaux ct
      LEFT JOIN clients_actifs ca ON ct.ville = ca.ville 
        AND ct.quartier = ca.quartier 
        AND ct.numeroterrain = ca.numeroterrain
      ORDER BY taux_churn DESC
    `);

    const parVille = {};
    
    statsResult.rows.forEach(row => {
      if (!parVille[row.ville]) {
        parVille[row.ville] = {
          ville: row.ville,
          total_reservations: 0,
          clients_uniques: new Set(),
          reservations_confirmees: 0,
          annulations: 0,
          revenu_total: 0,
          terrains_actifs: new Set(),
          quartiers: [],
          terrains: []
        };
      }
      
      const ville = parVille[row.ville];
      ville.total_reservations += formaterNombre(row.total_reservations);
      ville.clients_uniques.add(row.clients_uniques);
      ville.reservations_confirmees += formaterNombre(row.reservations_confirmees);
      ville.annulations += formaterNombre(row.annulations);
      ville.revenu_total += parseFloat(row.revenu_total || 0);
      ville.terrains_actifs.add(row.terrains_actifs);
      
      ville.quartiers.push({
        quartier: row.quartier,
        reservations: formaterNombre(row.total_reservations),
        revenu: parseFloat(row.revenu_total || 0)
      });
    });

    terrainsResult.rows.forEach(terrain => {
      const ville = terrain.ville;
      if (parVille[ville]) {
        const reservations = formaterNombre(terrain.reservations);
        const annulations = formaterNombre(terrain.annulations || 0);
        
        parVille[ville].terrains.push({
          nom: terrain.nomterrain,
          numeroterrain: terrain.numeroterrain,
          reservations: reservations,
          clients_uniques: formaterNombre(terrain.clients_uniques),
          revenu: parseFloat(terrain.revenu || 0),
          prix_moyen: parseFloat(terrain.prix_moyen || 0),
          annulations: annulations,
          taux_annulation: calculerTaux(annulations, reservations),
          mois_actifs: formaterNombre(terrain.mois_actifs || 0),
          premiere_reservation: terrain.premiere_reservation,
          derniere_reservation: terrain.derniere_reservation
        });
      }
    });

    const churnVilles = {};
    const churnQuartiers = {};
    const churnTerrains = {};

    churnResult.rows.forEach(row => {
      if (!churnVilles[row.ville]) {
        churnVilles[row.ville] = { total: 0, actifs: 0 };
      }
      churnVilles[row.ville].total += formaterNombre(row.total_clients);
      churnVilles[row.ville].actifs += formaterNombre(row.clients_actifs);

      const keyQuartier = `${row.ville}|${row.quartier}`;
      if (!churnQuartiers[keyQuartier]) {
        churnQuartiers[keyQuartier] = { 
          ville: row.ville, 
          quartier: row.quartier, 
          total: 0, 
          actifs: 0 
        };
      }
      churnQuartiers[keyQuartier].total += formaterNombre(row.total_clients);
      churnQuartiers[keyQuartier].actifs += formaterNombre(row.clients_actifs);

      const keyTerrain = `${row.ville}|${row.quartier}|${row.numeroterrain}`;
      if (!churnTerrains[keyTerrain]) {
        churnTerrains[keyTerrain] = {
          ville: row.ville,
          quartier: row.quartier,
          numeroterrain: row.numeroterrain,
          nomterrain: row.nomterrain,
          total: 0,
          actifs: 0
        };
      }
      churnTerrains[keyTerrain].total += formaterNombre(row.total_clients);
      churnTerrains[keyTerrain].actifs += formaterNombre(row.clients_actifs);
    });

    const churnVillesFormatted = Object.entries(churnVilles).map(([ville, data]) => ({
      ville,
      total_clients: data.total,
      clients_actifs: data.actifs,
      taux_churn: calculerTaux(data.total - data.actifs, data.total)
    }));

    const churnQuartiersFormatted = Object.values(churnQuartiers).map(data => ({
      ville: data.ville,
      quartier: data.quartier,
      total_clients: data.total,
      clients_actifs: data.actifs,
      taux_churn: calculerTaux(data.total - data.actifs, data.total)
    }));

    const churnTerrainsFormatted = Object.values(churnTerrains).map(data => ({
      ville: data.ville,
      quartier: data.quartier,
      numeroterrain: data.numeroterrain,
      nomterrain: data.nomterrain,
      total_clients: data.total,
      clients_actifs: data.actifs,
      taux_churn: calculerTaux(data.total - data.actifs, data.total)
    }));

    const topQuartiers = statsResult.rows
      .sort((a, b) => b.total_reservations - a.total_reservations)
      .slice(0, 10)
      .map(q => ({
        ville: q.ville,
        quartier: q.quartier,
        reservations: formaterNombre(q.total_reservations),
        clients_uniques: formaterNombre(q.clients_uniques),
        revenu: formaterDecimal(q.revenu_total),
        panier_moyen: formaterDecimal(q.panier_moyen)
      }));

    const topTerrains = terrainsResult.rows
      .sort((a, b) => b.reservations - a.reservations)
      .slice(0, 20)
      .map(t => {
        const reservations = formaterNombre(t.reservations);
        const annulations = formaterNombre(t.annulations || 0);
        return {
          ville: t.ville,
          quartier: t.quartier,
          nomterrain: t.nomterrain,
          numeroterrain: t.numeroterrain,
          reservations: reservations,
          clients_uniques: formaterNombre(t.clients_uniques),
          revenu: parseFloat(t.revenu || 0),
          prix_moyen: parseFloat(t.prix_moyen || 0),
          taux_annulation: calculerTaux(annulations, reservations),
          mois_actifs: formaterNombre(t.mois_actifs || 0)
        };
      });

    const analyseVilles = Object.values(parVille).map(v => {
      const totalReservations = v.total_reservations;
      const annulations = v.annulations;
      
      return {
        ville: v.ville,
        total_reservations: totalReservations,
        clients_uniques: v.clients_uniques.size,
        reservations_confirmees: v.reservations_confirmees,
        taux_annulation: calculerTaux(annulations, totalReservations),
        revenu_total: formaterDecimal(v.revenu_total),
        panier_moyen: totalReservations > 0 ? formaterDecimal(v.revenu_total / totalReservations) : "0.00",
        terrains_actifs: v.terrains_actifs.size,
        top_quartiers: v.quartiers
          .sort((a, b) => b.reservations - a.reservations)
          .slice(0, 3)
          .map(q => ({
            quartier: q.quartier,
            reservations: q.reservations,
            revenu: formaterDecimal(q.revenu)
          })),
        terrains: v.terrains.sort((a, b) => b.reservations - a.reservations),
        taux_churn: churnVillesFormatted.find(c => c.ville === v.ville)?.taux_churn || "0.00"
      };
    });

    const totalReservations = analyseVilles.reduce((sum, v) => sum + v.total_reservations, 0);
    const villeTop = [...analyseVilles].sort((a, b) => b.total_reservations - a.total_reservations)[0];
    const villeTopRevenu = [...analyseVilles].sort((a, b) => parseFloat(b.revenu_total) - parseFloat(a.revenu_total))[0];
    const villeMeilleurChurn = [...analyseVilles].sort((a, b) => parseFloat(a.taux_churn) - parseFloat(b.taux_churn))[0];

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      synthese: {
        total_reservations: totalReservations,
        nombre_villes_actives: analyseVilles.length,
        ville_la_plus_active: villeTop?.ville || 'N/A',
        ville_plus_rentable: villeTopRevenu?.ville || 'N/A',
        ville_meilleur_fidelisation: villeMeilleurChurn?.ville || 'N/A',
        meilleur_taux_churn: villeMeilleurChurn?.taux_churn || '0.00%',
        recommandations: [
          villeTop && villeTop.total_reservations > 0 
            ? `${villeTop.ville} est votre ville phare avec ${villeTop.total_reservations} réservations`
            : 'Aucune donnée suffisante pour des recommandations',
          villeMeilleurChurn && parseFloat(villeMeilleurChurn.taux_churn) < 30
            ? `${villeMeilleurChurn.ville} a le meilleur taux de fidélisation (${villeMeilleurChurn.taux_churn}% de churn)`
            : 'Attention au taux de churn élevé dans certaines villes',
          villeTop && villeTop.total_reservations > 20
            ? `Développez votre présence dans les quartiers de ${villeTop.ville}`
            : 'Analysez les opportunités d\'expansion'
        ].filter(Boolean)
      },
      analyse_par_ville: analyseVilles,
      top_quartiers: topQuartiers,
      top_terrains: topTerrains,
      analyse_churn: {
        par_ville: churnVillesFormatted.sort((a, b) => parseFloat(a.taux_churn) - parseFloat(b.taux_churn)),
        par_quartier: churnQuartiersFormatted.sort((a, b) => parseFloat(a.taux_churn) - parseFloat(b.taux_churn)),
        par_terrain: churnTerrainsFormatted.sort((a, b) => parseFloat(a.taux_churn) - parseFloat(b.taux_churn))
      },
      performances_terrains: {
        par_ville: analyseVilles.map(v => ({
          ville: v.ville,
          nb_terrains: v.terrains.length,
          total_reservations: v.total_reservations,
          reservations_par_terrain: v.terrains.length > 0 
            ? formaterDecimal(v.total_reservations / v.terrains.length)
            : "0.00",
          top_terrain: v.terrains[0]?.nom || 'Aucun',
          top_terrain_reservations: v.terrains[0]?.reservations || 0
        })),
        detail_terrains: topTerrains
      }
    });
  } catch (error) {
    console.error('Erreur analyse par ville/quartier:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse par ville et quartier',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ANALYSE PAR SPORT ET RENTABILITÉ
// ============================================

router.get('/analyse-par-sport-rentabilite', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 90;
    
    const result = await db.query(`
      SELECT 
        COALESCE(typeterrain, 'Non spécifié') as sport,
        COUNT(*) as total_reservations,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COALESCE(SUM(tarif), 0) as revenu_total,
        COALESCE(AVG(tarif), 0) as prix_moyen,
        COUNT(DISTINCT numeroterrain) as terrains_dedies,
        COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as duree_moyenne,
        COUNT(DISTINCT ville) as villes_actives
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY typeterrain
      ORDER BY revenu_total DESC
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        periode: `${periodeJours} derniers jours`,
        message: 'Aucune donnée disponible pour cette période',
        analyse_par_sport: [],
        top_sports_rentables: [],
        sports_a_risque: [],
        sports_potentiel_croissance: [],
        recommandations: ['Aucune donnée disponible']
      });
    }

    const analyseSports = result.rows.map(r => {
      const reservations = formaterNombre(r.total_reservations);
      const revenu = parseFloat(r.revenu_total || 0);
      const annulations = formaterNombre(r.annulations || 0);
      const terrains = formaterNombre(r.terrains_dedies || 0);
      
      return {
        sport: r.sport,
        total_reservations: reservations,
        clients_uniques: formaterNombre(r.clients_uniques || 0),
        reservations_confirmees: formaterNombre(r.reservations_confirmees || 0),
        taux_annulation: calculerTaux(annulations, reservations),
        revenu_total: formaterDecimal(revenu),
        panier_moyen: reservations > 0 ? formaterDecimal(revenu / reservations) : "0.00",
        prix_moyen: formaterDecimal(r.prix_moyen),
        terrains_dedies: terrains,
        reservations_par_terrain: terrains > 0 ? formaterDecimal(reservations / terrains) : "0.00",
        duree_moyenne: formaterDecimal(r.duree_moyenne, 1),
        villes_actives: formaterNombre(r.villes_actives || 0),
        rentabilite: terrains > 0 ? formaterDecimal(revenu / terrains) : "0.00"
      };
    });

    const totalRevenu = analyseSports.reduce((sum, s) => sum + parseFloat(s.revenu_total), 0);
    const totalReservations = analyseSports.reduce((sum, s) => sum + s.total_reservations, 0);
    
    const topSports = analyseSports
      .sort((a, b) => parseFloat(b.rentabilite) - parseFloat(a.rentabilite))
      .slice(0, 5);

    const sportsARisque = analyseSports
      .filter(s => parseFloat(s.taux_annulation) > 20)
      .sort((a, b) => parseFloat(b.taux_annulation) - parseFloat(a.taux_annulation));

    const sportsPotentiel = analyseSports
      .filter(s => s.terrains_dedies > 0 && parseFloat(s.reservations_par_terrain) < 5)
      .sort((a, b) => parseFloat(a.reservations_par_terrain) - parseFloat(b.reservations_par_terrain))
      .slice(0, 3);

    const sportLePlusPopulaire = [...analyseSports].sort((a, b) => b.total_reservations - a.total_reservations)[0];

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      synthese: {
        total_revenu: formaterDecimal(totalRevenu),
        total_reservations: totalReservations,
        sport_le_plus_rentable: topSports[0]?.sport || 'N/A',
        sport_plus_populaire: sportLePlusPopulaire?.sport || 'N/A',
        nombre_sports_actifs: analyseSports.length
      },
      analyse_par_sport: analyseSports,
      top_sports_rentables: topSports,
      sports_a_risque: sportsARisque,
      sports_potentiel_croissance: sportsPotentiel,
      recommandations: [
        topSports[0] ? `${topSports[0].sport} est le sport le plus rentable (${topSports[0].rentabilite} DH/terrain)` : '',
        sportsARisque.length > 0 
          ? `Attention: ${sportsARisque.map(s => s.sport).join(', ')} ont un taux d'annulation élevé`
          : 'Tous les sports ont un bon taux de confirmation',
        sportsPotentiel.length > 0
          ? `Potentiel de croissance pour: ${sportsPotentiel.map(s => s.sport).join(', ')}`
          : 'Tous les sports sont bien exploités'
      ].filter(Boolean)
    });
  } catch (error) {
    console.error('Erreur analyse par sport:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse par sport',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ANALYSE VILLE + SPORT
// ============================================

router.get('/analyse-ville-sport', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 90;
    
    const result = await db.query(`
      SELECT 
        COALESCE(ville, 'Non spécifiée') as ville,
        COALESCE(quartier, 'Non spécifié') as quartier,
        COALESCE(typeterrain, 'Non spécifié') as sport,
        COUNT(*) as total_reservations,
        COALESCE(SUM(tarif), 0) as revenu_total,
        COALESCE(AVG(tarif), 0) as prix_moyen,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY ville, quartier, typeterrain
      ORDER BY total_reservations DESC
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        periode: `${periodeJours} derniers jours`,
        message: 'Aucune donnée disponible pour cette période',
        top_combinaisons_ville_sport: [],
        top_sports_par_ville: [],
        analyse_detaillee: [],
        recommandations: ['Aucune donnée disponible']
      });
    }

    const analyseCouples = result.rows.map(r => {
      const reservations = formaterNombre(r.total_reservations);
      const annulations = formaterNombre(r.annulations || 0);
      return {
        ville: r.ville,
        quartier: r.quartier,
        sport: r.sport,
        reservations: reservations,
        revenu: formaterDecimal(r.revenu_total),
        prix_moyen: formaterDecimal(r.prix_moyen),
        clients_uniques: formaterNombre(r.clients_uniques || 0),
        taux_annulation: calculerTaux(annulations, reservations)
      };
    });

    const topCombinaisons = analyseCouples
      .sort((a, b) => parseFloat(b.revenu) - parseFloat(a.revenu))
      .slice(0, 10);

    const sportParVille = {};
    result.rows.forEach(row => {
      const key = `${row.ville}|${row.typeterrain}`;
      if (!sportParVille[key]) {
        sportParVille[key] = {
          ville: row.ville,
          sport: row.typeterrain,
          total_reservations: 0,
          revenu_total: 0
        };
      }
      sportParVille[key].total_reservations += formaterNombre(row.total_reservations);
      sportParVille[key].revenu_total += parseFloat(row.revenu_total || 0);
    });

    const topSportsParVille = Object.values(sportParVille)
      .sort((a, b) => b.total_reservations - a.total_reservations)
      .slice(0, 15)
      .map(item => ({
        ...item,
        revenu_total: formaterDecimal(item.revenu_total)
      }));

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      top_combinaisons_ville_sport: topCombinaisons,
      top_sports_par_ville: topSportsParVille,
      analyse_detaillee: analyseCouples.slice(0, 50),
      recommandations: [
        topCombinaisons[0] 
          ? `Meilleure combinaison: ${topCombinaisons[0].sport} à ${topCombinaisons[0].ville} (${topCombinaisons[0].reservations} résas)`
          : 'Aucune combinaison trouvée',
        topCombinaisons.length > 5
          ? `${topCombinaisons.length} combinaisons ville-sport avec plus de 50 réservations`
          : 'Développez de nouvelles combinaisons ville-sport'
      ].filter(Boolean)
    });
  } catch (error) {
    console.error('Erreur analyse ville-sport:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse ville-sport',
      error: error.message 
    });
  }
});

// ============================================
// 📊 DASHBOARD PRINCIPAL
// ============================================

router.get('/dashboard-reservations', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 30;
    
    const [global, parJour, parTerrain] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total_reservations,
          COUNT(DISTINCT email) as clients_uniques,
          COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as duree_moyenne,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
      `),
      db.query(`
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        GROUP BY EXTRACT(DOW FROM datereservation)
        ORDER BY jour_semaine
      `),
      db.query(`
        SELECT 
          numeroterrain,
          COALESCE(nomterrain, 'Terrain ' || numeroterrain) as nomterrain,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        GROUP BY numeroterrain, nomterrain
        ORDER BY reservations DESC
        LIMIT 5
      `)
    ]);

    const totalReservations = formaterNombre(global.rows[0]?.total_reservations || 0);
    const annulations = formaterNombre(global.rows[0]?.annulations || 0);
    const clientsUniques = formaterNombre(global.rows[0]?.clients_uniques || 0);

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      indicateurs: {
        total_reservations: totalReservations,
        clients_uniques: clientsUniques,
        duree_moyenne_heures: formaterDecimal(global.rows[0]?.duree_moyenne || 0, 1),
        taux_annulation: calculerTaux(annulations, totalReservations),
        taux_fidelisation: clientsUniques > 0 
          ? formaterDecimal((totalReservations / clientsUniques))
          : "0.00"
      },
      reservations_par_jour: parJour.rows.map(r => ({
        jour: getJourSemaine(parseInt(r.jour_semaine)),
        reservations: formaterNombre(r.reservations || 0),
        clients_uniques: formaterNombre(r.clients_uniques || 0)
      })),
      top_terrains: parTerrain.rows.map(t => ({
        terrain: t.nomterrain,
        reservations: formaterNombre(t.reservations || 0),
        clients_uniques: formaterNombre(t.clients_uniques || 0)
      }))
    });
  } catch (error) {
    console.error('Erreur dashboard réservations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors du chargement du dashboard',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ANALYSE HORAIRE
// ============================================

router.get('/analyse-horaire', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 30;
    
    const result = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as reservations,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as duree_moyenne
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
        AND EXTRACT(HOUR FROM heurereservation) BETWEEN 6 AND 23
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        periode: `${periodeJours} derniers jours`,
        message: 'Aucune donnée disponible pour cette période',
        distribution_horaire: [],
        analyses: {
          heures_de_pointe: [],
          heures_creuses: [],
          meilleur_creneau: null,
          recommandations: ['Aucune donnée disponible']
        }
      });
    }

    const creneaux = result.rows.map(r => {
      const reservations = formaterNombre(r.reservations);
      const annulations = formaterNombre(r.annulations || 0);
      return {
        heure: parseInt(r.heure),
        reservations: reservations,
        clients_uniques: formaterNombre(r.clients_uniques || 0),
        taux_annulation: calculerTaux(annulations, reservations),
        duree_moyenne: formaterDecimal(r.duree_moyenne, 1)
      };
    });

    const totalReservations = creneaux.reduce((sum, c) => sum + c.reservations, 0);
    const moyenneReservations = totalReservations / creneaux.length;
    
    const heuresPointes = creneaux.filter(c => c.reservations > moyenneReservations * 1.5);
    const heuresCreuses = creneaux.filter(c => c.reservations < moyenneReservations * 0.5);
    const meilleureHeure = creneaux.reduce((max, c) => c.reservations > max.reservations ? c : max, creneaux[0]);

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      distribution_horaire: creneaux,
      analyses: {
        heures_de_pointe: heuresPointes.map(h => `${h.heure}h - ${h.reservations} résas`),
        heures_creuses: heuresCreuses.map(h => `${h.heure}h - ${h.reservations} résas`),
        meilleur_creneau: {
          heure: meilleureHeure.heure,
          reservations: meilleureHeure.reservations
        },
        recommandations: heuresCreuses.length > 0 
          ? [`Proposer des offres sur les créneaux: ${heuresCreuses.map(h => `${h.heure}h`).join(', ')}`]
          : ['Bonne répartition des réservations sur la journée']
      }
    });
  } catch (error) {
    console.error('Erreur analyse horaire:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse horaire',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ANALYSE PAR TYPE DE TERRAIN
// ============================================

router.get('/analyse-par-type-terrain', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 90;
    
    const result = await db.query(`
      SELECT 
        COALESCE(typeterrain, 'Non spécifié') as type_terrain,
        COUNT(*) as reservations,
        COUNT(DISTINCT numeroterrain) as nb_terrains,
        COUNT(DISTINCT email) as clients_uniques,
        COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as duree_moyenne,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY typeterrain
      ORDER BY reservations DESC
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        periode: `${periodeJours} derniers jours`,
        message: 'Aucune donnée disponible pour cette période',
        types_terrain: [],
        resume: {
          type_plus_populaire: 'N/A',
          type_meilleur_taux_rotation: 'N/A'
        }
      });
    }

    const data = result.rows.map(r => {
      const reservations = formaterNombre(r.reservations);
      const nbTerrains = formaterNombre(r.nb_terrains || 0);
      const annulations = formaterNombre(r.annulations || 0);
      
      return {
        type_terrain: r.type_terrain,
        reservations: reservations,
        nb_terrains: nbTerrains,
        reservations_par_terrain: nbTerrains > 0 ? formaterDecimal(reservations / nbTerrains) : "0.00",
        clients_uniques: formaterNombre(r.clients_uniques || 0),
        taux_rotation: nbTerrains > 0 ? formaterDecimal(reservations / nbTerrains / (periodeJours / 30)) : "0.00",
        taux_annulation: calculerTaux(annulations, reservations),
        duree_moyenne: formaterDecimal(r.duree_moyenne, 1)
      };
    });

    const typePlusPopulaire = data[0]?.type_terrain || 'N/A';
    const meilleurTauxRotation = data.reduce((best, t) => 
      parseFloat(t.taux_rotation) > parseFloat(best.taux_rotation) ? t : best, data[0]
    )?.type_terrain || 'N/A';

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      types_terrain: data,
      resume: {
        type_plus_populaire: typePlusPopulaire,
        type_meilleur_taux_rotation: meilleurTauxRotation
      }
    });
  } catch (error) {
    console.error('Erreur analyse type terrain:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse par type de terrain',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ÉVOLUTION MENSUELLE
// ============================================

router.get('/evolution-mensuelle', async (req, res) => {
  try {
    const mois = parseInt(req.query.mois) || 12;
    
    const result = await db.query(`
      SELECT 
        DATE_TRUNC('month', datereservation) as mois,
        COUNT(*) as reservations,
        COUNT(DISTINCT email) as nouveaux_clients
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${mois} months'
      GROUP BY DATE_TRUNC('month', datereservation)
      ORDER BY mois DESC
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        periode: `${mois} derniers mois`,
        message: 'Aucune donnée disponible pour cette période',
        donnees: []
      });
    }

    const data = result.rows.map((row, index, array) => {
      const reservations = formaterNombre(row.reservations);
      const evolution = index < array.length - 1 
        ? calculerEvolution(reservations, array[index + 1].reservations)
        : 0;
      
      return {
        mois: row.mois,
        reservations: reservations,
        nouveaux_clients: formaterNombre(row.nouveaux_clients || 0),
        evolution: formaterDecimal(evolution, 1)
      };
    });

    const tendanceGlobale = data.length > 1 
      ? calculerEvolution(data[0].reservations, data[data.length - 1].reservations)
      : 0;

    res.json({
      success: true,
      periode: `${mois} derniers mois`,
      tendance_globale: formaterDecimal(tendanceGlobale, 1),
      donnees: data
    });
  } catch (error) {
    console.error('Erreur evolution mensuelle:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse d\'évolution mensuelle',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ANALYSE CLIENTS
// ============================================

router.get('/analyse-clients-reservations', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 180;
    const limit = parseInt(req.query.limit) || 100;
    
    const result = await db.query(`
      SELECT 
        email,
        COUNT(*) as nb_reservations,
        MIN(datereservation) as premiere_reservation,
        MAX(datereservation) as derniere_reservation,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY email
      HAVING COUNT(*) >= 2
      ORDER BY nb_reservations DESC
      LIMIT ${limit}
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        periode: `${periodeJours} derniers jours`,
        message: 'Aucun client fidèle trouvé',
        clients_analyses: [],
        alertes: {
          clients_actifs: 0,
          clients_a_risque: 0,
          recommandations: []
        }
      });
    }

    const maintenant = new Date();
    const clients = result.rows.map(c => {
      const nbReservations = formaterNombre(c.nb_reservations);
      const premiereResa = new Date(c.premiere_reservation);
      const derniereResa = new Date(c.derniere_reservation);
      const joursInactivite = Math.floor((maintenant - derniereResa) / (1000 * 60 * 60 * 24));
      const ancienneteJours = Math.floor((maintenant - premiereResa) / (1000 * 60 * 60 * 24));
      const annulations = formaterNombre(c.annulations || 0);
      
      let profil = 'OCCASIONNEL';
      if (nbReservations >= 20) profil = 'SUPER FIDÈLE';
      else if (nbReservations >= 10) profil = 'TRÈS FIDÈLE';
      else if (nbReservations >= 5) profil = 'FIDÈLE';
      
      if (joursInactivite > 60 && nbReservations >= 5) profil = 'À RISQUE DE PERTE';
      
      return {
        email: c.email,
        nb_reservations: nbReservations,
        anciennete_jours: ancienneteJours,
        jours_depuis_derniere_resa: joursInactivite,
        taux_annulation: calculerTaux(annulations, nbReservations),
        profil: profil
      };
    });

    const clientsActifs = clients.filter(c => c.jours_depuis_derniere_resa <= 30);
    const clientsARisque = clients.filter(c => c.profil === 'À RISQUE DE PERTE');

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      clients_analyses: clients.slice(0, 20),
      alertes: {
        clients_actifs: clientsActifs.length,
        clients_a_risque: clientsARisque.length,
        recommandations: clientsARisque.length > 0 
          ? [`Contacter ${clientsARisque.length} clients à risque de perdre`]
          : ['Aucun client à risque détecté']
      }
    });
  } catch (error) {
    console.error('Erreur analyse clients:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse des clients',
      error: error.message 
    });
  }
});

// ============================================
// 📊 COMPARAISON HEBDOMADAIRE
// ============================================

router.get('/comparaison-hebdomadaire', async (req, res) => {
  try {
    const result = await db.query(`
      WITH 
      jours_semaine AS (
        SELECT generate_series(0, 6) as jour_num
      ),
      semaine_courante AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY EXTRACT(DOW FROM datereservation)
      ),
      semaine_precedente AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '14 days'
          AND datereservation < CURRENT_DATE - INTERVAL '7 days'
        GROUP BY EXTRACT(DOW FROM datereservation)
      )
      SELECT 
        js.jour_num,
        COALESCE(sc.reservations, 0) as resas_courantes,
        COALESCE(sp.reservations, 0) as resas_precedentes,
        COALESCE(sc.clients_uniques, 0) as clients_courants,
        COALESCE(sp.clients_uniques, 0) as clients_precedents
      FROM jours_semaine js
      LEFT JOIN semaine_courante sc ON js.jour_num = sc.jour_semaine
      LEFT JOIN semaine_precedente sp ON js.jour_num = sp.jour_semaine
      ORDER BY js.jour_num
    `);

    const comparaison = result.rows.map(r => ({
      jour: getJourSemaine(parseInt(r.jour_num)),
      reservations: {
        courant: formaterNombre(r.resas_courantes || 0),
        precedent: formaterNombre(r.resas_precedentes || 0),
        evolution: formaterDecimal(calculerEvolution(r.resas_courantes, r.resas_precedentes), 1)
      },
      clients: {
        courant: formaterNombre(r.clients_courants || 0),
        precedent: formaterNombre(r.clients_precedents || 0),
        evolution: formaterDecimal(calculerEvolution(r.clients_courants, r.clients_precedents), 1)
      }
    }));

    const totalCourant = comparaison.reduce((sum, j) => sum + j.reservations.courant, 0);
    const totalPrecedent = comparaison.reduce((sum, j) => sum + j.reservations.precedent, 0);
    const evolutionGlobale = calculerEvolution(totalCourant, totalPrecedent);

    const meilleurJour = comparaison.reduce((best, j) => 
      j.reservations.courant > best.reservations.courant ? j : best, 
      comparaison[0]
    );

    res.json({
      success: true,
      comparaison_journaliere: comparaison,
      synthese: {
        total_semaine_courante: totalCourant,
        total_semaine_precedente: totalPrecedent,
        evolution_globale: formaterDecimal(evolutionGlobale, 1),
        meilleur_jour: meilleurJour.jour,
        jours_en_hausse: comparaison.filter(j => parseFloat(j.reservations.evolution) > 0).length,
        jours_en_baisse: comparaison.filter(j => parseFloat(j.reservations.evolution) < 0).length
      }
    });
  } catch (error) {
    console.error('Erreur comparaison hebdomadaire:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la comparaison hebdomadaire',
      error: error.message 
    });
  }
});

// ============================================
// 📊 PRÉVISIONS
// ============================================

router.get('/previsions-reservations', async (req, res) => {
  try {
    const moisHistorique = parseInt(req.query.mois) || 12;
    
    const result = await db.query(`
      WITH mensuel AS (
        SELECT 
          DATE_TRUNC('month', datereservation) as mois,
          COUNT(*) as reservations
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${moisHistorique} months'
        GROUP BY DATE_TRUNC('month', datereservation)
        ORDER BY mois
      )
      SELECT 
        mois,
        reservations
      FROM mensuel
    `);

    if (result.rows.length < 3) {
      return res.json({
        success: true,
        message: 'Données insuffisantes pour les prévisions (minimum 3 mois requis)',
        donnees: result.rows.map(r => ({
          mois: r.mois,
          reservations: formaterNombre(r.reservations || 0)
        })),
        previsions: [],
        analyse_tendance: {
          pente_mensuelle: "0.00",
          recommandations: 'Collectez plus de données pour des prévisions fiables'
        }
      });
    }

    const historique = result.rows.map(r => ({
      mois: r.mois,
      reservations: formaterNombre(r.reservations || 0)
    }));

    const n = historique.length;
    const indices = historique.map((_, i) => i);
    const reservations = historique.map(h => h.reservations);
    
    const moyenneX = indices.reduce((a, b) => a + b, 0) / n;
    const moyenneY = reservations.reduce((a, b) => a + b, 0) / n;
    
    let numerateur = 0, denominateur = 0;
    for (let i = 0; i < n; i++) {
      numerateur += (indices[i] - moyenneX) * (reservations[i] - moyenneY);
      denominateur += Math.pow(indices[i] - moyenneX, 2);
    }
    
    const pente = denominateur !== 0 ? numerateur / denominateur : 0;
    const intercept = moyenneY - pente * moyenneX;
    
    const previsions = [];
    for (let i = 1; i <= 3; i++) {
      const prevision = pente * (n + i - 1) + intercept;
      previsions.push({
        mois: new Date(new Date().setMonth(new Date().getMonth() + i)).toISOString().slice(0, 7),
        reservations_prevues: Math.max(0, Math.round(prevision)),
        confiance: n >= 6 ? 'MOYENNE' : 'FAIBLE'
      });
    }

    let recommandation = 'Tendance stable, maintenir les efforts actuels';
    if (pente > 10) recommandation = 'Prévoir augmentation de capacité, forte tendance à la hausse';
    else if (pente > 5) recommandation = 'Tendance positive, prévoir une légère augmentation de capacité';
    else if (pente < -5) recommandation = 'Action marketing urgente, tendance à la baisse';
    else if (pente < -2) recommandation = 'Légère baisse, surveiller et agir rapidement';

    res.json({
      success: true,
      historique: historique,
      previsions: previsions,
      analyse_tendance: {
        pente_mensuelle: formaterDecimal(pente, 1),
        coeff_determination: "0.00",
        recommandations: recommandation
      }
    });
  } catch (error) {
    console.error('Erreur previsions reservations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors du calcul des prévisions',
      error: error.message 
    });
  }
});

// ============================================
// 📊 ANALYSE ANNULATIONS
// ============================================

router.get('/analyse-annulations', async (req, res) => {
  try {
    const periodeJours = parseInt(req.query.jours) || 90;
    
    const result = await db.query(`
      SELECT 
        DATE_TRUNC('week', datereservation) as semaine,
        COUNT(*) as total_reservations,
        SUM(CASE WHEN statut = 'annulée' THEN 1 ELSE 0 END) as annulations,
        COUNT(DISTINCT email) as clients_uniques
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periodeJours} days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY DATE_TRUNC('week', datereservation)
      ORDER BY semaine DESC
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        periode: `${periodeJours} derniers jours`,
        message: 'Aucune donnée disponible pour cette période',
        taux_annulation_global: "0.00",
        evolution_hebdomadaire: [],
        recommandations: ['Aucune donnée disponible']
      });
    }

    const totalReservations = result.rows.reduce((sum, r) => sum + formaterNombre(r.total_reservations), 0);
    const totalAnnulations = result.rows.reduce((sum, r) => sum + formaterNombre(r.annulations || 0), 0);
    const tauxGlobal = calculerTaux(totalAnnulations, totalReservations);

    const evolutionHebdomadaire = result.rows.map(r => ({
      semaine: r.semaine,
      total_reservations: formaterNombre(r.total_reservations),
      annulations: formaterNombre(r.annulations || 0),
      taux_annulation: calculerTaux(r.annulations || 0, r.total_reservations),
      clients_uniques: formaterNombre(r.clients_uniques || 0)
    }));

    const dernierTaux = evolutionHebdomadaire[0]?.taux_annulation || "0.00";
    const precedentTaux = evolutionHebdomadaire[1]?.taux_annulation || "0.00";
    const evolutionTaux = calculerEvolution(dernierTaux, precedentTaux);

    let recommandations = [];
    if (parseFloat(tauxGlobal) > 20) {
      recommandations.push('Taux d\'annulation élevé (>20%), analyser les causes');
    } else if (parseFloat(tauxGlobal) > 15) {
      recommandations.push('Taux d\'annulation modéré, surveiller la tendance');
    } else {
      recommandations.push('Bon taux de confirmation des réservations');
    }

    if (evolutionTaux > 10) {
      recommandations.push('Augmentation des annulations, enquête nécessaire');
    }

    res.json({
      success: true,
      periode: `${periodeJours} derniers jours`,
      taux_annulation_global: tauxGlobal,
      evolution_taux_hebdomadaire: formaterDecimal(evolutionTaux, 1),
      evolution_hebdomadaire: evolutionHebdomadaire,
      recommandations: recommandations
    });
  } catch (error) {
    console.error('Erreur analyse annulations:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de l\'analyse des annulations',
      error: error.message 
    });
  }
});

// ============================================
// 📊 STATUT SERVEUR
// ============================================

router.get('/status', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// ============================================
// 📊 ROUTE DE TEST
// ============================================

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API d\'analyse de réservations fonctionnelle',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    endpoints_disponibles: [
      { path: '/dashboard-reservations', method: 'GET', params: ['?jours=30'] },
      { path: '/analyse-par-ville-quartier', method: 'GET', params: ['?jours=90'] },
      { path: '/analyse-par-sport-rentabilite', method: 'GET', params: ['?jours=90'] },
      { path: '/analyse-ville-sport', method: 'GET', params: ['?jours=90'] },
      { path: '/analyse-terrains-ville-quartier', method: 'GET', params: ['?jours=90'] },
      { path: '/analyse-horaire', method: 'GET', params: ['?jours=30'] },
      { path: '/analyse-par-type-terrain', method: 'GET', params: ['?jours=90'] },
      { path: '/evolution-mensuelle', method: 'GET', params: ['?mois=12'] },
      { path: '/analyse-clients-reservations', method: 'GET', params: ['?jours=180&limit=100'] },
      { path: '/comparaison-hebdomadaire', method: 'GET' },
      { path: '/previsions-reservations', method: 'GET', params: ['?mois=12'] },
      { path: '/analyse-annulations', method: 'GET', params: ['?jours=90'] },
      { path: '/status', method: 'GET' },
      { path: '/test', method: 'GET' }
    ],
    documentation: {
      base_url: '/api/analytics',
      description: "Tous les endpoints retournent du JSON avec un champ 'success'",
      note: "Seules les réservations avec les statuts 'confirmée', 'payé' ou 'terminée' sont prises en compte"
    }
  });
});

export default router;