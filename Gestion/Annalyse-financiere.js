// routes/financial-analysis.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Analyse financière mensuelle
router.get('/analyse-mensuelle', async (req, res) => {
  try {
    const { annee } = req.query;
    const anneeFiltre = annee || 'EXTRACT(YEAR FROM CURRENT_DATE)';

    const result = await db.query(`
      SELECT 
        DATE_TRUNC('month', datereservation) as mois,
        TO_CHAR(DATE_TRUNC('month', datereservation), 'MM/YYYY') as periode,
        TO_CHAR(DATE_TRUNC('month', datereservation), 'Month YYYY') as periode_affichage,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_totales,
        COUNT(DISTINCT numeroterrain) as terrains_utilises,
        COUNT(DISTINCT email) as clients_uniques,
        ROUND(AVG(tarif / NULLIF(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600, 0)), 2) as tarif_horaire_moyen
      FROM reservations
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND EXTRACT(YEAR FROM datereservation) = $1
      GROUP BY DATE_TRUNC('month', datereservation)
      ORDER BY mois DESC
    `, [anneeFiltre]);

    // Calculer les tendances mois par mois
    const donneesAvecTendances = result.rows.map((mois, index) => {
      const moisPrecedent = result.rows[index + 1];
      
      let evolution_ca = 0;
      let evolution_reservations = 0;
      
      if (moisPrecedent) {
        evolution_ca = moisPrecedent.chiffre_affaires > 0 
          ? ((mois.chiffre_affaires - moisPrecedent.chiffre_affaires) / moisPrecedent.chiffre_affaires) * 100
          : 0;
        
        evolution_reservations = moisPrecedent.nombre_reservations > 0
          ? ((mois.nombre_reservations - moisPrecedent.nombre_reservations) / moisPrecedent.nombre_reservations) * 100
          : 0;
      }

      return {
        ...mois,
        chiffre_affaires: parseFloat(mois.chiffre_affaires),
        tarif_moyen: parseFloat(mois.tarif_moyen),
        evolution_ca: Math.round(evolution_ca * 100) / 100,
        evolution_reservations: Math.round(evolution_reservations * 100) / 100,
        tendance_ca: evolution_ca > 0 ? 'hausse' : evolution_ca < 0 ? 'baisse' : 'stable',
        tendance_reservations: evolution_reservations > 0 ? 'hausse' : evolution_reservations < 0 ? 'baisse' : 'stable'
      };
    });

    // Statistiques globales de l'année
    const statsGlobales = result.rows.reduce((acc, mois) => ({
      ca_total: acc.ca_total + parseFloat(mois.chiffre_affaires),
      reservations_total: acc.reservations_total + parseInt(mois.nombre_reservations),
      heures_total: acc.heures_total + parseFloat(mois.heures_totales)
    }), { ca_total: 0, reservations_total: 0, heures_total: 0 });

    statsGlobales.ca_moyen_mensuel = statsGlobales.ca_total / result.rows.length;
    statsGlobales.reservations_moyennes_mensuelles = statsGlobales.reservations_total / result.rows.length;

    res.json({
      success: true,
      data: {
        analyse_mensuelle: donneesAvecTendances,
        stats_globales: statsGlobales,
        meilleur_mois: result.rows.reduce((max, mois) => 
          parseFloat(mois.chiffre_affaires) > parseFloat(max.chiffre_affaires) ? mois : max
        , result.rows[0]),
        pire_mois: result.rows.reduce((min, mois) => 
          parseFloat(mois.chiffre_affaires) < parseFloat(min.chiffre_affaires) ? mois : min
        , result.rows[0])
      },
      annee_analyse: anneeFiltre
    });

  } catch (error) {
    console.error('❌ Erreur analyse mensuelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Analyse financière hebdomadaire
router.get('/analyse-hebdomadaire', async (req, res) => {
  try {
    const { mois, annee } = req.query;
    let whereClause = "WHERE statut IN ('confirmée', 'payé', 'terminée')";
    const params = [];

    if (mois && annee) {
      whereClause += " AND EXTRACT(MONTH FROM datereservation) = $1 AND EXTRACT(YEAR FROM datereservation) = $2";
      params.push(mois, annee);
    } else {
      whereClause += " AND datereservation >= CURRENT_DATE - INTERVAL '3 months'";
    }

    const result = await db.query(`
      SELECT 
        DATE_TRUNC('week', datereservation) as semaine_debut,
        TO_CHAR(DATE_TRUNC('week', datereservation), 'DD/MM') as debut_semaine,
        TO_CHAR(DATE_TRUNC('week', datereservation) + INTERVAL '6 days', 'DD/MM') as fin_semaine,
        CONCAT(
          TO_CHAR(DATE_TRUNC('week', datereservation), 'DD/MM'),
          ' - ',
          TO_CHAR(DATE_TRUNC('week', datereservation) + INTERVAL '6 days', 'DD/MM')
        ) as periode_semaine,
        EXTRACT(WEEK FROM datereservation) as numero_semaine,
        EXTRACT(YEAR FROM datereservation) as annee,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        COUNT(DISTINCT numeroterrain) as terrains_utilises,
        COUNT(DISTINCT email) as clients_uniques,
        ROUND(SUM(tarif) / NULLIF(COUNT(DISTINCT DATE(datereservation)), 0), 2) as ca_moyen_journalier
      FROM reservations
      ${whereClause}
      GROUP BY 
        DATE_TRUNC('week', datereservation),
        EXTRACT(WEEK FROM datereservation),
        EXTRACT(YEAR FROM datereservation)
      ORDER BY semaine_debut DESC
    `, params);

    // Analyse des performances par jour de semaine
    const analyseJoursSemaine = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_numero,
        TO_CHAR(datereservation, 'Day') as jour_nom,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        ROUND(AVG(tarif), 2) as tarif_moyen_jour
      FROM reservations
      ${whereClause}
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_numero
    `, params);

    res.json({
      success: true,
      data: {
        analyse_hebdomadaire: result.rows.map(row => ({
          ...row,
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          ca_moyen_journalier: parseFloat(row.ca_moyen_journalier)
        })),
        analyse_jours_semaine: analyseJoursSemaine.rows,
        meilleure_semaine: result.rows.reduce((max, semaine) => 
          parseFloat(semaine.chiffre_affaires) > parseFloat(max.chiffre_affaires) ? semaine : max
        , result.rows[0]),
        semaine_la_plus_occupee: result.rows.reduce((max, semaine) => 
          parseInt(semaine.nombre_reservations) > parseInt(max.nombre_reservations) ? semaine : max
        , result.rows[0])
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse hebdomadaire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Analyse financière journalière
router.get('/analyse-journaliere', async (req, res) => {
  try {
    const { date_debut, date_fin } = req.query;
    
    let whereClause = "WHERE statut IN ('confirmée', 'payé', 'terminée')";
    const params = [];

    if (date_debut && date_fin) {
      whereClause += " AND datereservation BETWEEN $1 AND $2";
      params.push(date_debut, date_fin);
    } else {
      whereClause += " AND datereservation >= CURRENT_DATE - INTERVAL '30 days'";
    }

    const result = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'DD/MM/YYYY') as date_formattee,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as jour_numero,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        COUNT(DISTINCT numeroterrain) as terrains_utilises,
        COUNT(DISTINCT email) as clients_uniques,
        STRING_AGG(DISTINCT typeterrain, ', ') as types_terrains,
        STRING_AGG(DISTINCT nomterrain, ', ') as noms_terrains,
        ROUND(SUM(tarif) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as tarif_horaire_moyen
      FROM reservations
      ${whereClause}
      GROUP BY datereservation
      ORDER BY datereservation DESC
    `, params);

    // Analyse par heure de la journée
    const analyseParHeure = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 2) as duree_moyenne_heures
      FROM reservations
      ${whereClause}
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `, params);

    // Statistiques globales de la période
    const statsGlobales = result.rows.reduce((acc, jour) => ({
      ca_total: acc.ca_total + parseFloat(jour.chiffre_affaires),
      reservations_total: acc.reservations_total + parseInt(jour.nombre_reservations),
      jours_total: acc.jours_total + 1
    }), { ca_total: 0, reservations_total: 0, jours_total: 0 });

    statsGlobales.ca_moyen_journalier = statsGlobales.ca_total / statsGlobales.jours_total;
    statsGlobales.reservations_moyennes_journalieres = statsGlobales.reservations_total / statsGlobales.jours_total;

    res.json({
      success: true,
      data: {
        analyse_journaliere: result.rows.map(row => ({
          ...row,
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          tarif_horaire_moyen: parseFloat(row.tarif_horaire_moyen)
        })),
        analyse_par_heure: analyseParHeure.rows,
        stats_globales: statsGlobales,
        meilleur_jour: result.rows.reduce((max, jour) => 
          parseFloat(jour.chiffre_affaires) > parseFloat(max.chiffre_affaires) ? jour : max
        , result.rows[0]),
        jour_plus_occupe: result.rows.reduce((max, jour) => 
          parseInt(jour.nombre_reservations) > parseInt(max.nombre_reservations) ? jour : max
        , result.rows[0])
      },
      periode_analyse: {
        date_debut: date_debut || '30 derniers jours',
        date_fin: date_fin || 'aujourd\'hui'
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse journalière:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Analyse comparative année en cours vs année précédente
router.get('/comparaison-annuelle', async (req, res) => {
  try {
    const anneeCourante = new Date().getFullYear();
    const anneePrecedente = anneeCourante - 1;

    const result = await db.query(`
      WITH stats_par_mois AS (
        SELECT 
          EXTRACT(YEAR FROM datereservation) as annee,
          EXTRACT(MONTH FROM datereservation) as mois,
          TO_CHAR(datereservation, 'Month') as nom_mois,
          COUNT(*) as reservations,
          SUM(tarif) as chiffre_affaires,
          AVG(tarif) as tarif_moyen,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND EXTRACT(YEAR FROM datereservation) IN ($1, $2)
        GROUP BY 
          EXTRACT(YEAR FROM datereservation),
          EXTRACT(MONTH FROM datereservation),
          TO_CHAR(datereservation, 'Month')
      ),
      stats_globales AS (
        SELECT 
          annee,
          SUM(reservations) as reservations_total,
          SUM(chiffre_affaires) as ca_total,
          AVG(tarif_moyen) as tarif_moyen_global,
          SUM(clients_uniques) as clients_total_estime
        FROM stats_par_mois
        GROUP BY annee
      )
      SELECT 
        spm.annee,
        spm.mois,
        spm.nom_mois,
        spm.reservations,
        spm.chiffre_affaires,
        spm.tarif_moyen,
        spm.clients_uniques,
        sg.reservations_total,
        sg.ca_total,
        sg.tarif_moyen_global,
        sg.clients_total_estime,
        ROW_NUMBER() OVER (PARTITION BY spm.mois ORDER BY spm.annee DESC) as ordre_mois
      FROM stats_par_mois spm
      JOIN stats_globales sg ON spm.annee = sg.annee
      ORDER BY spm.mois, spm.annee DESC
    `, [anneePrecedente, anneeCourante]);

    // Structurer les données pour comparaison
    const comparaisonParMois = {};
    const statsGlobales = {};

    result.rows.forEach(row => {
      const mois = row.mois;
      if (!comparaisonParMois[mois]) {
        comparaisonParMois[mois] = {
          mois: mois,
          nom_mois: row.nom_mois.trim(),
          annee_courante: {},
          annee_precedente: {}
        };
      }

      if (row.annee === anneeCourante) {
        comparaisonParMois[mois].annee_courante = {
          reservations: parseInt(row.reservations),
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          clients_uniques: parseInt(row.clients_uniques)
        };
      } else if (row.annee === anneePrecedente) {
        comparaisonParMois[mois].annee_precedente = {
          reservations: parseInt(row.reservations),
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          clients_uniques: parseInt(row.clients_uniques)
        };
      }

      // Calculer l'évolution
      if (comparaisonParMois[mois].annee_courante.chiffre_affaires && 
          comparaisonParMois[mois].annee_precedente.chiffre_affaires) {
        const evolution = ((comparaisonParMois[mois].annee_courante.chiffre_affaires - 
                          comparaisonParMois[mois].annee_precedente.chiffre_affaires) / 
                          comparaisonParMois[mois].annee_precedente.chiffre_affaires) * 100;
        comparaisonParMois[mois].evolution_ca = Math.round(evolution * 100) / 100;
        comparaisonParMois[mois].tendance = evolution > 0 ? 'hausse' : evolution < 0 ? 'baisse' : 'stable';
      }

      // Stocker les stats globales par année
      if (!statsGlobales[row.annee]) {
        statsGlobales[row.annee] = {
          reservations_total: parseInt(row.reservations_total),
          ca_total: parseFloat(row.ca_total),
          tarif_moyen_global: parseFloat(row.tarif_moyen_global),
          clients_total_estime: parseInt(row.clients_total_estime)
        };
      }
    });

    // Convertir en tableau trié
    const comparaisonArray = Object.values(comparaisonParMois).sort((a, b) => a.mois - b.mois);

    // Calculer l'évolution globale
    const evolutionGlobale = statsGlobales[anneePrecedente] && statsGlobales[anneePrecedente].ca_total > 0
      ? ((statsGlobales[anneeCourante].ca_total - statsGlobales[anneePrecedente].ca_total) / 
         statsGlobales[anneePrecedente].ca_total) * 100
      : 0;

    res.json({
      success: true,
      data: {
        comparaison_mensuelle: comparaisonArray,
        stats_globales: {
          annee_courante: statsGlobales[anneeCourante] || {},
          annee_precedente: statsGlobales[anneePrecedente] || {},
          evolution_globale: Math.round(evolutionGlobale * 100) / 100,
          tendance_globale: evolutionGlobale > 0 ? 'hausse' : evolutionGlobale < 0 ? 'baisse' : 'stable'
        },
        annees_comparaison: {
          annee_courante: anneeCourante,
          annee_precedente: anneePrecedente
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur comparaison annuelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Tableau de bord financier complet
router.get('/tableau-de-bord-financier', async (req, res) => {
  try {
    const [
      statsMoisCourant,
      statsSemaineCourante,
      statsAujourdhui,
      topTerrains,
      topClients,
      evolutionRecent
    ] = await Promise.all([
      // Stats du mois courant
      db.query(`
        SELECT 
          COUNT(*) as reservations_mois,
          SUM(tarif) as ca_mois,
          AVG(tarif) as tarif_moyen_mois,
          COUNT(DISTINCT email) as clients_mois,
          COUNT(DISTINCT numeroterrain) as terrains_mois,
          ROUND(SUM(tarif) / NULLIF(COUNT(DISTINCT DATE(datereservation)), 0), 2) as ca_journalier_moyen
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Stats de la semaine courante
      db.query(`
        SELECT 
          COUNT(*) as reservations_semaine,
          SUM(tarif) as ca_semaine,
          AVG(tarif) as tarif_moyen_semaine,
          COUNT(DISTINCT DATE(datereservation)) as jours_actifs
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= DATE_TRUNC('week', CURRENT_DATE)
          AND datereservation < DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 week'
      `),
      
      // Stats d'aujourd'hui
      db.query(`
        SELECT 
          COUNT(*) as reservations_aujourdhui,
          SUM(tarif) as ca_aujourdhui,
          AVG(tarif) as tarif_moyen_aujourdhui,
          COUNT(DISTINCT numeroterrain) as terrains_aujourdhui,
          COUNT(DISTINCT email) as clients_aujourdhui
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation = CURRENT_DATE
      `),
      
      // Top 5 terrains par chiffre d'affaires
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          typeterrain,
          COUNT(*) as reservations,
          SUM(tarif) as chiffre_affaires,
          ROUND(AVG(tarif), 2) as tarif_moyen,
          ROUND(SUM(tarif) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as tarif_horaire_moyen
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain, nomterrain, typeterrain
        ORDER BY chiffre_affaires DESC
        LIMIT 5
      `),
      
      // Top 5 clients par dépenses
      db.query(`
        SELECT 
          email,
          nomclient,
          prenom,
          COUNT(*) as reservations,
          SUM(tarif) as total_depense,
          ROUND(AVG(tarif), 2) as depense_moyenne,
          MAX(datereservation) as derniere_reservation
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY email, nomclient, prenom
        ORDER BY total_depense DESC
        LIMIT 5
      `),
      
      // Évolution des 7 derniers jours
      db.query(`
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'DD/MM') as date_courte,
          TO_CHAR(datereservation, 'Dy') as jour,
          COUNT(*) as reservations,
          SUM(tarif) as chiffre_affaires
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `)
    ]);

    // Calculer les tendances
    const hier = await db.query(`
      SELECT 
        COUNT(*) as reservations_hier,
        SUM(tarif) as ca_hier
      FROM reservations
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation = CURRENT_DATE - INTERVAL '1 day'
    `);

    const statsHier = hier.rows[0];
    const statsAujourdhuiData = statsAujourdhui.rows[0];

    const evolutionAujourdhui = statsHier && statsHier.ca_hier > 0
      ? ((statsAujourdhuiData.ca_aujourdhui - statsHier.ca_hier) / statsHier.ca_hier) * 100
      : 0;

    res.json({
      success: true,
      data: {
        periode_courante: {
          mois: statsMoisCourant.rows[0],
          semaine: statsSemaineCourante.rows[0],
          aujourdhui: {
            ...statsAujourdhuiData,
            evolution_vs_hier: Math.round(evolutionAujourdhui * 100) / 100,
            tendance: evolutionAujourdhui > 0 ? 'hausse' : evolutionAujourdhui < 0 ? 'baisse' : 'stable'
          }
        },
        performances: {
          top_terrains: topTerrains.rows,
          top_clients: topClients.rows.map(client => ({
            ...client,
            total_depense: parseFloat(client.total_depense),
            depense_moyenne: parseFloat(client.depense_moyenne)
          }))
        },
        evolution_recente: evolutionRecent.rows.map(jour => ({
          ...jour,
          chiffre_affaires: parseFloat(jour.chiffre_affaires)
        })),
        indicateurs_cles: {
          ca_moyen_journalier: parseFloat(statsMoisCourant.rows[0].ca_journalier_moyen) || 0,
          taux_occupation_estime: calculerTauxOccupation(statsMoisCourant.rows[0]),
          valeur_client_moyenne: topClients.rows.length > 0 
            ? topClients.rows.reduce((sum, client) => sum + parseFloat(client.depense_moyenne), 0) / topClients.rows.length
            : 0
        }
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur tableau de bord financier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Analyse par type de terrain
router.get('/analyse-par-type-terrain', async (req, res) => {
  try {
    const { periode = '30' } = req.query;

    const result = await db.query(`
      SELECT 
        typeterrain,
        COUNT(*) as nombre_reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen,
        SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_totales,
        COUNT(DISTINCT numeroterrain) as nombre_terrains,
        COUNT(DISTINCT email) as clients_uniques,
        ROUND(SUM(tarif) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as tarif_horaire_moyen,
        ROUND(AVG(tarif) / NULLIF(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as valeur_horaire_moyenne,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as pourcentage_reservations
      FROM reservations
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      GROUP BY typeterrain
      ORDER BY chiffre_affaires DESC
    `);

    const statsGlobales = result.rows.reduce((acc, type) => ({
      ca_total: acc.ca_total + parseFloat(type.chiffre_affaires),
      reservations_total: acc.reservations_total + parseInt(type.nombre_reservations),
      heures_total: acc.heures_total + parseFloat(type.heures_totales)
    }), { ca_total: 0, reservations_total: 0, heures_total: 0 });

    res.json({
      success: true,
      data: {
        analyse_types: result.rows.map(type => ({
          ...type,
          chiffre_affaires: parseFloat(type.chiffre_affaires),
          tarif_moyen: parseFloat(type.tarif_moyen),
          tarif_horaire_moyen: parseFloat(type.tarif_horaire_moyen),
          valeur_horaire_moyenne: parseFloat(type.valeur_horaire_moyenne),
          pourcentage_reservations: parseFloat(type.pourcentage_reservations),
          contribution_ca: (parseFloat(type.chiffre_affaires) / statsGlobales.ca_total) * 100
        })),
        stats_globales: statsGlobales,
        type_le_plus_rentable: result.rows[0],
        type_le_plus_utilise: result.rows.reduce((max, type) => 
          parseInt(type.nombre_reservations) > parseInt(max.nombre_reservations) ? type : max
        , result.rows[0])
      },
      periode_analyse: `${periode} jours`
    });

  } catch (error) {
    console.error('❌ Erreur analyse par type terrain:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Prévisions financières
router.get('/previsions-financieres', async (req, res) => {
  try {
    const { horizon = '30' } = req.query;

    // Historique des 90 derniers jours
    const historique = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as jour_numero,
        COUNT(*) as reservations,
        SUM(tarif) as chiffre_affaires,
        AVG(tarif) as tarif_moyen
      FROM reservations
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY datereservation
      ORDER BY datereservation
    `);

    // Moyennes par jour de semaine
    const moyennesParJour = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_numero,
        TO_CHAR(datereservation, 'Day') as jour_nom,
        AVG(count_daily) as reservations_moyennes,
        AVG(ca_daily) as ca_moyen,
        STDDEV(count_daily) as reservations_ecart_type,
        STDDEV(ca_daily) as ca_ecart_type
      FROM (
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'Day') as jour,
          EXTRACT(DOW FROM datereservation) as jour_num,
          COUNT(*) as count_daily,
          SUM(tarif) as ca_daily
        FROM reservations
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY datereservation
      ) daily_stats
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_numero
    `);

    // Générer les prévisions
    const previsions = [];
    const aujourdhui = new Date();
    
    for (let i = 1; i <= parseInt(horizon); i++) {
      const datePrevision = new Date(aujourdhui);
      datePrevision.setDate(aujourdhui.getDate() + i);
      
      const jourNumero = datePrevision.getDay(); // 0 = Dimanche, 6 = Samedi
      const statsJour = moyennesParJour.rows.find(row => row.jour_numero === jourNumero);
      
      if (statsJour) {
        // Ajouter une variation aléatoire basée sur l'écart-type
        const variationReservations = Math.random() * parseFloat(statsJour.reservations_ecart_type || 0);
        const variationCA = Math.random() * parseFloat(statsJour.ca_ecart_type || 0);
        
        const reservationsPrevues = Math.max(0, 
          parseFloat(statsJour.reservations_moyennes || 0) + variationReservations
        );
        
        const caPrevu = Math.max(0, 
          parseFloat(statsJour.ca_moyen || 0) + variationCA
        );

        previsions.push({
          date: datePrevision.toISOString().split('T')[0],
          date_affichage: datePrevision.toLocaleDateString('fr-FR'),
          jour_semaine: statsJour.jour_nom.trim(),
          reservations_prevues: Math.round(reservationsPrevues),
          ca_prevu: Math.round(caPrevu * 100) / 100,
          tarif_moyen_prevu: reservationsPrevues > 0 
            ? Math.round((caPrevu / reservationsPrevues) * 100) / 100 
            : 0,
          niveau_confiance: calculerNiveauConfiance(statsJour)
        });
      }
    }

    // Statistiques des prévisions
    const statsPrevisions = previsions.reduce((acc, jour) => ({
      reservations_total: acc.reservations_total + jour.reservations_prevues,
      ca_total: acc.ca_total + jour.ca_prevu,
      jours_total: acc.jours_total + 1
    }), { reservations_total: 0, ca_total: 0, jours_total: 0 });

    statsPrevisions.ca_moyen_journalier = statsPrevisions.ca_total / statsPrevisions.jours_total;
    statsPrevisions.reservations_moyennes_journalieres = statsPrevisions.reservations_total / statsPrevisions.jours_total;

    res.json({
      success: true,
      data: {
        historique_analyse: {
          periode: '90 derniers jours',
          jours_analyse: historique.rows.length,
          ca_total_historique: historique.rows.reduce((sum, jour) => sum + parseFloat(jour.chiffre_affaires), 0)
        },
        moyennes_reference: moyennesParJour.rows.map(row => ({
          ...row,
          reservations_moyennes: parseFloat(row.reservations_moyennes),
          ca_moyen: parseFloat(row.ca_moyen),
          reservations_ecart_type: parseFloat(row.reservations_ecart_type),
          ca_ecart_type: parseFloat(row.ca_ecart_type)
        })),
        previsions: previsions,
        stats_previsions: statsPrevisions,
        meilleurs_jours_prevision: previsions
          .sort((a, b) => b.ca_prevu - a.ca_prevu)
          .slice(0, 5),
        jours_faible_activite: previsions
          .filter(j => j.reservations_prevues < 2)
          .sort((a, b) => a.reservations_prevues - b.reservations_prevues)
      },
      horizon_prevision: `${horizon} jours`,
      date_generation: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur prévisions financières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer le taux d'occupation estimé
function calculerTauxOccupation(statsMois) {
  // Supposons 8 heures d'ouverture par jour, 30 jours par mois, et plusieurs terrains
  const heuresDisponibles = 8 * 30 * (statsMois.terrains_mois || 1);
  const heuresReservees = parseFloat(statsMois.ca_mois) / parseFloat(statsMois.tarif_moyen_mois || 1);
  
  if (heuresDisponibles > 0) {
    return Math.round((heuresReservees / heuresDisponibles) * 10000) / 100;
  }
  return 0;
}

// Fonction pour calculer le niveau de confiance des prévisions
function calculerNiveauConfiance(statsJour) {
  const ecartTypeReservations = parseFloat(statsJour.reservations_ecart_type || 0);
  const moyenneReservations = parseFloat(statsJour.reservations_moyennes || 0);
  
  if (moyenneReservations === 0) return 'Faible';
  
  const coefficientVariation = ecartTypeReservations / moyenneReservations;
  
  if (coefficientVariation < 0.3) return 'Élevé';
  if (coefficientVariation < 0.6) return 'Moyen';
  return 'Faible';
}

export default router;