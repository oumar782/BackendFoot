// routes/financial-analysis.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Analyse financière mensuelle
// 📊 Analyse financière mensuelle avec comparaison année précédente
router.get('/analyse-mensuelle', async (req, res) => {
  try {
    const { annee } = req.query;
    const anneeCourante = annee || new Date().getFullYear();
    const anneePrecedente = anneeCourante - 1;

    // Récupérer les données des deux années en parallèle
    const result = await db.query(`
      WITH donnees_annees AS (
        SELECT 
          EXTRACT(YEAR FROM datereservation) as annee,
          EXTRACT(MONTH FROM datereservation) as mois,
          DATE_TRUNC('month', datereservation) as mois_date,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'MM/YYYY') as periode,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month YYYY') as periode_affichage,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month') as nom_mois,
          COUNT(*) as nombre_reservations,
          SUM(tarif) as chiffre_affaires,
          AVG(tarif) as tarif_moyen,
          SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_totales,
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          COUNT(DISTINCT email) as clients_uniques,
          ROUND((AVG(tarif / NULLIF(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600, 0)))::numeric, 2) as tarif_horaire_moyen
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND EXTRACT(YEAR FROM datereservation) IN ($1, $2)
        GROUP BY 
          EXTRACT(YEAR FROM datereservation),
          EXTRACT(MONTH FROM datereservation),
          DATE_TRUNC('month', datereservation),
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month')
      ),
      tous_mois AS (
        SELECT generate_series(1, 12) as mois_num
      ),
      mois_annee_courante AS (
        SELECT * FROM donnees_annees WHERE annee = $1
      ),
      mois_annee_precedente AS (
        SELECT * FROM donnees_annees WHERE annee = $2
      )
      SELECT 
        tm.mois_num as mois,
        TO_CHAR(TO_DATE(tm.mois_num::text, 'MM'), 'Month') as nom_mois_complet,
        COALESCE(mac.periode_affichage, 
          TO_CHAR(TO_DATE($1::text || '-' || LPAD(tm.mois_num::text, 2, '0'), 'YYYY-MM'), 'Month YYYY')) as periode_affichage_courante,
        COALESCE(map.periode_affichage, 
          TO_CHAR(TO_DATE($2::text || '-' || LPAD(tm.mois_num::text, 2, '0'), 'YYYY-MM'), 'Month YYYY')) as periode_affichage_precedente,
        
        -- Année courante
        COALESCE(mac.nombre_reservations, 0) as reservations_courantes,
        COALESCE(mac.chiffre_affaires, 0) as ca_courant,
        COALESCE(mac.tarif_moyen, 0) as tarif_moyen_courant,
        COALESCE(mac.heures_totales, 0) as heures_totales_courantes,
        COALESCE(mac.terrains_utilises, 0) as terrains_utilises_courants,
        COALESCE(mac.clients_uniques, 0) as clients_uniques_courants,
        COALESCE(mac.tarif_horaire_moyen, 0) as tarif_horaire_moyen_courant,
        
        -- Année précédente
        COALESCE(map.nombre_reservations, 0) as reservations_precedentes,
        COALESCE(map.chiffre_affaires, 0) as ca_precedent,
        COALESCE(map.tarif_moyen, 0) as tarif_moyen_precedent,
        COALESCE(map.heures_totales, 0) as heures_totales_precedentes,
        COALESCE(map.terrains_utilises, 0) as terrains_utilises_precedents,
        COALESCE(map.clients_uniques, 0) as clients_uniques_precedents,
        COALESCE(map.tarif_horaire_moyen, 0) as tarif_horaire_moyen_precedent,
        
        -- Calculs d'évolution
        CASE 
          WHEN COALESCE(map.chiffre_affaires, 0) > 0 
          THEN ROUND(((COALESCE(mac.chiffre_affaires, 0) - COALESCE(map.chiffre_affaires, 0)) / 
                     COALESCE(map.chiffre_affaires, 0)) * 100, 2)
          ELSE 0 
        END as evolution_ca_pourcentage,
        
        CASE 
          WHEN COALESCE(map.nombre_reservations, 0) > 0 
          THEN ROUND(((COALESCE(mac.nombre_reservations, 0) - COALESCE(map.nombre_reservations, 0)) / 
                     COALESCE(map.nombre_reservations, 0)) * 100, 2)
          ELSE 0 
        END as evolution_reservations_pourcentage,
        
        CASE 
          WHEN COALESCE(map.clients_uniques, 0) > 0 
          THEN ROUND(((COALESCE(mac.clients_uniques, 0) - COALESCE(map.clients_uniques, 0)) / 
                     COALESCE(map.clients_uniques, 0)) * 100, 2)
          ELSE 0 
        END as evolution_clients_pourcentage
        
      FROM tous_mois tm
      LEFT JOIN mois_annee_courante mac ON tm.mois_num = EXTRACT(MONTH FROM mac.mois_date)
      LEFT JOIN mois_annee_precedente map ON tm.mois_num = EXTRACT(MONTH FROM map.mois_date)
      ORDER BY tm.mois_num DESC
    `, [anneeCourante, anneePrecedente]);

    // Structurer les données pour faciliter l'affichage côté frontend
    const donneesStructurees = result.rows.map(mois => {
      const caCourant = parseFloat(mois.ca_courant);
      const caPrecedent = parseFloat(mois.ca_precedent);
      const reservationsCourantes = parseInt(mois.reservations_courantes);
      const reservationsPrecedentes = parseInt(mois.reservations_precedentes);
      
      // Déterminer les tendances
      const tendanceCA = mois.evolution_ca_pourcentage > 0 ? 'hausse' : 
                        mois.evolution_ca_pourcentage < 0 ? 'baisse' : 'stable';
      
      const tendanceReservations = mois.evolution_reservations_pourcentage > 0 ? 'hausse' : 
                                  mois.evolution_reservations_pourcentage < 0 ? 'baisse' : 'stable';

      return {
        mois: parseInt(mois.mois),
        nom_mois: mois.nom_mois_complet.trim(),
        periode_affichage: mois.periode_affichage_courante,
        
        // Données année courante
        annee_courante: {
          chiffre_affaires: caCourant,
          nombre_reservations: reservationsCourantes,
          tarif_moyen: parseFloat(mois.tarif_moyen_courant),
          heures_totales: parseFloat(mois.heures_totales_courantes),
          terrains_utilises: parseInt(mois.terrains_utilises_courants),
          clients_uniques: parseInt(mois.clients_uniques_courants),
          tarif_horaire_moyen: parseFloat(mois.tarif_horaire_moyen_courant),
          periode_affichage: mois.periode_affichage_courante
        },
        
        // Données année précédente
        annee_precedente: {
          chiffre_affaires: caPrecedent,
          nombre_reservations: reservationsPrecedentes,
          tarif_moyen: parseFloat(mois.tarif_moyen_precedent),
          heures_totales: parseFloat(mois.heures_totales_precedentes),
          terrains_utilises: parseInt(mois.terrains_utilises_precedents),
          clients_uniques: parseInt(mois.clients_uniques_precedents),
          tarif_horaire_moyen: parseFloat(mois.tarif_horaire_moyen_precedent),
          periode_affichage: mois.periode_affichage_precedente
        },
        
        // Évolutions
        evolution: {
          ca: mois.evolution_ca_pourcentage,
          reservations: mois.evolution_reservations_pourcentage,
          clients: mois.evolution_clients_pourcentage,
          tendance_ca: tendanceCA,
          tendance_reservations: tendanceReservations,
          difference_ca: caCourant - caPrecedent,
          difference_reservations: reservationsCourantes - reservationsPrecedentes
        },
        
        // Données pour graphiques
        pour_graphique: {
          mois_abrege: mois.nom_mois_complet.trim().substring(0, 3),
          ca_courant: caCourant,
          ca_precedent: caPrecedent,
          reservations_courantes: reservationsCourantes,
          reservations_precedentes: reservationsPrecedentes
        }
      };
    });

    // Statistiques globales pour les deux années
    const statsGlobales = result.rows.reduce((acc, mois) => {
      // Année courante
      acc.annee_courante.ca_total += parseFloat(mois.ca_courant);
      acc.annee_courante.reservations_total += parseInt(mois.reservations_courantes);
      acc.annee_courante.heures_total += parseFloat(mois.heures_totales_courantes);
      acc.annee_courante.clients_total += parseInt(mois.clients_uniques_courants);
      
      // Année précédente
      acc.annee_precedente.ca_total += parseFloat(mois.ca_precedent);
      acc.annee_precedente.reservations_total += parseInt(mois.reservations_precedentes);
      acc.annee_precedente.heures_total += parseFloat(mois.heures_totales_precedentes);
      acc.annee_precedente.clients_total += parseInt(mois.clients_uniques_precedents);
      
      // Compter les mois actifs
      if (parseFloat(mois.ca_courant) > 0) acc.annee_courante.mois_actifs++;
      if (parseFloat(mois.ca_precedent) > 0) acc.annee_precedente.mois_actifs++;
      
      return acc;
    }, {
      annee_courante: { ca_total: 0, reservations_total: 0, heures_total: 0, clients_total: 0, mois_actifs: 0 },
      annee_precedente: { ca_total: 0, reservations_total: 0, heures_total: 0, clients_total: 0, mois_actifs: 0 }
    });

    // Calculer les moyennes
    statsGlobales.annee_courante.ca_moyen_mensuel = 
      statsGlobales.annee_courante.mois_actifs > 0 
        ? statsGlobales.annee_courante.ca_total / statsGlobales.annee_courante.mois_actifs 
        : 0;
    
    statsGlobales.annee_precedente.ca_moyen_mensuel = 
      statsGlobales.annee_precedente.mois_actifs > 0 
        ? statsGlobales.annee_precedente.ca_total / statsGlobales.annee_precedente.mois_actifs 
        : 0;

    statsGlobales.annee_courante.reservations_moyennes_mensuelles = 
      statsGlobales.annee_courante.mois_actifs > 0 
        ? statsGlobales.annee_courante.reservations_total / statsGlobales.annee_courante.mois_actifs 
        : 0;
    
    statsGlobales.annee_precedente.reservations_moyennes_mensuelles = 
      statsGlobales.annee_precedente.mois_actifs > 0 
        ? statsGlobales.annee_precedente.reservations_total / statsGlobales.annee_precedente.mois_actifs 
        : 0;

    // Calculer l'évolution globale
    const evolutionGlobaleCA = statsGlobales.annee_precedente.ca_total > 0
      ? ((statsGlobales.annee_courante.ca_total - statsGlobales.annee_precedente.ca_total) / 
         statsGlobales.annee_precedente.ca_total) * 100
      : 0;
    
    const evolutionGlobaleReservations = statsGlobales.annee_precedente.reservations_total > 0
      ? ((statsGlobales.annee_courante.reservations_total - statsGlobales.annee_precedente.reservations_total) / 
         statsGlobales.annee_precedente.reservations_total) * 100
      : 0;

    // Identifier les meilleurs et pires mois
    const moisAvecCA = donneesStructurees.filter(m => m.annee_courante.chiffre_affaires > 0);
    const meilleurMois = moisAvecCA.length > 0
      ? moisAvecCA.reduce((max, mois) => 
          mois.annee_courante.chiffre_affaires > max.annee_courante.chiffre_affaires ? mois : max
        , moisAvecCA[0])
      : null;
    
    const pireMois = moisAvecCA.length > 0
      ? moisAvecCA.reduce((min, mois) => 
          mois.annee_courante.chiffre_affaires < min.annee_courante.chiffre_affaires ? mois : min
        , moisAvecCA[0])
      : null;

    res.json({
      success: true,
      data: {
        analyse_mensuelle: donneesStructurees,
        stats_globales: {
          annee_courante: {
            ...statsGlobales.annee_courante,
            evolution_vs_annee_precedente: Math.round(evolutionGlobaleCA * 100) / 100,
            evolution_reservations: Math.round(evolutionGlobaleReservations * 100) / 100,
            tendance_ca: evolutionGlobaleCA > 0 ? 'hausse' : evolutionGlobaleCA < 0 ? 'baisse' : 'stable',
            tendance_reservations: evolutionGlobaleReservations > 0 ? 'hausse' : evolutionGlobaleReservations < 0 ? 'baisse' : 'stable'
          },
          annee_precedente: statsGlobales.annee_precedente
        },
        meilleur_mois: meilleurMois,
        pire_mois: pireMois,
        mois_plus_croissance: donneesStructurees
          .filter(m => m.evolution.ca > 0)
          .sort((a, b) => b.evolution.ca - a.evolution.ca)
          .slice(0, 3),
        mois_plus_declin: donneesStructurees
          .filter(m => m.evolution.ca < 0)
          .sort((a, b) => a.evolution.ca - b.evolution.ca)
          .slice(0, 3)
      },
      annees_analyse: {
        annee_courante: anneeCourante,
        annee_precedente: anneePrecedente
      },
      metadata: {
        donnees_pour_graphiques: {
          labels: donneesStructurees.map(m => m.nom_mois.substring(0, 3)).reverse(),
          ca_annee_courante: donneesStructurees.map(m => m.annee_courante.chiffre_affaires).reverse(),
          ca_annee_precedente: donneesStructurees.map(m => m.annee_precedente.chiffre_affaires).reverse(),
          reservations_annee_courante: donneesStructurees.map(m => m.annee_courante.nombre_reservations).reverse(),
          reservations_annee_precedente: donneesStructurees.map(m => m.annee_precedente.nombre_reservations).reverse()
        },
        format_recommandation: "Utilisez deux séries de données côte à côte pour comparer l'année en cours avec l'année précédente"
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse mensuelle avec comparaison:', error);
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
    let whereClause = "WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')";
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
      FROM reservation
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
      FROM reservation
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
        meilleure_semaine: result.rows.length > 0 ? result.rows.reduce((max, semaine) => 
          parseFloat(semaine.chiffre_affaires) > parseFloat(max.chiffre_affaires) ? semaine : max
        , result.rows[0]) : null,
        semaine_la_plus_occupee: result.rows.length > 0 ? result.rows.reduce((max, semaine) => 
          parseInt(semaine.nombre_reservations) > parseInt(max.nombre_reservations) ? semaine : max
        , result.rows[0]) : null
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
    
    let whereClause = "WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')";
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
      FROM reservation
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
      FROM reservation
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

    statsGlobales.ca_moyen_journalier = statsGlobales.jours_total > 0 ? statsGlobales.ca_total / statsGlobales.jours_total : 0;
    statsGlobales.reservations_moyennes_journalieres = statsGlobales.jours_total > 0 ? statsGlobales.reservations_total / statsGlobales.jours_total : 0;

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
        meilleur_jour: result.rows.length > 0 ? result.rows.reduce((max, jour) => 
          parseFloat(jour.chiffre_affaires) > parseFloat(max.chiffre_affaires) ? jour : max
        , result.rows[0]) : null,
        jour_plus_occupe: result.rows.length > 0 ? result.rows.reduce((max, jour) => 
          parseInt(jour.nombre_reservations) > parseInt(max.nombre_reservations) ? jour : max
        , result.rows[0]) : null
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
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
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
      : statsGlobales[anneePrecedente] ? 100 : 0;

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
          COALESCE(SUM(tarif), 0) as ca_mois,
          COALESCE(AVG(tarif), 0) as tarif_moyen_mois,
          COUNT(DISTINCT email) as clients_mois,
          COUNT(DISTINCT numeroterrain) as terrains_mois,
          ROUND(COALESCE(SUM(tarif), 0) / NULLIF(COUNT(DISTINCT DATE(datereservation)), 0), 2) as ca_journalier_moyen
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Stats de la semaine courante
      db.query(`
        SELECT 
          COUNT(*) as reservations_semaine,
          COALESCE(SUM(tarif), 0) as ca_semaine,
          COALESCE(AVG(tarif), 0) as tarif_moyen_semaine,
          COUNT(DISTINCT DATE(datereservation)) as jours_actifs
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= DATE_TRUNC('week', CURRENT_DATE)
          AND datereservation < DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '1 week'
      `),
      
      // Stats d'aujourd'hui
      db.query(`
        SELECT 
          COUNT(*) as reservations_aujourdhui,
          COALESCE(SUM(tarif), 0) as ca_aujourdhui,
          COALESCE(AVG(tarif), 0) as tarif_moyen_aujourdhui,
          COUNT(DISTINCT numeroterrain) as terrains_aujourdhui,
          COUNT(DISTINCT email) as clients_aujourdhui
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation = CURRENT_DATE
      `),
      
      // Top 5 terrains par chiffre d'affaires
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          typeterrain,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires,
          ROUND(COALESCE(AVG(tarif), 0), 2) as tarif_moyen,
          ROUND(COALESCE(SUM(tarif), 0) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as tarif_horaire_moyen
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
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
          COALESCE(SUM(tarif), 0) as total_depense,
          ROUND(COALESCE(AVG(tarif), 0), 2) as depense_moyenne,
          MAX(datereservation) as derniere_reservation
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
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
          COALESCE(SUM(tarif), 0) as chiffre_affaires
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `)
    ]);

    // Calculer les tendances
    const hier = await db.query(`
      SELECT 
        COUNT(*) as reservations_hier,
        COALESCE(SUM(tarif), 0) as ca_hier
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation = CURRENT_DATE - INTERVAL '1 day'
    `);

    const statsHier = hier.rows[0];
    const statsAujourdhuiData = statsAujourdhui.rows[0];

    let evolutionAujourdhui = 0;
    if (statsHier && statsHier.ca_hier > 0 && statsAujourdhuiData && statsAujourdhuiData.ca_aujourdhui) {
      evolutionAujourdhui = ((statsAujourdhuiData.ca_aujourdhui - statsHier.ca_hier) / statsHier.ca_hier) * 100;
    }

    res.json({
      success: true,
      data: {
        periode_courante: {
          mois: statsMoisCourant.rows[0] || {},
          semaine: statsSemaineCourante.rows[0] || {},
          aujourdhui: {
            ...(statsAujourdhuiData || {}),
            evolution_vs_hier: Math.round(evolutionAujourdhui * 100) / 100,
            tendance: evolutionAujourdhui > 0 ? 'hausse' : evolutionAujourdhui < 0 ? 'baisse' : 'stable'
          }
        },
        performances: {
          top_terrains: topTerrains.rows.map(terrain => ({
            ...terrain,
            chiffre_affaires: parseFloat(terrain.chiffre_affaires),
            tarif_moyen: parseFloat(terrain.tarif_moyen),
            tarif_horaire_moyen: parseFloat(terrain.tarif_horaire_moyen)
          })),
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
          ca_moyen_journalier: parseFloat(statsMoisCourant.rows[0]?.ca_journalier_moyen || 0),
          taux_occupation_estime: calculerTauxOccupation(statsMoisCourant.rows[0]),
          valeur_client_moyenne: topClients.rows.length > 0 
            ? topClients.rows.reduce((sum, client) => sum + parseFloat(client.depense_moyenne || 0), 0) / topClients.rows.length
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
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        COALESCE(AVG(tarif), 0) as tarif_moyen,
        COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_totales,
        COUNT(DISTINCT numeroterrain) as nombre_terrains,
        COUNT(DISTINCT email) as clients_uniques,
        ROUND(COALESCE(SUM(tarif), 0) / NULLIF(COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 0), 2) as tarif_horaire_moyen,
        ROUND(COALESCE(AVG(tarif), 0) / NULLIF(COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 0), 2) as valeur_horaire_moyenne,
        ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) as pourcentage_reservations
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
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
          contribution_ca: statsGlobales.ca_total > 0 ? (parseFloat(type.chiffre_affaires) / statsGlobales.ca_total) * 100 : 0
        })),
        stats_globales: statsGlobales,
        type_le_plus_rentable: result.rows[0] || null,
        type_le_plus_utilise: result.rows.length > 0 ? result.rows.reduce((max, type) => 
          parseInt(type.nombre_reservations) > parseInt(max.nombre_reservations) ? type : max
        , result.rows[0]) : null
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
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        COALESCE(AVG(tarif), 0) as tarif_moyen
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY datereservation
      ORDER BY datereservation
    `);

    // Moyennes par jour de semaine
    const moyennesParJour = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_numero,
        TO_CHAR(datereservation, 'Day') as jour_nom,
        COALESCE(AVG(count_daily), 0) as reservations_moyennes,
        COALESCE(AVG(ca_daily), 0) as ca_moyen,
        COALESCE(STDDEV(count_daily), 0) as reservations_ecart_type,
        COALESCE(STDDEV(ca_daily), 0) as ca_ecart_type
      FROM (
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'Day') as jour,
          EXTRACT(DOW FROM datereservation) as jour_num,
          COUNT(*) as count_daily,
          COALESCE(SUM(tarif), 0) as ca_daily
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
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

    statsPrevisions.ca_moyen_journalier = statsPrevisions.jours_total > 0 ? statsPrevisions.ca_total / statsPrevisions.jours_total : 0;
    statsPrevisions.reservations_moyennes_journalieres = statsPrevisions.jours_total > 0 ? statsPrevisions.reservations_total / statsPrevisions.jours_total : 0;

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

// 📊 Analyse détaillée par terrain
router.get('/analyse-par-terrain', async (req, res) => {
  try {
    const { periode = '30' } = req.query;

    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(*) as nombre_reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        COALESCE(AVG(tarif), 0) as tarif_moyen,
        COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_totales,
        COUNT(DISTINCT email) as clients_uniques,
        ROUND(COALESCE(AVG(tarif), 0) / NULLIF(COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 0), 2) as tarif_horaire_moyen,
        ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 2) as pourcentage_reservations
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY chiffre_affaires DESC
    `);

    res.json({
      success: true,
      data: result.rows.map(terrain => ({
        ...terrain,
        chiffre_affaires: parseFloat(terrain.chiffre_affaires),
        tarif_moyen: parseFloat(terrain.tarif_moyen),
        tarif_horaire_moyen: parseFloat(terrain.tarif_horaire_moyen),
        pourcentage_reservations: parseFloat(terrain.pourcentage_reservations)
      })),
      periode_analyse: `${periode} jours`
    });

  } catch (error) {
    console.error('❌ Erreur analyse par terrain:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Analyse des heures les plus rentables
router.get('/analyse-heures-rentables', async (req, res) => {
  try {
    const { periode = '30' } = req.query;

    const result = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as nombre_reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        COALESCE(AVG(tarif), 0) as tarif_moyen,
        COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 2) as duree_moyenne_heures,
        ROUND(COALESCE(SUM(tarif), 0) / NULLIF(COUNT(DISTINCT DATE(datereservation)), 0), 2) as ca_moyen_par_jour
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `);

    res.json({
      success: true,
      data: result.rows.map(heure => ({
        ...heure,
        chiffre_affaires: parseFloat(heure.chiffre_affaires),
        tarif_moyen: parseFloat(heure.tarif_moyen),
        duree_moyenne_heures: parseFloat(heure.duree_moyenne_heures),
        ca_moyen_par_jour: parseFloat(heure.ca_moyen_par_jour)
      })),
      periode_analyse: `${periode} jours`
    });

  } catch (error) {
    console.error('❌ Erreur analyse heures rentables:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Statistiques des clients
router.get('/stats-clients', async (req, res) => {
  try {
    const { periode = '90' } = req.query;

    const result = await db.query(`
      SELECT 
        email,
        nomclient,
        prenom,
        COUNT(*) as total_reservations,
        COALESCE(SUM(tarif), 0) as total_depense,
        COALESCE(AVG(tarif), 0) as depense_moyenne,
        MIN(datereservation) as premiere_reservation,
        MAX(datereservation) as derniere_reservation,
        COUNT(DISTINCT typeterrain) as types_terrains_utilises,
        COUNT(DISTINCT numeroterrain) as terrains_utilises,
        ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as duree_moyenne_heures
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      GROUP BY email, nomclient, prenom
      ORDER BY total_depense DESC
      LIMIT 20
    `);

    // Statistiques globales clients
    const statsGlobales = await db.query(`
      SELECT 
        COUNT(DISTINCT email) as clients_uniques,
        COALESCE(AVG(reservations_par_client), 0) as reservations_moyennes_par_client,
        COALESCE(AVG(depense_par_client), 0) as depense_moyenne_par_client
      FROM (
        SELECT 
          email,
          COUNT(*) as reservations_par_client,
          COALESCE(SUM(tarif), 0) as depense_par_client
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY email
      ) client_stats
    `);

    res.json({
      success: true,
      data: {
        clients_top: result.rows.map(client => ({
          ...client,
          total_depense: parseFloat(client.total_depense),
          depense_moyenne: parseFloat(client.depense_moyenne),
          duree_moyenne_heures: parseFloat(client.duree_moyenne_heures)
        })),
        stats_globales: {
          clients_uniques: parseInt(statsGlobales.rows[0]?.clients_uniques || 0),
          reservations_moyennes_par_client: parseFloat(statsGlobales.rows[0]?.reservations_moyennes_par_client || 0),
          depense_moyenne_par_client: parseFloat(statsGlobales.rows[0]?.depense_moyenne_par_client || 0)
        }
      },
      periode_analyse: `${periode} jours`
    });

  } catch (error) {
    console.error('❌ Erreur stats clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Export des données (format CSV)
router.get('/export-donnees', async (req, res) => {
  try {
    const { periode = '30', format = 'json' } = req.query;

    const result = await db.query(`
      SELECT 
        numeroreservations,
        nomclient,
        prenom,
        email,
        telephone,
        datereservation,
        heurereservation,
        heurefin,
        numeroterrain,
        nomterrain,
        typeterrain,
        surface,
        tarif,
        statut
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      ORDER BY datereservation DESC, heurereservation DESC
    `);

    if (format === 'csv') {
      // Convertir en CSV
      const headers = Object.keys(result.rows[0] || {}).join(',');
      const csvData = result.rows.map(row => 
        Object.values(row).map(value => 
          typeof value === 'string' && value.includes(',') ? `"${value}"` : value
        ).join(',')
      ).join('\n');
      
      const csv = `${headers}\n${csvData}`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=export-financier-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: result.rows,
        metadata: {
          nombre_lignes: result.rows.length,
          periode: `${periode} jours`,
          date_export: new Date().toISOString()
        }
      });
    }

  } catch (error) {
    console.error('❌ Erreur export données:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer le taux d'occupation estimé
function calculerTauxOccupation(statsMois) {
  if (!statsMois) return 0;
  
  // Supposons 8 heures d'ouverture par jour, 30 jours par mois, et plusieurs terrains
  const heuresDisponibles = 8 * 30 * (statsMois.terrains_mois || 1);
  const tarifMoyen = parseFloat(statsMois.tarif_moyen_mois || 0);
  const caMois = parseFloat(statsMois.ca_mois || 0);
  
  if (tarifMoyen > 0 && heuresDisponibles > 0) {
    const heuresReservees = caMois / tarifMoyen;
    return Math.round((heuresReservees / heuresDisponibles) * 10000) / 100;
  }
  return 0;
}

// Fonction pour calculer le niveau de confiance des prévisions
function calculerNiveauConfiance(statsJour) {
  if (!statsJour) return 'Faible';
  
  const ecartTypeReservations = parseFloat(statsJour.reservations_ecart_type || 0);
  const moyenneReservations = parseFloat(statsJour.reservations_moyennes || 0);
  
  if (moyenneReservations === 0) return 'Faible';
  
  const coefficientVariation = ecartTypeReservations / moyenneReservations;
  
  if (coefficientVariation < 0.3) return 'Élevé';
  if (coefficientVariation < 0.6) return 'Moyen';
  return 'Faible';
}

export default router;