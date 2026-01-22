// routes/financial-analysis.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Analyse financière mensuelle avec comparaison année précédente
router.get('/analyse-mensuelle', async (req, res) => {
  try {
    const { annee } = req.query;
    const anneeCourante = annee ? parseInt(annee) : new Date().getFullYear();
    const anneePrecedente = anneeCourante - 1;

    // Vérifier que l'année est valide
    if (isNaN(anneeCourante) || anneeCourante < 2020 || anneeCourante > new Date().getFullYear()) {
      return res.status(400).json({
        success: false,
        message: 'Année invalide'
      });
    }

    // Récupérer les données des deux années
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
          COALESCE(SUM(tarif), 0) as chiffre_affaires,
          COALESCE(AVG(tarif), 0) as tarif_moyen,
          COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_totales,
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          COUNT(DISTINCT email) as clients_uniques,
          ROUND(COALESCE(AVG(tarif / NULLIF(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600, 0)), 0)::numeric, 2) as tarif_horaire_moyen
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
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
          ELSE 
            CASE WHEN COALESCE(mac.chiffre_affaires, 0) > 0 THEN 100 ELSE 0 END
        END as evolution_ca_pourcentage,
        
        CASE 
          WHEN COALESCE(map.nombre_reservations, 0) > 0 
          THEN ROUND(((COALESCE(mac.nombre_reservations, 0) - COALESCE(map.nombre_reservations, 0)) / 
                     COALESCE(map.nombre_reservations, 0)) * 100, 2)
          ELSE 
            CASE WHEN COALESCE(mac.nombre_reservations, 0) > 0 THEN 100 ELSE 0 END
        END as evolution_reservations_pourcentage,
        
        CASE 
          WHEN COALESCE(map.clients_uniques, 0) > 0 
          THEN ROUND(((COALESCE(mac.clients_uniques, 0) - COALESCE(map.clients_uniques, 0)) / 
                     COALESCE(map.clients_uniques, 0)) * 100, 2)
          ELSE 
            CASE WHEN COALESCE(mac.clients_uniques, 0) > 0 THEN 100 ELSE 0 END
        END as evolution_clients_pourcentage
        
      FROM tous_mois tm
      LEFT JOIN mois_annee_courante mac ON tm.mois_num = EXTRACT(MONTH FROM mac.mois_date)
      LEFT JOIN mois_annee_precedente map ON tm.mois_num = EXTRACT(MONTH FROM map.mois_date)
      ORDER BY tm.mois_num DESC
    `, [anneeCourante, anneePrecedente]);

    // Structurer les données
    const donneesStructurees = result.rows.map(mois => {
      const caCourant = parseFloat(mois.ca_courant) || 0;
      const caPrecedent = parseFloat(mois.ca_precedent) || 0;
      const reservationsCourantes = parseInt(mois.reservations_courantes) || 0;
      const reservationsPrecedentes = parseInt(mois.reservations_precedentes) || 0;
      
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
          tarif_moyen: parseFloat(mois.tarif_moyen_courant) || 0,
          heures_totales: parseFloat(mois.heures_totales_courantes) || 0,
          terrains_utilises: parseInt(mois.terrains_utilises_courants) || 0,
          clients_uniques: parseInt(mois.clients_uniques_courants) || 0,
          tarif_horaire_moyen: parseFloat(mois.tarif_horaire_moyen_courant) || 0,
          periode_affichage: mois.periode_affichage_courante
        },
        
        // Données année précédente
        annee_precedente: {
          chiffre_affaires: caPrecedent,
          nombre_reservations: reservationsPrecedentes,
          tarif_moyen: parseFloat(mois.tarif_moyen_precedent) || 0,
          heures_totales: parseFloat(mois.heures_totales_precedentes) || 0,
          terrains_utilises: parseInt(mois.terrains_utilises_precedents) || 0,
          clients_uniques: parseInt(mois.clients_uniques_precedents) || 0,
          tarif_horaire_moyen: parseFloat(mois.tarif_horaire_moyen_precedent) || 0,
          periode_affichage: mois.periode_affichage_precedente
        },
        
        // Évolutions
        evolution: {
          ca: parseFloat(mois.evolution_ca_pourcentage) || 0,
          reservations: parseFloat(mois.evolution_reservations_pourcentage) || 0,
          clients: parseFloat(mois.evolution_clients_pourcentage) || 0,
          tendance_ca: tendanceCA,
          tendance_reservations: tendanceReservations,
          difference_ca: caCourant - caPrecedent,
          difference_reservations: reservationsCourantes - reservationsPrecedentes
        }
      };
    });

    // Statistiques globales
    const statsGlobales = result.rows.reduce((acc, mois) => {
      // Année courante
      acc.annee_courante.ca_total += parseFloat(mois.ca_courant) || 0;
      acc.annee_courante.reservations_total += parseInt(mois.reservations_courantes) || 0;
      acc.annee_courante.heures_total += parseFloat(mois.heures_totales_courantes) || 0;
      acc.annee_courante.clients_total += parseInt(mois.clients_uniques_courants) || 0;
      
      // Année précédente
      acc.annee_precedente.ca_total += parseFloat(mois.ca_precedent) || 0;
      acc.annee_precedente.reservations_total += parseInt(mois.reservations_precedentes) || 0;
      acc.annee_precedente.heures_total += parseFloat(mois.heures_totales_precedentes) || 0;
      acc.annee_precedente.clients_total += parseInt(mois.clients_uniques_precedents) || 0;
      
      // Compter les mois actifs
      if ((parseFloat(mois.ca_courant) || 0) > 0) acc.annee_courante.mois_actifs++;
      if ((parseFloat(mois.ca_precedent) || 0) > 0) acc.annee_precedente.mois_actifs++;
      
      return acc;
    }, {
      annee_courante: { 
        ca_total: 0, 
        reservations_total: 0, 
        heures_total: 0, 
        clients_total: 0, 
        mois_actifs: 0 
      },
      annee_precedente: { 
        ca_total: 0, 
        reservations_total: 0, 
        heures_total: 0, 
        clients_total: 0, 
        mois_actifs: 0 
      }
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

    // Calculer l'évolution globale
    const evolutionGlobaleCA = statsGlobales.annee_precedente.ca_total > 0
      ? ((statsGlobales.annee_courante.ca_total - statsGlobales.annee_precedente.ca_total) / 
         statsGlobales.annee_precedente.ca_total) * 100
      : statsGlobales.annee_courante.ca_total > 0 ? 100 : 0;
    
    const evolutionGlobaleReservations = statsGlobales.annee_precedente.reservations_total > 0
      ? ((statsGlobales.annee_courante.reservations_total - statsGlobales.annee_precedente.reservations_total) / 
         statsGlobales.annee_precedente.reservations_total) * 100
      : statsGlobales.annee_courante.reservations_total > 0 ? 100 : 0;

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
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse mensuelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📊 Analyse de rentabilité des créneaux horaires
router.get('/analyse-rentabilite-creneaux', async (req, res) => {
  try {
    const { periode = '90' } = req.query;
    const periodeInt = parseInt(periode);

    const result = await db.query(`
      WITH creneaux AS (
        SELECT 
          EXTRACT(HOUR FROM heurereservation) as heure_debut,
          EXTRACT(HOUR FROM heurefin) as heure_fin,
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          TO_CHAR(datereservation, 'Day') as nom_jour,
          COUNT(*) as nombre_reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires,
          COALESCE(AVG(tarif), 0) as tarif_moyen,
          COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as duree_moyenne,
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          COUNT(DISTINCT email) as clients_uniques,
          COALESCE(SUM(tarif), 0) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as revenu_par_heure
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
        GROUP BY 
          EXTRACT(HOUR FROM heurereservation),
          EXTRACT(HOUR FROM heurefin),
          EXTRACT(DOW FROM datereservation),
          TO_CHAR(datereservation, 'Day')
      )
      SELECT 
        heure_debut,
        heure_fin,
        jour_semaine,
        nom_jour,
        nombre_reservations,
        chiffre_affaires,
        tarif_moyen,
        duree_moyenne,
        terrains_utilises,
        clients_uniques,
        revenu_par_heure,
        ROUND((chiffre_affaires / NULLIF(SUM(chiffre_affaires) OVER (), 0)) * 100, 2) as pourcentage_ca_total
      FROM creneaux
      ORDER BY revenu_par_heure DESC, chiffre_affaires DESC
    `);

    // Analyse par plage horaire
    const analysePlages = await db.query(`
      SELECT 
        CASE 
          WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 6 AND 11 THEN 'Matin (6h-12h)'
          WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 12 AND 17 THEN 'Après-midi (12h-18h)'
          WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 18 AND 23 THEN 'Soirée (18h-00h)'
          ELSE 'Nuit (00h-6h)'
        END as plage_horaire,
        COUNT(*) as nombre_reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        COALESCE(AVG(tarif), 0) as tarif_moyen,
        COALESCE(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as duree_moyenne,
        ROUND(COALESCE(SUM(tarif), 0) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as revenu_par_heure
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
      GROUP BY plage_horaire
      ORDER BY chiffre_affaires DESC
    `);

    res.json({
      success: true,
      data: {
        analyse_creneaux: result.rows.map(row => ({
          ...row,
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          duree_moyenne: parseFloat(row.duree_moyenne),
          revenu_par_heure: parseFloat(row.revenu_par_heure),
          pourcentage_ca_total: parseFloat(row.pourcentage_ca_total)
        })),
        analyse_plages_horaires: analysePlages.rows.map(row => ({
          ...row,
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          duree_moyenne: parseFloat(row.duree_moyenne),
          revenu_par_heure: parseFloat(row.revenu_par_heure)
        })),
        creneaux_plus_rentables: result.rows
          .filter(row => row.nombre_reservations >= 5) // Minimum 5 réservations pour être significatif
          .slice(0, 10),
        creneaux_sous_utilises: result.rows
          .filter(row => row.nombre_reservations <= 2 && row.chiffre_affaires > 0)
          .sort((a, b) => a.nombre_reservations - b.nombre_reservations)
          .slice(0, 10)
      },
      periode_analyse: `${periode} jours`
    });

  } catch (error) {
    console.error('❌ Erreur analyse rentabilité créneaux:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📊 Analyse de la saisonnalité
router.get('/analyse-saisonnalite', async (req, res) => {
  try {
    const result = await db.query(`
      WITH donnees_saisonniere AS (
        SELECT 
          EXTRACT(YEAR FROM datereservation) as annee,
          EXTRACT(MONTH FROM datereservation) as mois,
          CASE 
            WHEN EXTRACT(MONTH FROM datereservation) IN (12, 1, 2) THEN 'Hiver'
            WHEN EXTRACT(MONTH FROM datereservation) IN (3, 4, 5) THEN 'Printemps'
            WHEN EXTRACT(MONTH FROM datereservation) IN (6, 7, 8) THEN 'Été'
            WHEN EXTRACT(MONTH FROM datereservation) IN (9, 10, 11) THEN 'Automne'
          END as saison,
          TO_CHAR(datereservation, 'Month') as nom_mois,
          COUNT(*) as nombre_reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires,
          COALESCE(AVG(tarif), 0) as tarif_moyen,
          COUNT(DISTINCT email) as clients_uniques,
          COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_total
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '3 years'
        GROUP BY 
          EXTRACT(YEAR FROM datereservation),
          EXTRACT(MONTH FROM datereservation),
          CASE 
            WHEN EXTRACT(MONTH FROM datereservation) IN (12, 1, 2) THEN 'Hiver'
            WHEN EXTRACT(MONTH FROM datereservation) IN (3, 4, 5) THEN 'Printemps'
            WHEN EXTRACT(MONTH FROM datereservation) IN (6, 7, 8) THEN 'Été'
            WHEN EXTRACT(MONTH FROM datereservation) IN (9, 10, 11) THEN 'Automne'
          END,
          TO_CHAR(datereservation, 'Month')
      ),
      stats_saison AS (
        SELECT 
          saison,
          COUNT(DISTINCT annee) as annees_analysees,
          SUM(nombre_reservations) as reservations_total,
          SUM(chiffre_affaires) as ca_total,
          AVG(chiffre_affaires) as ca_moyen_par_annee,
          AVG(tarif_moyen) as tarif_moyen_saison,
          SUM(clients_uniques) as clients_total,
          SUM(heures_total) as heures_total,
          ROUND(SUM(chiffre_affaires) / NULLIF(SUM(heures_total), 0), 2) as revenu_par_heure
        FROM donnees_saisonniere
        GROUP BY saison
      )
      SELECT 
        ss.saison,
        ss.annees_analysees,
        ss.reservations_total,
        ss.ca_total,
        ss.ca_moyen_par_annee,
        ss.tarif_moyen_saison,
        ss.clients_total,
        ss.heures_total,
        ss.revenu_par_heure,
        ROUND((ss.ca_total / NULLIF(SUM(ss.ca_total) OVER (), 0)) * 100, 2) as part_du_ca,
        ROUND(AVG(ds.nombre_reservations), 1) as reservations_moyennes_par_mois,
        ROUND(AVG(ds.chiffre_affaires), 2) as ca_moyen_par_mois
      FROM stats_saison ss
      LEFT JOIN donnees_saisonniere ds ON ss.saison = ds.saison
      GROUP BY 
        ss.saison, ss.annees_analysees, ss.reservations_total, ss.ca_total, 
        ss.ca_moyen_par_annee, ss.tarif_moyen_saison, ss.clients_total,
        ss.heures_total, ss.revenu_par_heure
      ORDER BY 
        CASE ss.saison
          WHEN 'Printemps' THEN 1
          WHEN 'Été' THEN 2
          WHEN 'Automne' THEN 3
          WHEN 'Hiver' THEN 4
        END
    `);

    // Analyse mensuelle détaillée
    const analyseMensuelle = await db.query(`
      SELECT 
        EXTRACT(MONTH FROM datereservation) as mois,
        TO_CHAR(datereservation, 'Month') as nom_mois,
        COUNT(*) as nombre_reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        COALESCE(AVG(tarif), 0) as tarif_moyen,
        COUNT(DISTINCT EXTRACT(YEAR FROM datereservation)) as annees_disponibles,
        ROUND(COALESCE(SUM(tarif), 0) / NULLIF(COUNT(DISTINCT EXTRACT(YEAR FROM datereservation)), 0), 2) as ca_moyen_annuel,
        ROUND(COUNT(*) / NULLIF(COUNT(DISTINCT EXTRACT(YEAR FROM datereservation)), 0), 1) as reservations_moyennes_annuelles
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '3 years'
      GROUP BY EXTRACT(MONTH FROM datereservation), TO_CHAR(datereservation, 'Month')
      ORDER BY mois
    `);

    res.json({
      success: true,
      data: {
        analyse_saisonniere: result.rows.map(row => ({
          ...row,
          ca_total: parseFloat(row.ca_total),
          ca_moyen_par_annee: parseFloat(row.ca_moyen_par_annee),
          tarif_moyen_saison: parseFloat(row.tarif_moyen_saison),
          revenu_par_heure: parseFloat(row.revenu_par_heure),
          part_du_ca: parseFloat(row.part_du_ca),
          ca_moyen_par_mois: parseFloat(row.ca_moyen_par_mois)
        })),
        analyse_mensuelle: analyseMensuelle.rows.map(row => ({
          mois: parseInt(row.mois),
          nom_mois: row.nom_mois.trim(),
          nombre_reservations: parseInt(row.nombre_reservations),
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          annees_disponibles: parseInt(row.annees_disponibles),
          ca_moyen_annuel: parseFloat(row.ca_moyen_annuel),
          reservations_moyennes_annuelles: parseFloat(row.reservations_moyennes_annuelles)
        })),
        saison_la_plus_rentable: result.rows.length > 0 
          ? result.rows.reduce((max, saison) => 
              saison.ca_moyen_par_annee > max.ca_moyen_par_annee ? saison : max
            , result.rows[0])
          : null,
        mois_meilleur_performance: analyseMensuelle.rows.length > 0
          ? analyseMensuelle.rows.reduce((max, mois) => 
              mois.ca_moyen_annuel > max.ca_moyen_annuel ? mois : max
            , analyseMensuelle.rows[0])
          : null
      },
      periode_analyse: '3 dernières années'
    });

  } catch (error) {
    console.error('❌ Erreur analyse saisonnalité:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📊 Analyse de la fidélisation client
router.get('/analyse-fidelisation', async (req, res) => {
  try {
    const { periode = '365' } = req.query;
    const periodeInt = parseInt(periode);

    // Segmentation des clients
    const segmentation = await db.query(`
      WITH client_stats AS (
        SELECT 
          email,
          nomclient,
          prenom,
          COUNT(*) as nombre_reservations,
          COALESCE(SUM(tarif), 0) as total_depense,
          MIN(datereservation) as premiere_reservation,
          MAX(datereservation) as derniere_reservation,
          EXTRACT(DAY FROM CURRENT_DATE - MAX(datereservation)) as jours_inactifs
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
        GROUP BY email, nomclient, prenom
      ),
      segments AS (
        SELECT 
          email,
          nomclient,
          prenom,
          nombre_reservations,
          total_depense,
          premiere_reservation,
          derniere_reservation,
          jours_inactifs,
          CASE 
            WHEN nombre_reservations >= 10 AND total_depense >= 1000 THEN 'VIP'
            WHEN nombre_reservations >= 5 OR total_depense >= 500 THEN 'Fidèle'
            WHEN nombre_reservations >= 2 THEN 'Occasionnel'
            ELSE 'Nouveau'
          END as segment,
          CASE 
            WHEN jours_inactifs <= 30 THEN 'Actif'
            WHEN jours_inactifs <= 90 THEN 'Semi-actif'
            ELSE 'Inactif'
          END as statut_activite
        FROM client_stats
      )
      SELECT 
        segment,
        statut_activite,
        COUNT(*) as nombre_clients,
        SUM(nombre_reservations) as total_reservations,
        SUM(total_depense) as chiffre_affaires_total,
        ROUND(AVG(nombre_reservations), 2) as reservations_moyennes,
        ROUND(AVG(total_depense), 2) as depense_moyenne,
        ROUND(AVG(jours_inactifs), 1) as inactivite_moyenne
      FROM segments
      GROUP BY segment, statut_activite
      ORDER BY 
        CASE segment
          WHEN 'VIP' THEN 1
          WHEN 'Fidèle' THEN 2
          WHEN 'Occasionnel' THEN 3
          WHEN 'Nouveau' THEN 4
        END,
        CASE statut_activite
          WHEN 'Actif' THEN 1
          WHEN 'Semi-actif' THEN 2
          WHEN 'Inactif' THEN 3
        END
    `);

    // Taux de rétention
    const tauxRetention = await db.query(`
      WITH clients_mensuels AS (
        SELECT 
          DATE_TRUNC('month', datereservation) as mois,
          COUNT(DISTINCT email) as nouveaux_clients,
          LAG(COUNT(DISTINCT email)) OVER (ORDER BY DATE_TRUNC('month', datereservation)) as clients_mois_precedent
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '1 year'
          AND NOT EXISTS (
            SELECT 1 
            FROM reservation r2 
            WHERE r2.email = reservation.email 
              AND r2.datereservation < DATE_TRUNC('month', reservation.datereservation)
          )
        GROUP BY DATE_TRUNC('month', datereservation)
      ),
      clients_revenus AS (
        SELECT 
          DATE_TRUNC('month', datereservation) as mois,
          COUNT(DISTINCT email) as clients_revenus,
          LAG(COUNT(DISTINCT email)) OVER (ORDER BY DATE_TRUNC('month', datereservation)) as clients_total_mois_precedent
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '1 year'
        GROUP BY DATE_TRUNC('month', datereservation)
      )
      SELECT 
        TO_CHAR(cm.mois, 'MM/YYYY') as mois,
        cm.nouveaux_clients,
        cm.clients_mois_precedent,
        cr.clients_revenus,
        cr.clients_total_mois_precedent,
        CASE 
          WHEN cm.clients_mois_precedent > 0 
          THEN ROUND((cr.clients_revenus::DECIMAL / cm.clients_mois_precedent) * 100, 2)
          ELSE 0 
        END as taux_retention
      FROM clients_mensuels cm
      JOIN clients_revenus cr ON cm.mois = cr.mois
      ORDER BY cm.mois DESC
    `);

    // Valeur à vie des clients (CLV)
    const clv = await db.query(`
      WITH client_lifetime AS (
        SELECT 
          email,
          COUNT(DISTINCT EXTRACT(YEAR FROM datereservation)) as annees_activite,
          COUNT(*) as total_reservations,
          COALESCE(SUM(tarif), 0) as total_depense,
          MIN(datereservation) as premiere_reservation,
          MAX(datereservation) as derniere_reservation
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        GROUP BY email
        HAVING COUNT(*) >= 2
      )
      SELECT 
        ROUND(AVG(total_depense / NULLIF(annees_activite, 0)), 2) as clv_moyen_annuel,
        ROUND(AVG(total_depense), 2) as clv_moyen_total,
        ROUND(AVG(EXTRACT(DAY FROM derniere_reservation - premiere_reservation) / 365), 2) as duree_moyenne_relation_annees,
        ROUND(AVG(total_reservations), 1) as reservations_moyennes,
        COUNT(*) as clients_analysees
      FROM client_lifetime
    `);

    res.json({
      success: true,
      data: {
        segmentation_clients: segmentation.rows.map(row => ({
          ...row,
          nombre_clients: parseInt(row.nombre_clients),
          total_reservations: parseInt(row.total_reservations),
          chiffre_affaires_total: parseFloat(row.chiffre_affaires_total),
          reservations_moyennes: parseFloat(row.reservations_moyennes),
          depense_moyenne: parseFloat(row.depense_moyenne),
          inactivite_moyenne: parseFloat(row.inactivite_moyenne)
        })),
        taux_retention: tauxRetention.rows.map(row => ({
          ...row,
          nouveaux_clients: parseInt(row.nouveaux_clients),
          clients_mois_precedent: parseInt(row.clients_mois_precedent),
          clients_revenus: parseInt(row.clients_revenus),
          taux_retention: parseFloat(row.taux_retention)
        })),
        valeur_a_vie_client: clv.rows[0] ? {
          clv_moyen_annuel: parseFloat(clv.rows[0].clv_moyen_annuel),
          clv_moyen_total: parseFloat(clv.rows[0].clv_moyen_total),
          duree_moyenne_relation_annees: parseFloat(clv.rows[0].duree_moyenne_relation_annees),
          reservations_moyennes: parseFloat(clv.rows[0].reservations_moyennes),
          clients_analysees: parseInt(clv.rows[0].clients_analysees)
        } : null,
        stats_synthese: {
          total_clients: segmentation.rows.reduce((sum, row) => sum + parseInt(row.nombre_clients), 0),
          ca_total: segmentation.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires_total), 0),
          taux_retention_moyen: tauxRetention.rows.length > 0 
            ? tauxRetention.rows.reduce((sum, row) => sum + parseFloat(row.taux_retention), 0) / tauxRetention.rows.length
            : 0
        }
      },
      periode_analyse: `${periode} jours`
    });

  } catch (error) {
    console.error('❌ Erreur analyse fidélisation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📊 Analyse de la marge et rentabilité
router.get('/analyse-marge-rentabilite', async (req, res) => {
  try {
    const { periode = '90' } = req.query;
    const periodeInt = parseInt(periode);

    // Note: Cette analyse suppose que vous avez des données de coût dans votre base
    // Si vous n'avez pas ces données, vous pouvez ajuster les estimations

    const result = await db.query(`
      WITH reservations_avec_couts AS (
        SELECT 
          r.*,
          -- Estimation des coûts variables (exemple: maintenance, électricité, eau)
          CASE 
            WHEN r.typeterrain = 'Tennis' THEN r.tarif * 0.3 -- 30% de coûts
            WHEN r.typeterrain = 'Padel' THEN r.tarif * 0.25 -- 25% de coûts
            WHEN r.typeterrain = 'Badminton' THEN r.tarif * 0.2 -- 20% de coûts
            ELSE r.tarif * 0.35 -- 35% pour les autres
          END as cout_variable_estime,
          
          -- Estimation des coûts fixes (amortissement, personnel, etc.)
          10.0 as cout_fixe_estime -- € par réservation
        FROM reservation r
        WHERE r.statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND r.datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
      ),
      analyse_detaillee AS (
        SELECT 
          typeterrain,
          COUNT(*) as nombre_reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires,
          COALESCE(AVG(tarif), 0) as tarif_moyen,
          COALESCE(SUM(cout_variable_estime), 0) as total_couts_variables,
          COUNT(*) * 10.0 as total_couts_fixes,
          COALESCE(SUM(tarif), 0) - COALESCE(SUM(cout_variable_estime), 0) as marge_brute,
          COALESCE(SUM(tarif), 0) - COALESCE(SUM(cout_variable_estime), 0) - (COUNT(*) * 10.0) as marge_nette,
          COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_total
        FROM reservations_avec_couts
        GROUP BY typeterrain
      )
      SELECT 
        typeterrain,
        nombre_reservations,
        chiffre_affaires,
        tarif_moyen,
        total_couts_variables,
        total_couts_fixes,
        marge_brute,
        marge_nette,
        heures_total,
        ROUND((marge_brute / NULLIF(chiffre_affaires, 0)) * 100, 2) as taux_marge_brute,
        ROUND((marge_nette / NULLIF(chiffre_affaires, 0)) * 100, 2) as taux_marge_nette,
        ROUND(marge_nette / NULLIF(heures_total, 0), 2) as rentabilite_par_heure,
        ROUND(marge_nette / NULLIF(nombre_reservations, 0), 2) as rentabilite_par_reservation
      FROM analyse_detaillee
      ORDER BY rentabilite_par_heure DESC
    `);

    // Analyse de rentabilité par heure
    const rentabiliteParHeure = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as nombre_reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        COALESCE(AVG(tarif), 0) as tarif_moyen,
        -- Estimation simplifiée de la marge
        COALESCE(SUM(tarif * 0.7), 0) as marge_estimee,
        ROUND(COALESCE(AVG(tarif * 0.7), 0), 2) as marge_moyenne_par_reservation,
        ROUND(COALESCE(SUM(tarif * 0.7), 0) / NULLIF(COUNT(*), 0), 2) as rentabilite_moyenne_par_reservation
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `);

    // Analyse globale de rentabilité
    const analyseGlobale = await db.query(`
      SELECT 
        COUNT(*) as total_reservations,
        COALESCE(SUM(tarif), 0) as ca_total,
        COALESCE(AVG(tarif), 0) as tarif_moyen_global,
        -- Estimations de rentabilité
        COALESCE(SUM(tarif * 0.7), 0) as marge_brute_estimee,
        COALESCE(SUM(tarif * 0.7), 0) - (COUNT(*) * 10.0) as marge_nette_estimee,
        COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_total,
        COUNT(DISTINCT DATE(datereservation)) as jours_actifs
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
    `);

    const globale = analyseGlobale.rows[0];

    res.json({
      success: true,
      data: {
        analyse_marge_par_type: result.rows.map(row => ({
          ...row,
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          total_couts_variables: parseFloat(row.total_couts_variables),
          total_couts_fixes: parseFloat(row.total_couts_fixes),
          marge_brute: parseFloat(row.marge_brute),
          marge_nette: parseFloat(row.marge_nette),
          taux_marge_brute: parseFloat(row.taux_marge_brute),
          taux_marge_nette: parseFloat(row.taux_marge_nette),
          rentabilite_par_heure: parseFloat(row.rentabilite_par_heure),
          rentabilite_par_reservation: parseFloat(row.rentabilite_par_reservation)
        })),
        rentabilite_par_heure: rentabiliteParHeure.rows.map(row => ({
          heure: parseInt(row.heure),
          nombre_reservations: parseInt(row.nombre_reservations),
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          marge_estimee: parseFloat(row.marge_estimee),
          marge_moyenne_par_reservation: parseFloat(row.marge_moyenne_par_reservation),
          rentabilite_moyenne_par_reservation: parseFloat(row.rentabilite_moyenne_par_reservation)
        })),
        analyse_globale: globale ? {
          total_reservations: parseInt(globale.total_reservations),
          ca_total: parseFloat(globale.ca_total),
          tarif_moyen_global: parseFloat(globale.tarif_moyen_global),
          marge_brute_estimee: parseFloat(globale.marge_brute_estimee),
          marge_nette_estimee: parseFloat(globale.marge_nette_estimee),
          heures_total: parseFloat(globale.heures_total),
          jours_actifs: parseInt(globale.jours_actifs),
          ca_moyen_journalier: parseFloat(globale.ca_total) / Math.max(1, parseInt(globale.jours_actifs)),
          marge_moyenne_journaliere: parseFloat(globale.marge_nette_estimee) / Math.max(1, parseInt(globale.jours_actifs)),
          taux_marge_nette_estime: (parseFloat(globale.marge_nette_estimee) / parseFloat(globale.ca_total)) * 100,
          rentabilite_horaire_estimee: parseFloat(globale.marge_nette_estimee) / parseFloat(globale.heures_total)
        } : null,
        type_le_plus_rentable: result.rows.length > 0 
          ? result.rows.reduce((max, type) => 
              type.rentabilite_par_heure > max.rentabilite_par_heure ? type : max
            , result.rows[0])
          : null
      },
      periode_analyse: `${periode} jours`,
      notes: [
        "Les coûts sont estimés sur la base de moyennes sectorielles",
        "Pour des analyses précises, intégrez vos données de coûts réelles",
        "Les coûts fixes sont estimés à 10€ par réservation",
        "Les marges brutes sont estimées entre 65% et 80% selon le type de terrain"
      ]
    });

  } catch (error) {
    console.error('❌ Erreur analyse marge rentabilité:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📊 Analyse de la performance des canaux de réservation
router.get('/analyse-canaux-reservation', async (req, res) => {
  try {
    // Cette analyse suppose que vous avez un champ 'canal_reservation' ou similaire
    // Si ce champ n'existe pas, vous pouvez estimer les canaux basés sur d'autres critères

    const result = await db.query(`
      WITH canaux_estimes AS (
        SELECT 
          CASE 
            WHEN email LIKE '%@%' AND telephone IS NOT NULL THEN 'Site Web'
            WHEN telephone IS NOT NULL AND email IS NULL THEN 'Téléphone'
            WHEN prenom = 'Admin' OR nomclient = 'Admin' THEN 'Administration'
            ELSE 'Direct'
          END as canal_estime,
          COUNT(*) as nombre_reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires,
          COALESCE(AVG(tarif), 0) as tarif_moyen,
          COUNT(DISTINCT email) as clients_uniques,
          MIN(datereservation) as premiere_reservation,
          MAX(datereservation) as derniere_reservation,
          ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 2) as duree_moyenne_heures
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY canal_estime
      )
      SELECT 
        canal_estime,
        nombre_reservations,
        chiffre_affaires,
        tarif_moyen,
        clients_uniques,
        premiere_reservation,
        derniere_reservation,
        duree_moyenne_heures,
        ROUND((chiffre_affaires / NULLIF(SUM(chiffre_affaires) OVER (), 0)) * 100, 2) as part_du_ca,
        ROUND((nombre_reservations::DECIMAL / NULLIF(SUM(nombre_reservations) OVER (), 0)) * 100, 2) as part_des_reservations,
        ROUND(chiffre_affaires / NULLIF(clients_uniques, 0), 2) as valeur_client_moyenne
      FROM canaux_estimes
      ORDER BY chiffre_affaires DESC
    `);

    // Analyse de l'évolution des canaux dans le temps
    const evolutionCanaux = await db.query(`
      WITH canaux_mensuels AS (
        SELECT 
          DATE_TRUNC('month', datereservation) as mois,
          CASE 
            WHEN email LIKE '%@%' AND telephone IS NOT NULL THEN 'Site Web'
            WHEN telephone IS NOT NULL AND email IS NULL THEN 'Téléphone'
            WHEN prenom = 'Admin' OR nomclient = 'Admin' THEN 'Administration'
            ELSE 'Direct'
          END as canal_estime,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', datereservation), canal_estime
      )
      SELECT 
        TO_CHAR(mois, 'MM/YYYY') as mois,
        canal_estime,
        reservations,
        chiffre_affaires,
        ROUND((chiffre_affaires / NULLIF(SUM(chiffre_affaires) OVER (PARTITION BY mois), 0)) * 100, 2) as part_du_ca_mois
      FROM canaux_mensuels
      ORDER BY mois DESC, chiffre_affaires DESC
    `);

    res.json({
      success: true,
      data: {
        performance_canaux: result.rows.map(row => ({
          ...row,
          nombre_reservations: parseInt(row.nombre_reservations),
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          tarif_moyen: parseFloat(row.tarif_moyen),
          clients_uniques: parseInt(row.clients_uniques),
          duree_moyenne_heures: parseFloat(row.duree_moyenne_heures),
          part_du_ca: parseFloat(row.part_du_ca),
          part_des_reservations: parseFloat(row.part_des_reservations),
          valeur_client_moyenne: parseFloat(row.valeur_client_moyenne)
        })),
        evolution_canaux: evolutionCanaux.rows.map(row => ({
          mois: row.mois,
          canal_estime: row.canal_estime,
          reservations: parseInt(row.reservations),
          chiffre_affaires: parseFloat(row.chiffre_affaires),
          part_du_ca_mois: parseFloat(row.part_du_ca_mois)
        })),
        canal_le_plus_rentable: result.rows.length > 0 
          ? result.rows.reduce((max, canal) => 
              canal.valeur_client_moyenne > max.valeur_client_moyenne ? canal : max
            , result.rows[0])
          : null,
        canal_plus_croissant: evolutionCanaux.rows.length > 2
          ? analyserCroissanceCanaux(evolutionCanaux.rows)
          : []
      },
      periode_analyse: '90 jours',
      notes: [
        "Les canaux sont estimés sur la base des informations disponibles",
        "Pour des analyses précises, ajoutez un champ 'canal_reservation' dans votre base",
        "Le canal 'Site Web' est estimé pour les clients avec email",
        "Le canal 'Téléphone' est estimé pour les clients sans email"
      ]
    });

  } catch (error) {
    console.error('❌ Erreur analyse canaux réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📊 Analyse de la capacité d'optimisation des prix
router.get('/analyse-optimisation-prix', async (req, res) => {
  try {
    const { periode = '90' } = req.query;
    const periodeInt = parseInt(periode);

    const result = await db.query(`
      WITH analyse_prix AS (
        SELECT 
          typeterrain,
          EXTRACT(HOUR FROM heurereservation) as heure,
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          TO_CHAR(datereservation, 'Day') as nom_jour,
          COUNT(*) as demandes,
          COALESCE(SUM(tarif), 0) as revenu_total,
          COALESCE(AVG(tarif), 0) as prix_moyen,
          COALESCE(MIN(tarif), 0) as prix_minimum,
          COALESCE(MAX(tarif), 0) as prix_maximum,
          COUNT(DISTINCT DATE(datereservation)) as jours_observation,
          ROUND(COUNT(*) / NULLIF(COUNT(DISTINCT DATE(datereservation)), 0), 2) as demande_moyenne_par_jour,
          ROUND(COALESCE(AVG(tarif), 0) * COUNT(*) / NULLIF(COUNT(DISTINCT DATE(datereservation)), 0), 2) as revenu_moyen_par_jour
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
        GROUP BY typeterrain, EXTRACT(HOUR FROM heurereservation), 
                 EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ),
      elasticite AS (
        SELECT 
          typeterrain,
          heure,
          jour_semaine,
          nom_jour,
          demandes,
          revenu_total,
          prix_moyen,
          prix_minimum,
          prix_maximum,
          jours_observation,
          demande_moyenne_par_jour,
          revenu_moyen_par_jour,
          -- Calcul de l'élasticité estimée (simplifié)
          CASE 
            WHEN demandes > 10 AND jours_observation > 5 THEN
              ROUND((demande_moyenne_par_jour / NULLIF(prix_moyen, 0)) * -0.5, 3) -- Estimation simplifiée
            ELSE 0
          END as elasticite_estimee,
          -- Potentiel d'optimisation
          CASE 
            WHEN demande_moyenne_par_jour > 2 AND prix_moyen < prix_maximum * 0.8 THEN 'Augmentation possible'
            WHEN demande_moyenne_par_jour < 0.5 AND prix_moyen > prix_minimum * 1.2 THEN 'Réduction possible'
            ELSE 'Prix optimal'
          END as recommandation_prix
        FROM analyse_prix
      )
      SELECT 
        *,
        CASE recommandation_prix
          WHEN 'Augmentation possible' THEN ROUND(prix_moyen * 1.1, 2)
          WHEN 'Réduction possible' THEN ROUND(prix_moyen * 0.9, 2)
          ELSE prix_moyen
        END as prix_suggere,
        CASE recommandation_prix
          WHEN 'Augmentation possible' THEN 
            ROUND((demande_moyenne_par_jour * 0.9) * (prix_moyen * 1.1) * jours_observation, 2)
          WHEN 'Réduction possible' THEN
            ROUND((demande_moyenne_par_jour * 1.1) * (prix_moyen * 0.9) * jours_observation, 2)
          ELSE revenu_total
        END as revenu_projete
      FROM elasticite
      ORDER BY (revenu_projete - revenu_total) DESC
    `);

    // Analyse des opportunités de prix dynamique
    const opportunites = await db.query(`
      SELECT 
        typeterrain,
        heure,
        CASE 
          WHEN heure BETWEEN 17 AND 21 THEN 'Pointe'
          WHEN heure BETWEEN 12 AND 16 THEN 'Standard'
          ELSE 'Creuse'
        END as periode_journee,
        AVG(CASE WHEN EXTRACT(DOW FROM datereservation) IN (5, 6) THEN tarif ELSE NULL END) as prix_weekend,
        AVG(CASE WHEN EXTRACT(DOW FROM datereservation) BETWEEN 0 AND 4 THEN tarif ELSE NULL END) as prix_semaine,
        COUNT(*) as total_reservations,
        ROUND(AVG(tarif), 2) as prix_moyen_global,
        ROUND(STDDEV(tarif), 2) as ecart_type_prix
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
        AND datereservation >= CURRENT_DATE - INTERVAL '${periodeInt} days'
      GROUP BY typeterrain, heure
      ORDER BY typeterrain, heure
    `);

    res.json({
      success: true,
      data: {
        analyse_optimisation_prix: result.rows.map(row => ({
          ...row,
          demandes: parseInt(row.demandes),
          revenu_total: parseFloat(row.revenu_total),
          prix_moyen: parseFloat(row.prix_moyen),
          prix_minimum: parseFloat(row.prix_minimum),
          prix_maximum: parseFloat(row.prix_maximum),
          jours_observation: parseInt(row.jours_observation),
          demande_moyenne_par_jour: parseFloat(row.demande_moyenne_par_jour),
          revenu_moyen_par_jour: parseFloat(row.revenu_moyen_par_jour),
          elasticite_estimee: parseFloat(row.elasticite_estimee),
          prix_suggere: parseFloat(row.prix_suggere),
          revenu_projete: parseFloat(row.revenu_projete)
        })),
        opportunites_prix_dynamique: opportunites.rows.map(row => ({
          ...row,
          prix_weekend: parseFloat(row.prix_weekend),
          prix_semaine: parseFloat(row.prix_semaine),
          total_reservations: parseInt(row.total_reservations),
          prix_moyen_global: parseFloat(row.prix_moyen_global),
          ecart_type_prix: parseFloat(row.ecart_type_prix),
          difference_weekend_semaine: parseFloat(row.prix_weekend) - parseFloat(row.prix_semaine),
          potentiel_augmentation: row.periode_journee === 'Pointe' ? 'Élevé' : 
                                 row.periode_journee === 'Standard' ? 'Modéré' : 'Faible'
        })),
        recommendations_synthese: {
          augmentations_recommandees: result.rows.filter(r => r.recommandation_prix === 'Augmentation possible').length,
          reductions_recommandees: result.rows.filter(r => r.recommandation_prix === 'Réduction possible').length,
          gain_potentiel_total: result.rows.reduce((sum, row) => 
            sum + (parseFloat(row.revenu_projete) - parseFloat(row.revenu_total)), 0),
          meilleures_opportunites: result.rows
            .filter(r => Math.abs(parseFloat(row.revenu_projete) - parseFloat(row.revenu_total)) > 100)
            .slice(0, 5)
        }
      },
      periode_analyse: `${periode} jours`,
      methode: "Analyse basée sur l'élasticité-prix estimée et les patterns de demande"
    });

  } catch (error) {
    console.error('❌ Erreur analyse optimisation prix:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 📊 Rapport financier complet
router.get('/rapport-financier-complet', async (req, res) => {
  try {
    const { annee } = req.query;
    const anneeCourante = annee ? parseInt(annee) : new Date().getFullYear();
    const anneePrecedente = anneeCourante - 1;

    // Exécuter toutes les analyses en parallèle
    const [
      analyseMensuelle,
      analyseSaisonniere,
      analyseRentabilite,
      analyseFidelisation,
      analyseCanaux,
      analyseOptimisationPrix,
      analyseMarge
    ] = await Promise.all([
      // Analyse mensuelle
      db.query(`
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(YEAR FROM datereservation) = $1
        GROUP BY EXTRACT(MONTH FROM datereservation)
        ORDER BY mois
      `, [anneeCourante]),
      
      // Analyse saisonnière
      db.query(`
        SELECT 
          CASE 
            WHEN EXTRACT(MONTH FROM datereservation) IN (12, 1, 2) THEN 'Hiver'
            WHEN EXTRACT(MONTH FROM datereservation) IN (3, 4, 5) THEN 'Printemps'
            WHEN EXTRACT(MONTH FROM datereservation) IN (6, 7, 8) THEN 'Été'
            WHEN EXTRACT(MONTH FROM datereservation) IN (9, 10, 11) THEN 'Automne'
          END as saison,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(YEAR FROM datereservation) = $1
        GROUP BY saison
      `, [anneeCourante]),
      
      // Analyse rentabilité par type de terrain
      db.query(`
        SELECT 
          typeterrain,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires,
          COALESCE(AVG(tarif), 0) as tarif_moyen
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(YEAR FROM datereservation) = $1
        GROUP BY typeterrain
        ORDER BY chiffre_affaires DESC
      `, [anneeCourante]),
      
      // Analyse fidélisation
      db.query(`
        SELECT 
          COUNT(DISTINCT email) as clients_uniques,
          COUNT(*) as total_reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires_total,
          ROUND(AVG(nombre_reservations), 1) as reservations_moyennes_par_client
        FROM (
          SELECT 
            email,
            COUNT(*) as nombre_reservations,
            COALESCE(SUM(tarif), 0) as depense_totale
          FROM reservation
          WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
            AND EXTRACT(YEAR FROM datereservation) = $1
          GROUP BY email
        ) client_stats
      `, [anneeCourante]),
      
      // Analyse des meilleurs clients
      db.query(`
        SELECT 
          email,
          nomclient,
          prenom,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as total_depense
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(YEAR FROM datereservation) = $1
        GROUP BY email, nomclient, prenom
        ORDER BY total_depense DESC
        LIMIT 10
      `, [anneeCourante]),
      
      // Analyse comparaison avec année précédente
      db.query(`
        SELECT 
          'année_courante' as periode,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(YEAR FROM datereservation) = $1
        UNION ALL
        SELECT 
          'année_précédente' as periode,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(YEAR FROM datereservation) = $2
      `, [anneeCourante, anneePrecedente]),
      
      // Analyse des heures de pointe
      db.query(`
        SELECT 
          EXTRACT(HOUR FROM heurereservation) as heure,
          COUNT(*) as reservations,
          COALESCE(SUM(tarif), 0) as chiffre_affaires
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'confirmé', 'payée')
          AND EXTRACT(YEAR FROM datereservation) = $1
        GROUP BY EXTRACT(HOUR FROM heurereservation)
        ORDER BY chiffre_affaires DESC
        LIMIT 5
      `, [anneeCourante])
    ]);

    // Compiler les résultats
    const rapport = {
      periode: anneeCourante,
      resume: {
        total_reservations: parseInt(analyseMensuelle.rows.reduce((sum, row) => sum + parseInt(row.reservations), 0)),
        chiffre_affaires_total: parseFloat(analyseMensuelle.rows.reduce((sum, row) => sum + parseFloat(row.chiffre_affaires), 0)),
        clients_uniques: parseInt(analyseFidelisation.rows[0]?.clients_uniques || 0),
        reservations_moyennes_par_client: parseFloat(analyseFidelisation.rows[0]?.reservations_moyennes_par_client || 0)
      },
      performance_mensuelle: analyseMensuelle.rows.map(row => ({
        mois: parseInt(row.mois),
        reservations: parseInt(row.reservations),
        chiffre_affaires: parseFloat(row.chiffre_affaires)
      })),
      performance_saisonniere: analyseSaisonniere.rows.map(row => ({
        saison: row.saison,
        reservations: parseInt(row.reservations),
        chiffre_affaires: parseFloat(row.chiffre_affaires),
        part_du_ca: (parseFloat(row.chiffre_affaires) / 
          analyseSaisonniere.rows.reduce((sum, r) => sum + parseFloat(r.chiffre_affaires), 0)) * 100
      })),
      performance_terrains: analyseRentabilite.rows.map(row => ({
        type: row.typeterrain,
        reservations: parseInt(row.reservations),
        chiffre_affaires: parseFloat(row.chiffre_affaires),
        tarif_moyen: parseFloat(row.tarif_moyen),
        part_du_ca: (parseFloat(row.chiffre_affaires) / 
          analyseRentabilite.rows.reduce((sum, r) => sum + parseFloat(r.chiffre_affaires), 0)) * 100
      })),
      top_clients: analyseCanaux.rows.map(row => ({
        client: `${row.prenom} ${row.nomclient}`,
        email: row.email,
        reservations: parseInt(row.reservations),
        total_depense: parseFloat(row.total_depense)
      })),
      evolution_annuelle: {
        annee_courante: {
          reservations: parseInt(analyseOptimisationPrix.rows[0]?.reservations || 0),
          chiffre_affaires: parseFloat(analyseOptimisationPrix.rows[0]?.chiffre_affaires || 0)
        },
        annee_precedente: {
          reservations: parseInt(analyseOptimisationPrix.rows[1]?.reservations || 0),
          chiffre_affaires: parseFloat(analyseOptimisationPrix.rows[1]?.chiffre_affaires || 0)
        },
        evolution: analyseOptimisationPrix.rows[0] && analyseOptimisationPrix.rows[1] ? {
          reservations: ((parseInt(analyseOptimisationPrix.rows[0].reservations) - 
                         parseInt(analyseOptimisationPrix.rows[1].reservations)) / 
                         parseInt(analyseOptimisationPrix.rows[1].reservations)) * 100,
          chiffre_affaires: ((parseFloat(analyseOptimisationPrix.rows[0].chiffre_affaires) - 
                            parseFloat(analyseOptimisationPrix.rows[1].chiffre_affaires)) / 
                            parseFloat(analyseOptimisationPrix.rows[1].chiffre_affaires)) * 100
        } : { reservations: 0, chiffre_affaires: 0 }
      },
      heures_pointe: analyseMarge.rows.map(row => ({
        heure: parseInt(row.heure),
        reservations: parseInt(row.reservations),
        chiffre_affaires: parseFloat(row.chiffre_affaires)
      })),
      indicateurs_cles: {
        ca_moyen_mensuel: analyseMensuelle.rows.reduce((sum, row) => 
          sum + parseFloat(row.chiffre_affaires), 0) / Math.max(1, analyseMensuelle.rows.length),
        reservations_moyennes_mensuelles: analyseMensuelle.rows.reduce((sum, row) => 
          sum + parseInt(row.reservations), 0) / Math.max(1, analyseMensuelle.rows.length),
        valeur_client_moyenne: parseFloat(analyseFidelisation.rows[0]?.chiffre_affaires_total || 0) / 
          Math.max(1, parseInt(analyseFidelisation.rows[0]?.clients_uniques || 0)),
        meilleur_mois: analyseMensuelle.rows.length > 0 
          ? analyseMensuelle.rows.reduce((max, row) => 
              parseFloat(row.chiffre_affaires) > parseFloat(max.chiffre_affaires) ? row : max
            , analyseMensuelle.rows[0])
          : null,
        meilleur_type_terrain: analyseRentabilite.rows.length > 0 
          ? analyseRentabilite.rows.reduce((max, row) => 
              parseFloat(row.chiffre_affaires) > parseFloat(max.chiffre_affaires) ? row : max
            , analyseRentabilite.rows[0])
          : null
      }
    };

    res.json({
      success: true,
      data: rapport,
      metadata: {
        date_generation: new Date().toISOString(),
        annee_analyse: anneeCourante,
        periode_analyse: `Année ${anneeCourante}`,
        format: "Rapport financier complet"
      }
    });

  } catch (error) {
    console.error('❌ Erreur rapport financier complet:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Fonction pour analyser la croissance des canaux
function analyserCroissanceCanaux(evolutionData) {
  const croissance = {};
  
  // Grouper par canal
  const dataParCanal = {};
  evolutionData.forEach(row => {
    if (!dataParCanal[row.canal_estime]) {
      dataParCanal[row.canal_estime] = [];
    }
    dataParCanal[row.canal_estime].push(row);
  });
  
  // Calculer la croissance pour chaque canal
  Object.keys(dataParCanal).forEach(canal => {
    const data = dataParCanal[canal].sort((a, b) => 
      new Date(a.mois.split('/').reverse().join('-')) - 
      new Date(b.mois.split('/').reverse().join('-'))
    );
    
    if (data.length >= 2) {
      const dernierMois = data[data.length - 1];
      const avantDernierMois = data[data.length - 2];
      
      const croissanceCA = ((dernierMois.chiffre_affaires - avantDernierMois.chiffre_affaires) / 
                           avantDernierMois.chiffre_affaires) * 100;
      
      const croissanceReservations = ((dernierMois.reservations - avantDernierMois.reservations) / 
                                     avantDernierMois.reservations) * 100;
      
      croissance[canal] = {
        croissance_ca: Math.round(croissanceCA * 100) / 100,
        croissance_reservations: Math.round(croissanceReservations * 100) / 100,
        tendance: croissanceCA > 0 ? 'hausse' : croissanceCA < 0 ? 'baisse' : 'stable'
      };
    }
  });
  
  return Object.entries(croissance)
    .map(([canal, stats]) => ({ canal, ...stats }))
    .sort((a, b) => b.croissance_ca - a.croissance_ca);
}

// 📊 Export PDF du rapport financier (structure de base)
router.get('/export-pdf-rapport', async (req, res) => {
  try {
    const { annee } = req.query;
    const anneeCourante = annee ? parseInt(annee) : new Date().getFullYear();
    
    // Récupérer les données du rapport complet
    const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/financial-analysis/rapport-financier-complet?annee=${anneeCourante}`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error('Erreur lors de la récupération des données');
    }
    
    // Générer un rapport HTML simple (à convertir en PDF côté client ou avec une librairie)
    const rapportHTML = generateHTMLReport(data.data, anneeCourante);
    
    res.json({
      success: true,
      data: {
        html_content: rapportHTML,
        download_url: `/api/financial-analysis/download-rapport/${anneeCourante}`,
        metadata: {
          annee: anneeCourante,
          date_generation: new Date().toISOString(),
          format: 'HTML (prêt pour conversion PDF)'
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur export PDF rapport:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du rapport',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Fonction pour générer un rapport HTML
function generateHTMLReport(data, annee) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rapport Financier ${annee} - Complexe Sportif</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        h3 { color: #7f8c8d; }
        .section { margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 20px; margin: 10px 0; }
        .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .table th, .table td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        .table th { background-color: #3498db; color: white; }
        .positive { color: #27ae60; font-weight: bold; }
        .negative { color: #e74c3c; font-weight: bold; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
        .logo { font-size: 24px; font-weight: bold; color: #3498db; }
        .date { color: #7f8c8d; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        .summary-item { text-align: center; padding: 20px; background: #ecf0f1; border-radius: 5px; }
        .summary-value { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .summary-label { color: #7f8c8d; margin-top: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">COMPLEXE SPORTIF</div>
        <div class="date">${new Date().toLocaleDateString('fr-FR')}</div>
    </div>
    
    <h1>Rapport Financier ${annee}</h1>
    
    <div class="section">
        <h2>Résumé Annuel</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <div class="summary-value">${data.resume.chiffre_affaires_total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
                <div class="summary-label">Chiffre d'Affaires Total</div>
            </div>
            <div class="summary-item">
                <div class="summary-value">${data.resume.total_reservations.toLocaleString('fr-FR')}</div>
                <div class="summary-label">Réservations</div>
            </div>
            <div class="summary-item">
                <div class="summary-value">${data.resume.clients_uniques.toLocaleString('fr-FR')}</div>
                <div class="summary-label">Clients Uniques</div>
            </div>
            <div class="summary-item">
                <div class="summary-value">${data.resume.reservations_moyennes_par_client.toFixed(1)}</div>
                <div class="summary-label">Réservations/Client</div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <h2>Performance Mensuelle</h2>
        <table class="table">
            <thead>
                <tr>
                    <th>Mois</th>
                    <th>Réservations</th>
                    <th>Chiffre d'Affaires</th>
                    <th>CA Moyen/Réservation</th>
                </tr>
            </thead>
            <tbody>
                ${data.performance_mensuelle.map(mois => `
                <tr>
                    <td>${getMonthName(mois.mois)}</td>
                    <td>${mois.reservations.toLocaleString('fr-FR')}</td>
                    <td>${mois.chiffre_affaires.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                    <td>${(mois.chiffre_affaires / Math.max(1, mois.reservations)).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    
    <div class="section">
        <h2>Performance par Type de Terrain</h2>
        <table class="table">
            <thead>
                <tr>
                    <th>Type de Terrain</th>
                    <th>Réservations</th>
                    <th>Chiffre d'Affaires</th>
                    <th>Part du CA</th>
                    <th>Tarif Moyen</th>
                </tr>
            </thead>
            <tbody>
                ${data.performance_terrains.map(terrain => `
                <tr>
                    <td>${terrain.type}</td>
                    <td>${terrain.reservations.toLocaleString('fr-FR')}</td>
                    <td>${terrain.chiffre_affaires.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                    <td>${terrain.part_du_ca.toFixed(1)}%</td>
                    <td>${terrain.tarif_moyen.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    
    <div class="section">
        <h2>Top 10 Clients</h2>
        <table class="table">
            <thead>
                <tr>
                    <th>Client</th>
                    <th>Email</th>
                    <th>Réservations</th>
                    <th>Total Dépensé</th>
                </tr>
            </thead>
            <tbody>
                ${data.top_clients.map(client => `
                <tr>
                    <td>${client.client}</td>
                    <td>${client.email}</td>
                    <td>${client.reservations.toLocaleString('fr-FR')}</td>
                    <td>${client.total_depense.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
    
    <div class="section">
        <h2>Évolution Annuelle</h2>
        <div class="stat-card">
            <h3>Comparaison ${annee} vs ${annee - 1}</h3>
            <p>Chiffre d'Affaires: 
                ${data.evolution_annuelle.annee_courante.chiffre_affaires.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} 
                (${data.evolution_annuelle.evolution.chiffre_affaires > 0 ? '+' : ''}${data.evolution_annuelle.evolution.chiffre_affaires.toFixed(1)}%)
            </p>
            <p>Réservations: 
                ${data.evolution_annuelle.annee_courante.reservations.toLocaleString('fr-FR')} 
                (${data.evolution_annuelle.evolution.reservations > 0 ? '+' : ''}${data.evolution_annuelle.evolution.reservations.toFixed(1)}%)
            </p>
        </div>
    </div>
    
    <div class="section">
        <h2>Indicateurs Clés</h2>
        <div class="summary-grid">
            <div class="summary-item">
                <div class="summary-value">${data.indicateurs_cles.ca_moyen_mensuel.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
                <div class="summary-label">CA Mensuel Moyen</div>
            </div>
            <div class="summary-item">
                <div class="summary-value">${data.indicateurs_cles.reservations_moyennes_mensuelles.toFixed(0)}</div>
                <div class="summary-label">Réservations Mensuelles Moyennes</div>
            </div>
            <div class="summary-item">
                <div class="summary-value">${data.indicateurs_cles.valeur_client_moyenne.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</div>
                <div class="summary-label">Valeur Client Moyenne</div>
            </div>
        </div>
    </div>
    
    <div class="section">
        <h2>Meilleures Performances</h2>
        <div class="stat-card">
            <p><strong>Meilleur Mois:</strong> ${getMonthName(data.indicateurs_cles.meilleur_mois?.mois)} - 
               ${data.indicateurs_cles.meilleur_mois?.chiffre_affaires.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</p>
            <p><strong>Type de Terrain le Plus Rentable:</strong> ${data.indicateurs_cles.meilleur_type_terrain?.type} - 
               ${data.indicateurs_cles.meilleur_type_terrain?.chiffre_affaires.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</p>
        </div>
    </div>
    
    <footer style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #ddd; color: #7f8c8d; font-size: 0.9em;">
        <p>Rapport généré le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p>Complexe Sportif - Tous droits réservés © ${annee}</p>
    </footer>
</body>
</html>
  `;
}

// Fonction utilitaire pour obtenir le nom du mois
function getMonthName(monthNumber) {
  const months = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];
  return months[monthNumber - 1] || '';
}

// Export du router
export default router;