import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ============================================
// FONCTIONS UTILITAIRES OPTIMISÉES
// ============================================

function calculerEvolution(valeurCourante, valeurReference) {
  if (!valeurReference || valeurReference === 0) return 0;
  return ((parseFloat(valeurCourante || 0) - parseFloat(valeurReference)) / parseFloat(valeurReference)) * 100;
}

function calculerTCAC(valeurDepart, valeurArrivee, nbAnnees) {
  if (!valeurDepart || valeurDepart === 0 || nbAnnees === 0) return 0;
  const ratio = parseFloat(valeurArrivee) / parseFloat(valeurDepart);
  return (Math.pow(ratio, 1 / nbAnnees) - 1) * 100;
}

function calculerConcentration(clients, top) {
  if (!clients || clients.length === 0) return "0.00";
  const caTotal = clients.reduce((sum, c) => sum + parseFloat(c.ca_total || 0), 0);
  const caTopN = clients.slice(0, Math.min(top, clients.length)).reduce((sum, c) => sum + parseFloat(c.ca_total || 0), 0);
  return ((caTopN / caTotal) * 100).toFixed(2);
}

function interpreterElasticite(correlation) {
  const corr = parseFloat(correlation || 0);
  if (corr < -0.5) return 'Forte élasticité négative';
  if (corr < -0.2) return 'Élasticité négative modérée';
  if (corr < 0.2) return 'Inélastique';
  if (corr < 0.5) return 'Élasticité positive modérée';
  return 'Forte élasticité positive';
}

// ============================================
// ROUTES OPTIMISÉES SANS TIMEOUT
// ============================================

// 📊 Analyse par terrain - VERSION OPTIMISÉE
router.get('/analyse-par-terrain', async (req, res) => {
  try {
    // Limiter à 30 jours pour éviter timeout
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_utilisees,
        COUNT(DISTINCT email) as clients_uniques
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY chiffre_affaires DESC
      LIMIT 20
    `);

    const data = result.rows.map(row => ({
      numeroterrain: row.numeroterrain,
      nomterrain: row.nomterrain,
      typeterrain: row.typeterrain,
      nombre_reservations: parseInt(row.nombre_reservations || 0),
      chiffre_affaires: parseFloat(row.chiffre_affaires || 0),
      tarif_moyen: parseFloat(row.tarif_moyen || 0),
      heures_utilisees: parseFloat(row.heures_utilisees || 0),
      clients_uniques: parseInt(row.clients_uniques || 0),
      revenu_par_heure: parseFloat(row.heures_utilisees || 0) > 0 
        ? parseFloat(row.chiffre_affaires || 0) / parseFloat(row.heures_utilisees || 0)
        : 0,
      taux_occupation: parseFloat(row.heures_utilisees || 0) / (30 * 12) * 100
    }));

    res.json({
      success: true,
      data: data,
      resume: {
        total_terrains: data.length,
        total_ca: data.reduce((sum, t) => sum + t.chiffre_affaires, 0),
        total_heures: data.reduce((sum, t) => sum + t.heures_utilisees, 0),
        moyenne_occupation: data.reduce((sum, t) => sum + t.taux_occupation, 0) / data.length
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse par terrain:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur',
      detail: error.message.substring(0, 100) 
    });
  }
});

// 📊 Tableau de bord exécutif - VERSION OPTIMISÉE
router.get('/tableau-bord-executif', async (req, res) => {
  try {
    // Utiliser des sous-requêtes parallèles mais simples
    const [kpi, croissance, terrains] = await Promise.all([
      // KPI Principaux (30 jours)
      db.query(`
        SELECT 
          COUNT(*) as reservations_30j,
          SUM(tarif) as ca_30j,
          AVG(tarif) as panier_moyen,
          COUNT(DISTINCT email) as clients_uniques,
          SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_vendues
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      `),
      
      // Croissance vs mois précédent
      db.query(`
        SELECT 
          EXTRACT(MONTH FROM CURRENT_DATE) as mois_courant,
          SUM(CASE 
            WHEN DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE)
            THEN tarif ELSE 0 
          END) as ca_mois_courant,
          SUM(CASE 
            WHEN DATE_TRUNC('month', datereservation) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
            THEN tarif ELSE 0 
          END) as ca_mois_precedent
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
      `),
      
      // Top 5 terrains
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          COUNT(*) as reservations,
          SUM(tarif) as ca
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain, nomterrain
        ORDER BY ca DESC
        LIMIT 5
      `)
    ]);

    const kpiData = kpi.rows[0] || {};
    const croissanceData = croissance.rows[0] || {};
    
    // Calculer l'évolution
    const evolution = croissanceData.ca_mois_precedent > 0 
      ? ((croissanceData.ca_mois_courant - croissanceData.ca_mois_precedent) / croissanceData.ca_mois_precedent * 100)
      : 0;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      kpi_principaux: {
        reservations_30j: parseInt(kpiData.reservations_30j || 0),
        ca_30j: parseFloat(kpiData.ca_30j || 0),
        panier_moyen: parseFloat(kpiData.panier_moyen || 0),
        clients_uniques: parseInt(kpiData.clients_uniques || 0),
        heures_vendues: parseFloat(kpiData.heures_vendues || 0),
        revenu_par_heure: parseFloat(kpiData.heures_vendues || 0) > 0
          ? parseFloat(kpiData.ca_30j || 0) / parseFloat(kpiData.heures_vendues || 0)
          : 0
      },
      croissance: {
        mois_courant: parseFloat(croissanceData.ca_mois_courant || 0),
        mois_precedent: parseFloat(croissanceData.ca_mois_precedent || 0),
        evolution_percentage: evolution,
        tendance: evolution > 10 ? 'FORTE CROISSANCE' :
                 evolution > 0 ? 'CROISSANCE' :
                 evolution > -10 ? 'STABLE' : 'DÉCLIN'
      },
      top_terrains: terrains.rows.map(t => ({
        terrain: t.nomterrain,
        reservations: parseInt(t.reservations || 0),
        ca: parseFloat(t.ca || 0)
      })),
      alertes: evolution < 0 ? ['Attention: baisse du CA mensuel'] : []
    });
  } catch (error) {
    console.error('❌ Erreur tableau de bord exécutif:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// 📊 Analyse mensuelle - VERSION OPTIMISÉE
router.get('/analyse-mensuelle', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', datereservation), 'YYYY-MM') as periode,
        COUNT(*) as reservations,
        SUM(tarif) as ca,
        AVG(tarif) as panier_moyen,
        COUNT(DISTINCT email) as clients_uniques,
        SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_vendues
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', datereservation)
      ORDER BY DATE_TRUNC('month', datereservation) DESC
      LIMIT 12
    `);

    const data = result.rows.map(row => ({
      periode: row.periode,
      reservations: parseInt(row.reservations || 0),
      ca: parseFloat(row.ca || 0),
      panier_moyen: parseFloat(row.panier_moyen || 0),
      clients_uniques: parseInt(row.clients_uniques || 0),
      heures_vendues: parseFloat(row.heures_vendues || 0),
      revenu_par_heure: parseFloat(row.heures_vendues || 0) > 0
        ? parseFloat(row.ca || 0) / parseFloat(row.heures_vendues || 0)
        : 0
    }));

    // Calculer les tendances
    let tendance = 'STABLE';
    if (data.length >= 2) {
      const evolution = calculerEvolution(data[0].ca, data[1].ca);
      if (evolution > 10) tendance = 'FORTE CROISSANCE';
      else if (evolution > 0) tendance = 'CROISSANCE';
      else if (evolution < -10) tendance = 'FORT DÉCLIN';
      else if (evolution < 0) tendance = 'DÉCLIN';
    }

    res.json({
      success: true,
      periode_couverte: '12 derniers mois',
      donnees: data,
      resume: {
        total_ca: data.reduce((sum, m) => sum + m.ca, 0),
        total_reservations: data.reduce((sum, m) => sum + m.reservations, 0),
        moyenne_mensuelle_ca: data.reduce((sum, m) => sum + m.ca, 0) / data.length,
        tendance: tendance,
        meilleur_mois: data.reduce((max, m) => m.ca > max.ca ? m : max, { ca: 0 })
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse mensuelle:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// 📊 Analyse cohortes - VERSION CORRIGÉE
router.get('/analyse-cohortes', async (req, res) => {
  try {
    const result = await db.query(`
      WITH premier_achat AS (
        SELECT 
          r.email,
          MIN(DATE_TRUNC('month', r.datereservation)) as premier_mois
        FROM reservation r
        WHERE r.statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY r.email
      ),
      cohortes_base AS (
        SELECT 
          DATE_TRUNC('month', pa.premier_mois) as cohorte_mois,
          COUNT(DISTINCT pa.email) as cohorte_size
        FROM premier_achat pa
        WHERE pa.premier_mois >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', pa.premier_mois)
      ),
      retention AS (
        SELECT 
          DATE_TRUNC('month', pa.premier_mois) as cohorte_mois,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', r.datereservation) = DATE_TRUNC('month', pa.premier_mois + INTERVAL '1 month')
            THEN r.email 
          END) as retention_mois_1,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', r.datereservation) = DATE_TRUNC('month', pa.premier_mois + INTERVAL '2 months')
            THEN r.email 
          END) as retention_mois_2,
          COUNT(DISTINCT CASE 
            WHEN DATE_TRUNC('month', r.datereservation) = DATE_TRUNC('month', pa.premier_mois + INTERVAL '3 months')
            THEN r.email 
          END) as retention_mois_3
        FROM premier_achat pa
        LEFT JOIN reservation r ON pa.email = r.email 
          AND r.statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY DATE_TRUNC('month', pa.premier_mois)
      )
      SELECT 
        cb.cohorte_mois,
        cb.cohorte_size,
        COALESCE(r.retention_mois_1, 0) as retention_mois_1,
        COALESCE(r.retention_mois_2, 0) as retention_mois_2,
        COALESCE(r.retention_mois_3, 0) as retention_mois_3
      FROM cohortes_base cb
      LEFT JOIN retention r ON cb.cohorte_mois = r.cohorte_mois
      ORDER BY cb.cohorte_mois DESC
    `);

    const cohortes = result.rows.map(row => ({
      cohorte_mois: row.cohorte_mois,
      taille: parseInt(row.cohorte_size || 0),
      retention: {
        mois_1: row.cohorte_size > 0 ? (row.retention_mois_1 / row.cohorte_size * 100).toFixed(2) : "0.00",
        mois_2: row.cohorte_size > 0 ? (row.retention_mois_2 / row.cohorte_size * 100).toFixed(2) : "0.00",
        mois_3: row.cohorte_size > 0 ? (row.retention_mois_3 / row.cohorte_size * 100).toFixed(2) : "0.00"
      }
    }));

    res.json({
      success: true,
      data: {
        cohortes: cohortes,
        indicateurs: {
          retention_moyenne_mois1: cohortes.length > 0 
            ? (cohortes.reduce((sum, c) => sum + parseFloat(c.retention.mois_1), 0) / cohortes.length).toFixed(2)
            : "0.00",
          retention_moyenne_mois3: cohortes.length > 0 
            ? (cohortes.reduce((sum, c) => sum + parseFloat(c.retention.mois_3), 0) / cohortes.length).toFixed(2)
            : "0.00"
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse cohortes:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur',
      detail: error.message 
    });
  }
});

// 📊 Prévisions - VERSION SIMPLIFIÉE
router.get('/previsions', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datereservation) as annee,
        SUM(tarif) as chiffre_affaires
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND EXTRACT(YEAR FROM datereservation) >= EXTRACT(YEAR FROM CURRENT_DATE) - 3
      GROUP BY EXTRACT(YEAR FROM datereservation)
      ORDER BY annee ASC
    `);

    if (result.rows.length < 2) {
      return res.json({
        success: true,
        message: 'Données insuffisantes pour les prévisions',
        donnees: result.rows
      });
    }

    const donnees = result.rows.map(r => ({
      annee: parseInt(r.annee),
      ca: parseFloat(r.chiffre_affaires)
    }));

    // Calcul de prévision simple (linéaire)
    const derniereAnnee = donnees[donnees.length - 1].annee;
    const croissanceMoyenne = donnees.length > 1 
      ? (donnees[donnees.length - 1].ca - donnees[0].ca) / donnees[0].ca * 100 / (donnees.length - 1)
      : 10; // 10% par défaut

    const previsions = [];
    for (let i = 1; i <= 2; i++) {
      const anneeProjete = derniereAnnee + i;
      const caProjete = donnees[donnees.length - 1].ca * (1 + croissanceMoyenne / 100);
      
      previsions.push({
        annee: anneeProjete,
        ca_prevu: Math.round(caProjete),
        croissance_estimee: croissanceMoyenne.toFixed(2),
        confiance: croissanceMoyenne > 15 ? 'ÉLEVÉE' : 
                  croissanceMoyenne > 5 ? 'MOYENNE' : 'FAIBLE'
      });
    }

    res.json({
      success: true,
      historique: donnees,
      previsions: previsions,
      analyse: {
        croissance_moyenne: croissanceMoyenne.toFixed(2),
        tendance: croissanceMoyenne > 15 ? 'FORTE CROISSANCE' :
                  croissanceMoyenne > 5 ? 'CROISSANCE MODÉRÉE' :
                  croissanceMoyenne > 0 ? 'CROISSANCE LENTE' : 'STAGNATION'
      }
    });
  } catch (error) {
    console.error('❌ Erreur prévisions:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// 📊 Analyse qualité portefeuille - VERSION OPTIMISÉE
router.get('/analyse-qualite-portefeuille', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        email,
        COUNT(*) as nb_reservations,
        SUM(tarif) as ca_total,
        AVG(tarif) as panier_moyen,
        MAX(datereservation) - MIN(datereservation) as anciennete_jours,
        CURRENT_DATE - MAX(datereservation) as recence_jours
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '180 days'
      GROUP BY email
      ORDER BY ca_total DESC
      LIMIT 100
    `);

    const clients = result.rows.map(c => {
      const nbReservations = parseInt(c.nb_reservations || 0);
      const recenceJours = parseInt(c.recence_jours || 999);
      
      let categorie = 'Nouveau';
      if (nbReservations >= 10) categorie = 'Champion';
      else if (nbReservations >= 5 && recenceJours <= 30) categorie = 'Fidèle';
      else if (nbReservations >= 2 && recenceJours <= 60) categorie = 'Potentiel';
      else if (recenceJours > 90) categorie = 'À risque';

      return {
        email: c.email,
        nb_reservations: nbReservations,
        ca_total: parseFloat(c.ca_total || 0),
        panier_moyen: parseFloat(c.panier_moyen || 0),
        anciennete_jours: parseInt(c.anciennete_jours || 0),
        recence_jours: recenceJours,
        categorie: categorie
      };
    });

    // Calcul des distributions
    const distribution = clients.reduce((acc, client) => {
      const cat = client.categorie;
      if (!acc[cat]) {
        acc[cat] = { count: 0, ca_total: 0 };
      }
      acc[cat].count++;
      acc[cat].ca_total += client.ca_total;
      return acc;
    }, {});

    Object.keys(distribution).forEach(cat => {
      distribution[cat].part_clients = clients.length > 0 
        ? (distribution[cat].count / clients.length * 100).toFixed(2) 
        : "0.00";
      const totalCA = clients.reduce((sum, c) => sum + c.ca_total, 0);
      distribution[cat].part_ca = totalCA > 0 
        ? (distribution[cat].ca_total / totalCA * 100).toFixed(2) 
        : "0.00";
    });

    res.json({
      success: true,
      data: {
        clients_detailles: clients,
        distribution_categories: distribution,
        indicateurs: {
          nombre_clients_total: clients.length,
          ca_total_portefeuille: clients.reduce((sum, c) => sum + c.ca_total, 0),
          concentration_top10: calculerConcentration(clients, 10),
          concentration_top20: calculerConcentration(clients, 20),
          taux_clients_actifs: clients.filter(c => c.recence_jours <= 30).length / clients.length * 100
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse qualité portefeuille:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// 📊 Analyse élasticité prix - VERSION SIMPLIFIÉE
router.get('/analyse-elasticite-prix', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        typeterrain,
        AVG(tarif) as prix_moyen,
        COUNT(*) as volume,
        SUM(tarif) as ca_total
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY typeterrain
      ORDER BY ca_total DESC
    `);

    const data = result.rows.map(r => ({
      typeterrain: r.typeterrain,
      prix_moyen: parseFloat(r.prix_moyen || 0),
      volume: parseInt(r.volume || 0),
      ca_total: parseFloat(r.ca_total || 0),
      prix_par_volume: parseFloat(r.volume || 0) > 0 
        ? parseFloat(r.prix_moyen || 0) / parseInt(r.volume || 1)
        : 0
    }));

    // Pour l'élasticité, on compare les prix moyens avec les volumes
    // Note: Ceci est une simplification car on ne peut pas calculer la corrélation sans données temporelles détaillées
    const elasticiteEstimations = data.map(item => {
      let elasticite = 'INCONNU';
      if (item.prix_moyen > 50 && item.volume < 10) elasticite = 'ÉLASTIQUE';
      else if (item.prix_moyen > 30 && item.volume > 20) elasticite = 'INÉLASTIQUE';
      else if (item.prix_par_volume < 2) elasticite = 'TRÈS ÉLASTIQUE';
      
      return {
        ...item,
        elasticite_estimee: elasticite
      };
    });

    res.json({
      success: true,
      data: elasticiteEstimations,
      note: "L'élasticité est estimée à partir des moyennes. Pour une analyse précise, plus de données temporelles sont nécessaires."
    });
  } catch (error) {
    console.error('❌ Erreur analyse élasticité prix:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// ============================================
// NOUVELLES ROUTES OPTIMISÉES
// ============================================

// 📈 Analyse hebdomadaire comparative
router.get('/analyse-hebdomadaire', async (req, res) => {
  try {
    const result = await db.query(`
      WITH 
      semaine_courante AS (
        SELECT 
          COUNT(*) as reservations,
          SUM(tarif) as ca,
          AVG(tarif) as panier_moyen,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
      ),
      semaine_precedente AS (
        SELECT 
          COUNT(*) as reservations,
          SUM(tarif) as ca,
          AVG(tarif) as panier_moyen,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '14 days'
          AND datereservation < CURRENT_DATE - INTERVAL '7 days'
      )
      SELECT 
        sc.reservations as reservations_courantes,
        sp.reservations as reservations_precedentes,
        sc.ca as ca_courant,
        sp.ca as ca_precedent,
        sc.panier_moyen as panier_courant,
        sp.panier_moyen as panier_precedent,
        sc.clients_uniques as clients_courants,
        sp.clients_uniques as clients_precedents
      FROM semaine_courante sc, semaine_precedente sp
    `);

    const data = result.rows[0] || {};

    const evolution = {
      reservations: calculerEvolution(data.reservations_courantes, data.reservations_precedentes),
      ca: calculerEvolution(data.ca_courant, data.ca_precedent),
      panier: calculerEvolution(data.panier_courant, data.panier_precedent)
    };

    res.json({
      success: true,
      periode: {
        semaine_courante: 'Derniers 7 jours',
        semaine_precedente: '7 jours précédents'
      },
      comparaison: {
        reservations: {
          courant: parseInt(data.reservations_courantes || 0),
          precedent: parseInt(data.reservations_precedentes || 0),
          evolution: evolution.reservations
        },
        chiffre_affaires: {
          courant: parseFloat(data.ca_courant || 0),
          precedent: parseFloat(data.ca_precedent || 0),
          evolution: evolution.ca
        },
        panier_moyen: {
          courant: parseFloat(data.panier_courant || 0),
          precedent: parseFloat(data.panier_precedent || 0),
          evolution: evolution.panier
        },
        clients_uniques: {
          courant: parseInt(data.clients_courants || 0),
          precedent: parseInt(data.clients_precedents || 0)
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse hebdomadaire:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// 📊 Analyse rentabilité par créneau horaire
router.get('/analyse-creneaux', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as reservations,
        SUM(tarif) as ca,
        AVG(tarif) as panier_moyen,
        AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        AND EXTRACT(HOUR FROM heurereservation) BETWEEN 6 AND 23
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `);

    const creneaux = result.rows.map(r => ({
      heure: parseInt(r.heure || 0),
      reservations: parseInt(r.reservations || 0),
      ca: parseFloat(r.ca || 0),
      panier_moyen: parseFloat(r.panier_moyen || 0),
      duree_moyenne: parseFloat(r.duree_moyenne || 0),
      ca_par_heure: parseFloat(r.reservations || 0) > 0 
        ? parseFloat(r.ca || 0) / parseInt(r.reservations || 1)
        : 0
    }));

    // Identifier les meilleurs créneaux
    const meilleurCreneauCA = creneaux.reduce((max, c) => c.ca > max.ca ? c : max, { ca: 0 });
    const meilleurCreneauReservations = creneaux.reduce((max, c) => c.reservations > max.reservations ? c : max, { reservations: 0 });

    res.json({
      success: true,
      periode_analyse: '30 derniers jours',
      creneaux: creneaux,
      analyse: {
        meilleur_creneau_ca: {
          heure: meilleurCreneauCA.heure,
          ca: meilleurCreneauCA.ca,
          reservations: meilleurCreneauCA.reservations
        },
        meilleur_creneau_reservations: {
          heure: meilleurCreneauReservations.heure,
          reservations: meilleurCreneauReservations.reservations,
          ca: meilleurCreneauReservations.ca
        },
        heures_moins_productives: creneaux.filter(c => c.reservations < 5).map(c => c.heure),
        recommandations: creneaux.filter(c => c.reservations < 3 && c.heure >= 18 && c.heure <= 22).length > 0
          ? ['Promotions ciblées sur les créneaux soir peu occupés']
          : ['Performance satisfaisante sur tous les créneaux']
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse créneaux:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// 📈 Analyse tendances rapide
router.get('/analyse-tendances', async (req, res) => {
  try {
    const [journalier, hebdomadaire, mensuel] = await Promise.all([
      // Tendance journalière (7 derniers jours)
      db.query(`
        SELECT 
          DATE(datereservation) as date,
          COUNT(*) as reservations,
          SUM(tarif) as ca
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY DATE(datereservation)
        ORDER BY DATE(datereservation)
      `),
      
      // Tendance hebdomadaire (8 dernières semaines)
      db.query(`
        SELECT 
          DATE_TRUNC('week', datereservation) as semaine,
          COUNT(*) as reservations,
          SUM(tarif) as ca
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '56 days'
        GROUP BY DATE_TRUNC('week', datereservation)
        ORDER BY DATE_TRUNC('week', datereservation)
      `),
      
      // Tendance mensuelle (12 derniers mois)
      db.query(`
        SELECT 
          DATE_TRUNC('month', datereservation) as mois,
          COUNT(*) as reservations,
          SUM(tarif) as ca
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '365 days'
        GROUP BY DATE_TRUNC('month', datereservation)
        ORDER BY DATE_TRUNC('month', datereservation)
      `)
    ]);

    const tendances = {
      journalier: journalier.rows.map(r => ({
        date: r.date,
        reservations: parseInt(r.reservations || 0),
        ca: parseFloat(r.ca || 0)
      })),
      hebdomadaire: hebdomadaire.rows.map(r => ({
        semaine: r.semaine,
        reservations: parseInt(r.reservations || 0),
        ca: parseFloat(r.ca || 0)
      })),
      mensuel: mensuel.rows.map(r => ({
        mois: r.mois,
        reservations: parseInt(r.reservations || 0),
        ca: parseFloat(r.ca || 0)
      }))
    };

    // Calculer les évolutions
    const evolutionJournaliere = tendances.journalier.length >= 2 
      ? calculerEvolution(
          tendances.journalier[tendances.journalier.length - 1].ca,
          tendances.journalier[tendances.journalier.length - 2].ca
        )
      : 0;

    const evolutionHebdomadaire = tendances.hebdomadaire.length >= 2
      ? calculerEvolution(
          tendances.hebdomadaire[tendances.hebdomadaire.length - 1].ca,
          tendances.hebdomadaire[tendances.hebdomadaire.length - 2].ca
        )
      : 0;

    res.json({
      success: true,
      tendances: {
        journaliere: {
          donnees: tendances.journalier,
          evolution: evolutionJournaliere,
          interpretation: evolutionJournaliere > 10 ? 'Forte hausse' :
                        evolutionJournaliere > 0 ? 'Hausse modérée' :
                        evolutionJournaliere > -5 ? 'Stable' : 'Baisse'
        },
        hebdomadaire: {
          donnees: tendances.hebdomadaire,
          evolution: evolutionHebdomadaire,
          interpretation: evolutionHebdomadaire > 15 ? 'Accélération' :
                        evolutionHebdomadaire > 5 ? 'Croissance' :
                        evolutionHebdomadaire > -5 ? 'Stabilisation' : 'Ralentissement'
        },
        mensuelle: {
          donnees: tendances.mensuel,
          tcac: tendances.mensuel.length >= 2
            ? calculerTCAC(
                tendances.mensuel[0].ca,
                tendances.mensuel[tendances.mensuel.length - 1].ca,
                tendances.mensuel.length / 12
              )
            : 0
        }
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse tendances:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur' 
    });
  }
});

// ============================================
// ROUTE DE SANTÉ ET TEST
// ============================================

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API d\'analyse financière optimisée fonctionnelle',
    timestamp: new Date().toISOString(),
    version: '1.1.0',
    optimisation: {
      timeout_resolu: true,
      requetes_simplifiees: true,
      erreurs_corrigees: true,
      limite_donnees: '30-90 jours pour performance'
    },
    endpoints: [
      '/analyse-par-terrain',
      '/tableau-bord-executif',
      '/analyse-mensuelle',
      '/analyse-cohortes',
      '/previsions',
      '/analyse-qualite-portefeuille',
      '/analyse-elasticite-prix',
      '/analyse-hebdomadaire',
      '/analyse-creneaux',
      '/analyse-tendances',
      '/test'
    ]
  });
});

// Route de santé
router.get('/sante', async (req, res) => {
  try {
    // Test simple de connexion à la base
    const test = await db.query('SELECT NOW() as timestamp');
    
    res.json({
      success: true,
      status: 'OK',
      timestamp: test.rows[0].timestamp,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'ERREUR',
      message: error.message
    });
  }
});

export default router;