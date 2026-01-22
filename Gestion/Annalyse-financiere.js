import { Router } from 'express';
import db from '../db.js'; // Assurez-vous que ce chemin correspond à votre configuration

const router = Router();

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

function calculerEvolution(valeurCourante, valeurReference) {
  if (!valeurReference || valeurReference === 0) return 0;
  return ((parseFloat(valeurCourante || 0) - parseFloat(valeurReference)) / parseFloat(valeurReference)) * 100;
}

function calculerTCAC(valeurDepart, valeurArrivee, nbAnnees) {
  if (!valeurDepart || valeurDepart === 0 || nbAnnees === 0) return 0;
  return (Math.pow(parseFloat(valeurArrivee) / parseFloat(valeurDepart), 1 / nbAnnees) - 1) * 100;
}

function formatterDonneesMois(donnees) {
  return {
    periode_affichage: donnees.periode_affichage || 'N/A',
    nombre_reservations: parseInt(donnees.nombre_reservations || 0),
    chiffre_affaires: parseFloat(donnees.chiffre_affaires || 0),
    tarif_moyen: parseFloat(donnees.tarif_moyen || 0),
    tarif_median: parseFloat(donnees.tarif_median || 0),
    tarif_min: parseFloat(donnees.tarif_min || 0),
    tarif_max: parseFloat(donnees.tarif_max || 0),
    heures_totales: parseFloat(donnees.heures_totales || 0),
    duree_moyenne: parseFloat(donnees.duree_moyenne || 0),
    terrains_utilises: parseInt(donnees.terrains_utilises || 0),
    clients_uniques: parseInt(donnees.clients_uniques || 0),
    jours_actifs: parseInt(donnees.jours_actifs || 0),
    tarif_horaire_moyen: parseFloat(donnees.tarif_horaire_moyen || 0),
    repartition_sports: {
      football: {
        clients: parseInt(donnees.clients_football || 0),
        ca: parseFloat(donnees.ca_football || 0)
      },
      basketball: {
        clients: parseInt(donnees.clients_basketball || 0),
        ca: parseFloat(donnees.ca_basketball || 0)
      },
      tennis: {
        clients: parseInt(donnees.clients_tennis || 0),
        ca: parseFloat(donnees.ca_tennis || 0)
      }
    }
  };
}

function analyserTendance(donnees) {
  if (donnees.length < 2) return null;
  
  const tendanceCA = [];
  const tendanceReservations = [];
  
  for (let i = 1; i < donnees.length; i++) {
    const evolution = calculerEvolution(
      donnees[i - 1].chiffre_affaires, 
      donnees[i].chiffre_affaires
    );
    tendanceCA.push(evolution);
    
    const evolutionRes = calculerEvolution(
      donnees[i - 1].nombre_reservations, 
      donnees[i].nombre_reservations
    );
    tendanceReservations.push(evolutionRes);
  }
  
  const moyenneCA = tendanceCA.reduce((a, b) => a + b, 0) / tendanceCA.length;
  const moyenneRes = tendanceReservations.reduce((a, b) => a + b, 0) / tendanceReservations.length;
  
  return {
    ca: {
      evolution_moyenne: moyenneCA,
      tendance: moyenneCA > 5 ? 'Forte croissance' : 
                moyenneCA > 0 ? 'Croissance modérée' : 
                moyenneCA > -5 ? 'Stagnation' : 'Déclin',
      volatilite: calculerEcartType(tendanceCA)
    },
    reservations: {
      evolution_moyenne: moyenneRes,
      tendance: moyenneRes > 5 ? 'Forte croissance' : 
                moyenneRes > 0 ? 'Croissance modérée' : 
                moyenneRes > -5 ? 'Stagnation' : 'Déclin',
      volatilite: calculerEcartType(tendanceReservations)
    }
  };
}

function calculerEcartType(tableau) {
  const moyenne = tableau.reduce((a, b) => a + b, 0) / tableau.length;
  const variance = tableau.reduce((sum, val) => sum + Math.pow(val - moyenne, 2), 0) / tableau.length;
  return Math.sqrt(variance);
}

function prevoir(donnees, anneeCible) {
  if (donnees.length < 2) return null;
  
  // Régression linéaire simple
  const x = donnees.map((d, i) => i);
  const y = donnees.map(d => parseFloat(d.chiffre_affaires));
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  const xPrevu = donnees.length;
  const caPrevu = slope * xPrevu + intercept;
  
  return {
    annee: anneeCible,
    ca_prevu: Math.round(caPrevu * 100) / 100,
    confiance: calculerR2(x, y, slope, intercept)
  };
}

function calculerR2(x, y, slope, intercept) {
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const ssResidual = x.reduce((sum, xi, i) => {
    const yPred = slope * xi + intercept;
    return sum + Math.pow(y[i] - yPred, 2);
  }, 0);
  
  const r2 = 1 - (ssResidual / ssTotal);
  return (r2 * 100).toFixed(2) + '%';
}

function calculerRetentionMoyenne(cohortes) {
  if (cohortes.length === 0) return {};
  
  const moyennes = {};
  ['mois_1', 'mois_2', 'mois_3', 'mois_4', 'mois_5', 'mois_6'].forEach(mois => {
    const valeurs = cohortes
      .map(c => parseFloat(c.taux_retention[mois]))
      .filter(v => !isNaN(v));
    moyennes[mois] = valeurs.length > 0 
      ? (valeurs.reduce((a, b) => a + b, 0) / valeurs.length).toFixed(2)
      : 0;
  });
  
  return moyennes;
}

function calculerVLCMoyenne(cohortes) {
  if (cohortes.length === 0) return 0;
  
  const vlcs = cohortes.map(c => c.valeur_vie_client.cumule);
  return vlcs.reduce((a, b) => a + b, 0) / vlcs.length;
}

function calculerConcentration(clients, top) {
  const caTotal = clients.reduce((sum, c) => sum + parseFloat(c.ca_total), 0);
  const caTopN = clients.slice(0, top).reduce((sum, c) => sum + parseFloat(c.ca_total), 0);
  return ((caTopN / caTotal) * 100).toFixed(2);
}

function calculerTauxActifs(clients) {
  const actifs = clients.filter(c => parseInt(c.recence_jours) <= 30).length;
  return ((actifs / clients.length) * 100).toFixed(2);
}

function interpreterElasticite(correlation) {
  if (correlation < -0.5) return 'Forte élasticité négative - Baisse de prix augmente fortement le volume';
  if (correlation < -0.2) return 'Élasticité négative modérée';
  if (correlation < 0.2) return 'Inélastique - Prix peu impact sur volume';
  if (correlation < 0.5) return 'Élasticité positive modérée - Prix premium accepté';
  return 'Forte élasticité positive - Prix élevé n\'impacte pas négativement';
}

// ============================================
// 📊 ANALYSES AVANCÉES SUPPLÉMENTAIRES
// ============================================

// 📊 Analyse de la qualité du portefeuille client
router.get('/analyse-qualite-portefeuille', async (req, res) => {
  try {
    const result = await db.query(`
      WITH client_metrics AS (
        SELECT 
          email,
          nomclient,
          prenom,
          COUNT(*) as nb_reservations,
          SUM(tarif) as ca_total,
          AVG(tarif) as panier_moyen,
          MAX(datereservation) - MIN(datereservation) as anciennete_jours,
          CURRENT_DATE - MAX(datereservation) as recence_jours,
          COUNT(DISTINCT DATE_TRUNC('month', datereservation)) as nb_mois_actifs,
          STDDEV(tarif) as volatilite_panier
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '365 days'
        GROUP BY email, nomclient, prenom
      )
      SELECT 
        *,
        -- Score RFM (Récence, Fréquence, Montant)
        NTILE(5) OVER (ORDER BY recence_jours DESC) as score_recence,
        NTILE(5) OVER (ORDER BY nb_reservations) as score_frequence,
        NTILE(5) OVER (ORDER BY ca_total) as score_montant,
        -- Fidélité
        CASE 
          WHEN nb_reservations >= 20 THEN 'Champion'
          WHEN nb_reservations >= 10 AND recence_jours <= 30 THEN 'Fidèle'
          WHEN nb_reservations >= 5 AND recence_jours <= 60 THEN 'Potentiel'
          WHEN recence_jours > 90 THEN 'À risque'
          ELSE 'Nouveau'
        END as categorie_fidelite,
        -- Valeur
        ca_total / NULLIF(nb_mois_actifs, 0) as ca_mensuel_moyen,
        ca_total / NULLIF(anciennete_jours, 0) * 365 as ca_annuel_projete
      FROM client_metrics
      ORDER BY ca_total DESC
    `);

    // Agrégations par catégorie
    const distribution = result.rows.reduce((acc, client) => {
      const cat = client.categorie_fidelite;
      if (!acc[cat]) {
        acc[cat] = { 
          count: 0, 
          ca_total: 0, 
          ca_moyen: 0, 
          nb_reservations_total: 0 
        };
      }
      acc[cat].count++;
      acc[cat].ca_total += parseFloat(client.ca_total);
      acc[cat].nb_reservations_total += parseInt(client.nb_reservations);
      return acc;
    }, {});

    Object.keys(distribution).forEach(cat => {
      distribution[cat].ca_moyen = distribution[cat].ca_total / distribution[cat].count;
      distribution[cat].part_clients = (distribution[cat].count / result.rows.length * 100).toFixed(2);
      distribution[cat].part_ca = (distribution[cat].ca_total / result.rows.reduce((sum, c) => sum + parseFloat(c.ca_total), 0) * 100).toFixed(2);
    });

    res.json({
      success: true,
      data: {
        clients_detailles: result.rows.map(c => ({
          ...c,
          ca_total: parseFloat(c.ca_total || 0),
          panier_moyen: parseFloat(c.panier_moyen || 0),
          ca_mensuel_moyen: parseFloat(c.ca_mensuel_moyen || 0),
          ca_annuel_projete: parseFloat(c.ca_annuel_projete || 0),
          volatilite_panier: parseFloat(c.volatilite_panier || 0)
        })),
        distribution_fidelite: distribution,
        indicateurs_portefeuille: {
          concentration_top10: calculerConcentration(result.rows, 10),
          concentration_top20: calculerConcentration(result.rows, 20),
          taux_clients_actifs: calculerTauxActifs(result.rows),
          valeur_portefeuille_totale: result.rows.reduce((sum, c) => sum + parseFloat(c.ca_total), 0)
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse qualité portefeuille:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 📊 Analyse de l'élasticité des prix
router.get('/analyse-elasticite-prix', async (req, res) => {
  try {
    const result = await db.query(`
      WITH prix_volume AS (
        SELECT 
          DATE_TRUNC('week', datereservation) as semaine,
          typeterrain,
          AVG(tarif) as prix_moyen,
          COUNT(*) as volume,
          SUM(tarif) as ca
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('week', datereservation), typeterrain
        HAVING COUNT(*) >= 3
      )
      SELECT 
        typeterrain,
        CORR(prix_moyen, volume) as correlation_prix_volume,
        AVG(prix_moyen) as prix_moyen_global,
        STDDEV(prix_moyen) as volatilite_prix,
        AVG(volume) as volume_moyen,
        STDDEV(volume) as volatilite_volume
      FROM prix_volume
      GROUP BY typeterrain
    `);

    res.json({
      success: true,
      data: result.rows.map(r => ({
        ...r,
        correlation_prix_volume: parseFloat(r.correlation_prix_volume || 0),
        prix_moyen_global: parseFloat(r.prix_moyen_global || 0),
        volatilite_prix: parseFloat(r.volatilite_prix || 0),
        volume_moyen: parseFloat(r.volume_moyen || 0),
        volatilite_volume: parseFloat(r.volatilite_volume || 0),
        interpretation: interpreterElasticite(parseFloat(r.correlation_prix_volume || 0))
      }))
    });
  } catch (error) {
    console.error('❌ Erreur analyse élasticité prix:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 📊 Tableau de bord exécutif complet
router.get('/tableau-bord-executif', async (req, res) => {
  try {
    const [kpiPrincipaux, performance, sante, opportunites] = await Promise.all([
      // KPI Principaux
      db.query(`
        SELECT 
          COUNT(*) as total_reservations,
          SUM(tarif) as ca_total,
          AVG(tarif) as panier_moyen,
          COUNT(DISTINCT email) as clients_uniques,
          COUNT(DISTINCT numeroterrain) as terrains_actifs,
          SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_vendues
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      `),
      
      // Performance vs objectifs
      db.query(`
        WITH objectifs AS (
          SELECT 
            50000 as objectif_ca_mensuel,
            200 as objectif_reservations_mensuelles,
            100 as objectif_nouveaux_clients_mensuels
        ),
        realisations AS (
          SELECT 
            SUM(tarif) as ca_realise,
            COUNT(*) as reservations_realisees,
            COUNT(DISTINCT CASE 
              WHEN datereservation >= CURRENT_DATE - INTERVAL '30 days' 
              THEN email 
            END) as nouveaux_clients
          FROM reservation
          WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        )
        SELECT 
          o.objectif_ca_mensuel,
          r.ca_realise,
          (r.ca_realise / o.objectif_ca_mensuel * 100) as taux_realisation_ca,
          o.objectif_reservations_mensuelles,
          r.reservations_realisees,
          (r.reservations_realisees / o.objectif_reservations_mensuelles * 100) as taux_realisation_reservations
        FROM objectifs o, realisations r
      `),
      
      // Santé financière
      db.query(`
        WITH mois_courant AS (
          SELECT SUM(tarif) as ca FROM reservation
          WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE)
        ),
        mois_precedent AS (
          SELECT SUM(tarif) as ca FROM reservation
          WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        ),
        annee_precedente AS (
          SELECT SUM(tarif) as ca FROM reservation
          WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 year')
        )
        SELECT 
          mc.ca as ca_mois_courant,
          mp.ca as ca_mois_precedent,
          ap.ca as ca_meme_mois_n1,
          (mc.ca - mp.ca) / NULLIF(mp.ca, 0) * 100 as croissance_mom,
          (mc.ca - ap.ca) / NULLIF(ap.ca, 0) * 100 as croissance_yoy
        FROM mois_courant mc, mois_precedent mp, annee_precedente ap
      `),
      
      // Opportunités et alertes
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          COUNT(*) as nb_reservations_30j,
          SUM(tarif) as ca_30j,
          (SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) / (30 * 12) * 100) as taux_occupation
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain, nomterrain
        HAVING (SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) / (30 * 12) * 100) < 40
        ORDER BY taux_occupation ASC
      `)
    ]);

    res.json({
      success: true,
      data: {
        kpi_principaux: {
          ...kpiPrincipaux.rows[0],
          ca_total: parseFloat(kpiPrincipaux.rows[0].ca_total || 0),
          panier_moyen: parseFloat(kpiPrincipaux.rows[0].panier_moyen || 0),
          heures_vendues: parseFloat(kpiPrincipaux.rows[0].heures_vendues || 0),
          revenu_par_heure: parseFloat(kpiPrincipaux.rows[0].ca_total || 0) / parseFloat(kpiPrincipaux.rows[0].heures_vendues || 1)
        },
        performance_vs_objectifs: performance.rows[0] ? {
          ...performance.rows[0],
          ca_realise: parseFloat(performance.rows[0].ca_realise || 0),
          taux_realisation_ca: parseFloat(performance.rows[0].taux_realisation_ca || 0),
          taux_realisation_reservations: parseFloat(performance.rows[0].taux_realisation_reservations || 0)
        } : {},
        sante_financiere: sante.rows[0] ? {
          ...sante.rows[0],
          ca_mois_courant: parseFloat(sante.rows[0].ca_mois_courant || 0),
          ca_mois_precedent: parseFloat(sante.rows[0].ca_mois_precedent || 0),
          ca_meme_mois_n1: parseFloat(sante.rows[0].ca_meme_mois_n1 || 0),
          croissance_mom: parseFloat(sante.rows[0].croissance_mom || 0),
          croissance_yoy: parseFloat(sante.rows[0].croissance_yoy || 0)
        } : {},
        alertes_opportunites: {
          terrains_sous_utilises: opportunites.rows.map(t => ({
            ...t,
            ca_30j: parseFloat(t.ca_30j || 0),
            taux_occupation: parseFloat(t.taux_occupation || 0)
          }))
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erreur tableau de bord exécutif:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// ROUTES PRINCIPALES D'ANALYSE FINANCIÈRE
// ============================================

// 📈 Analyse financière par mois
router.get('/analyse-mensuelle/:annee?', async (req, res) => {
  try {
    const annee = req.params.annee || new Date().getFullYear();
    
    const result = await db.query(`
      SELECT 
        DATE_TRUNC('month', datereservation) as periode,
        TO_CHAR(DATE_TRUNC('month', datereservation), 'YYYY-MM') as periode_affichage,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tarif) as tarif_median,
        MIN(tarif) as tarif_min,
        MAX(tarif) as tarif_max,
        SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_totales,
        AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne,
        COUNT(DISTINCT numeroterrain) as terrains_utilises,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(DISTINCT DATE(datereservation)) as jours_actifs,
        SUM(tarif) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as tarif_horaire_moyen,
        COUNT(DISTINCT CASE WHEN typeterrain ILIKE '%foot%' THEN email END) as clients_football,
        SUM(CASE WHEN typeterrain ILIKE '%foot%' THEN tarif ELSE 0 END) as ca_football,
        COUNT(DISTINCT CASE WHEN typeterrain ILIKE '%basket%' THEN email END) as clients_basketball,
        SUM(CASE WHEN typeterrain ILIKE '%basket%' THEN tarif ELSE 0 END) as ca_basketball,
        COUNT(DISTINCT CASE WHEN typeterrain ILIKE '%tennis%' THEN email END) as clients_tennis,
        SUM(CASE WHEN typeterrain ILIKE '%tennis%' THEN tarif ELSE 0 END) as ca_tennis
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND EXTRACT(YEAR FROM datereservation) = $1
      GROUP BY DATE_TRUNC('month', datereservation)
      ORDER BY periode ASC
    `, [annee]);

    const donneesFormatees = result.rows.map(row => formatterDonneesMois(row));
    const tendance = analyserTendance(donneesFormatees);

    res.json({
      success: true,
      annee: annee,
      donnees: donneesFormatees,
      analyses: {
        tendance: tendance,
        resume_annuel: {
          ca_total: donneesFormatees.reduce((sum, mois) => sum + mois.chiffre_affaires, 0),
          reservations_total: donneesFormatees.reduce((sum, mois) => sum + mois.nombre_reservations, 0),
          clients_total: donneesFormatees.reduce((sum, mois) => sum + mois.clients_uniques, 0),
          meilleur_mois: donneesFormatees.reduce((max, mois) => 
            mois.chiffre_affaires > max.chiffre_affaires ? mois : max
          , { chiffre_affaires: 0 })
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse mensuelle:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 📊 Analyse par terrain
router.get('/analyse-par-terrain', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        t.numeroterrain,
        t.nomterrain,
        t.typeterrain,
        COUNT(r.id) as nombre_reservations,
        SUM(r.tarif) as chiffre_affaires,
        AVG(r.tarif) as tarif_moyen,
        SUM(EXTRACT(EPOCH FROM (r.heurefin - r.heurereservation))/3600) as heures_utilisees,
        COUNT(DISTINCT r.email) as clients_uniques,
        COUNT(DISTINCT DATE(r.datereservation)) as jours_actifs,
        (SUM(EXTRACT(EPOCH FROM (r.heurefin - r.heurereservation))/3600) / (24 * 30)) * 100 as taux_occupation,
        AVG(EXTRACT(EPOCH FROM (r.heurefin - r.heurereservation))/3600) as duree_moyenne,
        MIN(r.tarif) as tarif_min,
        MAX(r.tarif) as tarif_max,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r.tarif) as tarif_median,
        t.tarifhoraire as tarif_horaire_standard
      FROM terrain t
      LEFT JOIN reservation r ON t.numeroterrain = r.numeroterrain 
        AND r.statut IN ('confirmée', 'payé', 'terminée')
        AND r.datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY t.numeroterrain, t.nomterrain, t.typeterrain, t.tarifhoraire
      ORDER BY chiffre_affaires DESC NULLS LAST
    `);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        ...row,
        nombre_reservations: parseInt(row.nombre_reservations || 0),
        chiffre_affaires: parseFloat(row.chiffre_affaires || 0),
        tarif_moyen: parseFloat(row.tarif_moyen || 0),
        heures_utilisees: parseFloat(row.heures_utilisees || 0),
        clients_uniques: parseInt(row.clients_uniques || 0),
        jours_actifs: parseInt(row.jours_actifs || 0),
        taux_occupation: parseFloat(row.taux_occupation || 0),
        duree_moyenne: parseFloat(row.duree_moyenne || 0),
        tarif_min: parseFloat(row.tarif_min || 0),
        tarif_max: parseFloat(row.tarif_max || 0),
        tarif_median: parseFloat(row.tarif_median || 0),
        tarif_horaire_standard: parseFloat(row.tarif_horaire_standard || 0),
        revenu_par_heure: parseFloat(row.chiffre_affaires || 0) / parseFloat(row.heures_utilisees || 1),
        rentabilite: parseFloat(row.chiffre_affaires || 0) > 0 ? 
          (parseFloat(row.chiffre_affaires || 0) / (parseFloat(row.heures_utilisees || 0) * parseFloat(row.tarif_horaire_standard || 1)) * 100).toFixed(2) : 0
      }))
    });
  } catch (error) {
    console.error('❌ Erreur analyse par terrain:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 📈 Prévisions financières
router.get('/previsions', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datereservation) as annee,
        SUM(tarif) as chiffre_affaires
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY EXTRACT(YEAR FROM datereservation)
      ORDER BY annee ASC
    `);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: 'Données insuffisantes pour les prévisions',
        donnees: []
      });
    }

    const derniereAnnee = Math.max(...result.rows.map(r => parseInt(r.annee)));
    const prochaineAnnee = derniereAnnee + 1;
    
    const prevision = prevoir(result.rows, prochaineAnnee);

    res.json({
      success: true,
      donnees_historiques: result.rows.map(r => ({
        annee: parseInt(r.annee),
        chiffre_affaires: parseFloat(r.chiffre_affaires)
      })),
      previsions: prevision ? [prevision] : [],
      analyse_tendance: analyserTendance(result.rows.map(r => ({
        chiffre_affaires: parseFloat(r.chiffre_affaires)
      })))
    });
  } catch (error) {
    console.error('❌ Erreur prévisions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 👥 Analyse de cohorte clients
router.get('/analyse-cohortes', async (req, res) => {
  try {
    const result = await db.query(`
      WITH premier_achat AS (
        SELECT 
          email,
          MIN(DATE_TRUNC('month', datereservation)) as premier_mois
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY email
      ),
      reservations_par_mois AS (
        SELECT 
          email,
          DATE_TRUNC('month', datereservation) as mois,
          COUNT(*) as nb_reservations,
          SUM(tarif) as ca_mois
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY email, DATE_TRUNC('month', datereservation)
      ),
      cohortes AS (
        SELECT 
          DATE_TRUNC('month', premier_mois) as cohorte_mois,
          COUNT(DISTINCT email) as cohorte_size,
          -- Retentions par mois
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', mois) = DATE_TRUNC('month', premier_mois) 
            THEN email 
          END) as mois_0,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', mois) = DATE_TRUNC('month', premier_mois + INTERVAL '1 month')
            THEN email 
          END) as mois_1,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', mois) = DATE_TRUNC('month', premier_mois + INTERVAL '2 months')
            THEN email 
          END) as mois_2,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', mois) = DATE_TRUNC('month', premier_mois + INTERVAL '3 months')
            THEN email 
          END) as mois_3,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', mois) = DATE_TRUNC('month', premier_mois + INTERVAL '4 months')
            THEN email 
          END) as mois_4,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', mois) = DATE_TRUNC('month', premier_mois + INTERVAL '5 months')
            THEN email 
          END) as mois_5,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', mois) = DATE_TRUNC('month', premier_mois + INTERVAL '6 months')
            THEN email 
          END) as mois_6
        FROM premier_achat pa
        LEFT JOIN reservations_par_mois rpm ON pa.email = rpm.email
        WHERE premier_mois >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', premier_mois)
      )
      SELECT 
        cohorte_mois,
        cohorte_size,
        mois_0,
        mois_1,
        mois_2,
        mois_3,
        mois_4,
        mois_5,
        mois_6,
        ROUND((mois_1::DECIMAL / NULLIF(mois_0, 0) * 100), 2) as retention_mois_1,
        ROUND((mois_2::DECIMAL / NULLIF(mois_0, 0) * 100), 2) as retention_mois_2,
        ROUND((mois_3::DECIMAL / NULLIF(mois_0, 0) * 100), 2) as retention_mois_3,
        ROUND((mois_4::DECIMAL / NULLIF(mois_0, 0) * 100), 2) as retention_mois_4,
        ROUND((mois_5::DECIMAL / NULLIF(mois_0, 0) * 100), 2) as retention_mois_5,
        ROUND((mois_6::DECIMAL / NULLIF(mois_0, 0) * 100), 2) as retention_mois_6
      FROM cohortes
      ORDER BY cohorte_mois DESC
    `);

    const cohortesAvecCalculs = result.rows.map(cohorte => {
      const tauxRetention = {
        mois_1: parseFloat(cohorte.retention_mois_1 || 0),
        mois_2: parseFloat(cohorte.retention_mois_2 || 0),
        mois_3: parseFloat(cohorte.retention_mois_3 || 0),
        mois_4: parseFloat(cohorte.retention_mois_4 || 0),
        mois_5: parseFloat(cohorte.retention_mois_5 || 0),
        mois_6: parseFloat(cohorte.retention_mois_6 || 0)
      };

      // Calcul CLV (Customer Lifetime Value) simplifié
      const caMoyenParMois = 100; // À remplacer par votre calcul réel
      const vieClientMois = Object.values(tauxRetention).reduce((a, b) => a + b, 0) / 100;
      const clv = caMoyenParMois * vieClientMois;

      return {
        cohorte_mois: cohorte.cohorte_mois,
        taille_cohorte: parseInt(cohorte.cohorte_size),
        taux_retention: tauxRetention,
        valeur_vie_client: {
          ca_moyen_mensuel: caMoyenParMois,
          duree_vie_moyenne_mois: vieClientMois.toFixed(2),
          valeur_totale: clv.toFixed(2),
          cumule: parseFloat(clv.toFixed(2))
        }
      };
    });

    res.json({
      success: true,
      data: {
        cohortes: cohortesAvecCalculs,
        indicateurs: {
          retention_moyenne: calculerRetentionMoyenne(cohortesAvecCalculs),
          valeur_vie_client_moyenne: calculerVLCMoyenne(cohortesAvecCalculs),
          taux_attrition_moyen: ((100 - (cohortesAvecCalculs.reduce((sum, c) => 
            sum + c.taux_retention.mois_6, 0) / cohortesAvecCalculs.length)).toFixed(2))
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse cohortes:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;