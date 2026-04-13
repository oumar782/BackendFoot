import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 INSIGHTS UTILISATEURS APPROFONDIS - EXTENSION DE USER.JS

// 🔍 Analyse comportementale complète des utilisateurs
router.get('/comportement-complet', async (req, res) => {
  try {
    const { periode = '30jours', segment = null } = req.query;

    let whereClause = `WHERE r.statut = 'confirmée'`;
    let params = [];

    if (periode === '30jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '30 days'`;
    } else if (periode === '7jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '7 days'`;
    } else if (periode === '90jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '90 days'`;
    }

    // 1. Segmentation comportementale avancée
    const segmentationAvancee = await db.query(`
      WITH comportement_utilisateurs AS (
        SELECT 
          u.iduser,
          u.nom,
          u.prenom,
          u.email,
          u.typeuser,
          COUNT(r.*) as nb_reservations,
          COALESCE(SUM(r.tarif), 0) as depense_totale,
          MIN(r.datereservation) as premiere_reservation,
          MAX(r.datereservation) as derniere_reservation,
          COUNT(DISTINCT r.nomterrain) as terrains_explores,
          COUNT(DISTINCT EXTRACT(DOW FROM r.datereservation)) as jours_utilises,
          COUNT(DISTINCT EXTRACT(HOUR FROM r.heurereservation)) as horaires_utilises,
          ROUND(AVG(r.tarif), 2) as tarif_moyen,
          MAX(r.datereservation) - MIN(r.datereservation) as duree_relation_jours,
          CASE 
            WHEN COUNT(r.*) = 1 THEN 'NEW_CLIENT'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '7 days' THEN 'ACTIF_RECENT'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '30 days' THEN 'ACTIF'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '90 days' THEN 'INACTIF_RECENT'
            ELSE 'INACTIF_LONGUE'
          END as statut_activite
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.iduser, u.nom, u.prenom, u.email, u.typeuser
      )
      SELECT 
        statut_activite,
        COUNT(*) as nb_utilisateurs,
        SUM(nb_reservations) as total_reservations_segment,
        SUM(depense_totale) as depense_totale_segment,
        ROUND(AVG(nb_reservations)::numeric, 2) as reservations_moyennes_client,
        ROUND(AVG(depense_totale)::numeric, 2) as depense_moyenne_client,
        ROUND(AVG(terrains_explores)::numeric, 2) as diversite_terrains_moyenne,
        ROUND(AVG(duree_relation_jours)::numeric, 2) as duree_relation_moyenne,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2)::numeric as pourcentage_utilisateurs,
        ROUND(SUM(depense_totale) * 100.0 / SUM(SUM(depense_totale)) OVER(), 2)::numeric as part_revenu_total
      FROM comportement_utilisateurs
      GROUP BY statut_activite
      ORDER BY depense_totale_segment DESC
    `, params);

    // 2. Analyse des patterns de fidélité
    const patternsFidelite = await db.query(`
      WITH analyse_fidelite AS (
        SELECT 
          u.email,
          COUNT(r.*) as nb_reservations,
          COALESCE(SUM(r.tarif), 0) as depense_totale,
          MIN(r.datereservation) as premiere_resa,
          MAX(r.datereservation) as derniere_resa,
          COUNT(DISTINCT DATE_TRUNC('month', r.datereservation)) as mois_actifs,
          CASE 
            WHEN COUNT(r.*) >= 10 THEN 'TRÈS FIDÈLE'
            WHEN COUNT(r.*) >= 5 THEN 'FIDÈLE'
            WHEN COUNT(r.*) >= 3 THEN 'MODÉRÉMENT FIDÈLE'
            WHEN COUNT(r.*) = 2 THEN 'PEU FIDÈLE'
            ELSE 'NON FIDÈLE'
          END as niveau_fidelite,
          CASE 
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '14 days' THEN 'ENGAGEMENT ACTIF'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '30 days' THEN 'ENGAGEMENT RÉCENT'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '60 days' THEN 'ENGAGEMENT FAIBLE'
            ELSE 'ENGAGEMENT NUL'
          END as niveau_engagement
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.email
        HAVING COUNT(r.*) >= 1
      )
      SELECT 
        niveau_fidelite,
        niveau_engagement,
        COUNT(*) as nb_utilisateurs,
        SUM(nb_reservations) as total_reservations,
        SUM(depense_totale) as depense_totale,
        ROUND(AVG(nb_reservations), 2) as reservations_moyennes,
        ROUND(AVG(depense_totale), 2) as depense_moyenne,
        ROUND(AVG(mois_actifs), 2) as mois_actifs_moyens
      FROM analyse_fidelite
      GROUP BY niveau_fidelite, niveau_engagement
      ORDER BY depense_totale DESC
    `, params);

    // 3. Analyse des habitudes temporelles par utilisateur
    const habitudesTemporelles = await db.query(`
      WITH habitudes_utilisateurs AS (
        SELECT 
          u.email,
          u.nom,
          u.prenom,
          COUNT(r.*) as total_reservations,
          COUNT(*) FILTER (WHERE EXTRACT(DOW FROM r.datereservation) IN (5, 6)) as reservations_weekend,
          COUNT(*) FILTER (WHERE EXTRACT(DOW FROM r.datereservation) NOT IN (0, 6)) as reservations_semaine,
          COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 18 AND 22) as reservations_soir,
          COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 12 AND 14) as reservations_midi,
          COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 8 AND 12) as reservations_matin,
          CASE 
            WHEN COUNT(*) FILTER (WHERE EXTRACT(DOW FROM r.datereservation) IN (5, 6)) > COUNT(*) FILTER (WHERE EXTRACT(DOW FROM r.datereservation) NOT IN (0, 6))
            THEN 'PRÉFÉRENCE WEEK-END'
            WHEN COUNT(*) FILTER (WHERE EXTRACT(DOW FROM r.datereservation) IN (5, 6)) < COUNT(*) FILTER (WHERE EXTRACT(DOW FROM r.datereservation) NOT IN (0, 6))
            THEN 'PRÉFÉRENCE SEMAINE'
            ELSE 'SANS PRÉFÉRENCE'
          END as preference_jour,
          CASE 
            WHEN COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 18 AND 22) >= 
                 GREATEST(COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 12 AND 14),
                         COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 8 AND 12))
            THEN 'PRÉFÉRENCE SOIR'
            WHEN COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 12 AND 14) >= 
                 COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM r.heurereservation) BETWEEN 8 AND 12)
            THEN 'PRÉFÉRENCE MIDI'
            ELSE 'PRÉFÉRENCE MATIN'
          END as preference_horaire
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.email, u.nom, u.prenom
        HAVING COUNT(r.*) >= 3
      )
      SELECT 
        preference_jour,
        preference_horaire,
        COUNT(*) as nb_utilisateurs,
        SUM(total_reservations) as total_reservations_groupe,
        ROUND(AVG(total_reservations)::numeric, 2) as reservations_moyennes_groupe,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2)::numeric as pourcentage_utilisateurs
      FROM habitudes_utilisateurs
      GROUP BY preference_jour, preference_horaire
      ORDER BY total_reservations_groupe DESC
    `, params);

    // 4. Analyse des utilisateurs à haut potentiel
    const potentielUtilisateurs = await db.query(`
      WITH score_utilisateurs AS (
        SELECT 
          u.email,
          u.nom,
          u.prenom,
          COUNT(r.*) as nb_reservations,
          COALESCE(SUM(r.tarif), 0) as depense_totale,
          ROUND(AVG(r.tarif), 2) as tarif_moyen,
          COUNT(DISTINCT r.nomterrain) as diversite_terrains,
          CASE 
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '7 days' THEN 30
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '30 days' THEN 20
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '90 days' THEN 10
            ELSE 0
          END as score_recente,
          CASE 
            WHEN COUNT(r.*) >= 10 THEN 25
            WHEN COUNT(r.*) >= 5 THEN 15
            WHEN COUNT(r.*) >= 3 THEN 10
            ELSE 5
          END as score_frequence,
          CASE 
            WHEN COALESCE(SUM(r.tarif), 0) >= 500 THEN 25
            WHEN COALESCE(SUM(r.tarif), 0) >= 200 THEN 15
            WHEN COALESCE(SUM(r.tarif), 0) >= 100 THEN 10
            ELSE 5
          END as score_depense,
          CASE 
            WHEN COUNT(DISTINCT r.nomterrain) >= 5 THEN 20
            WHEN COUNT(DISTINCT r.nomterrain) >= 3 THEN 10
            ELSE 5
          END as score_diversite
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.email, u.nom, u.prenom
        HAVING COUNT(r.*) >= 1
      )
      SELECT 
        email,
        nom,
        prenom,
        nb_reservations,
        depense_totale,
        tarif_moyen,
        diversite_terrains,
        score_recente + score_frequence + score_depense + score_diversite as score_total,
        CASE 
          WHEN score_recente + score_frequence + score_depense + score_diversite >= 80 THEN 'VIP'
          WHEN score_recente + score_frequence + score_depense + score_diversite >= 60 THEN 'PRÉMIUM'
          WHEN score_recente + score_frequence + score_depense + score_diversite >= 40 THEN 'STANDARD'
          WHEN score_recente + score_frequence + score_depense + score_diversite >= 20 THEN 'DÉBUTANT'
          ELSE 'OCCASIONNEL'
        END as categorie_potentiel,
        CASE 
          WHEN score_recente >= 20 AND score_frequence >= 15 AND score_depense >= 15 
          THEN 'CONSERVER - CLIENT STRATÉGIQUE'
          WHEN score_recente < 10 AND score_frequence >= 15 
          THEN 'RÉACTIVER - ANCIEN CLIENT FAIBLE'
          WHEN score_recente >= 20 AND score_frequence < 10 
          THEN 'FIDÉLISER - NOUVEAU CLIENT PROMETTEUR'
          WHEN score_depense >= 20 AND score_frequence < 10 
          THEN 'DÉVELOPPER - GROS DÉPENSIER OCCASIONNEL'
          ELSE 'SURVEILLER'
        END as recommandation_action
      FROM score_utilisateurs
      ORDER BY score_total DESC
      LIMIT 50
    `, params);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        segmentation_avancee: segmentationAvancee.rows,
        patterns_fidelite: patternsFidelite.rows,
        habitudes_temporelles: habitudesTemporelles.rows,
        potentiel_utilisateurs: potentielUtilisateurs.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans comportement-complet:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse comportementale complète',
      error: error.message
    });
  }
});

// 📈 Analyse des cycles de vie utilisateurs
router.get('/cycles-vie', async (req, res) => {
  try {
    const { periode = '90jours' } = req.query;

    let whereClause = `WHERE r.statut = 'confirmée'`;
    
    if (periode === '90jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '90 days'`;
    } else if (periode === '180jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '180 days'`;
    }

    // 1. Analyse des cohortes d'acquisition
    const cohortesAcquisition = await db.query(`
      WITH cohortes_mensuelles AS (
        SELECT 
          DATE_TRUNC('month', MIN(r.datereservation)) as mois_acquisition,
          u.email,
          COUNT(r.*) as nb_reservations_cohorte,
          COALESCE(SUM(r.tarif), 0) as depense_cohorte,
          MIN(r.datereservation) as premiere_resa,
          MAX(r.datereservation) as derniere_resa
        FROM users u
        JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY DATE_TRUNC('month', MIN(r.datereservation)), u.email
      )
      SELECT 
        mois_acquisition,
        COUNT(*) as nb_clients_acquis,
        SUM(nb_reservations_cohorte) as total_reservations_cohorte,
        SUM(depense_cohorte) as depense_totale_cohorte,
        ROUND(AVG(nb_reservations_cohorte)::numeric, 2) as reservations_moyennes_client,
        ROUND(AVG(depense_cohorte)::numeric, 2) as depense_moyenne_client,
        ROUND(AVG(derniere_resa - premiere_resa)::numeric, 2) as duree_engagement_moyenne,
        ROUND(SUM(depense_cohorte) * 100.0 / SUM(SUM(depense_cohorte)) OVER(), 2)::numeric as part_revenu_total
      FROM cohortes_mensuelles
      GROUP BY mois_acquisition
      ORDER BY mois_acquisition DESC
    `);

    // 2. Analyse des taux de rétention par cohorte
    const retentionCohortes = await db.query(`
      WITH cohortes_base AS (
        SELECT 
          DATE_TRUNC('month', MIN(r.datereservation)) as mois_acquisition,
          u.email,
          MIN(r.datereservation) as premiere_resa
        FROM users u
        JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY DATE_TRUNC('month', MIN(r.datereservation)), u.email
      ),
      activite_mensuelle AS (
        SELECT 
          cb.mois_acquisition,
          cb.email,
          DATE_TRUNC('month', r.datereservation) as mois_activite,
          EXTRACT(MONTH FROM AGE(DATE_TRUNC('month', r.datereservation), cb.mois_acquisition)) as mois_depuis_acquisition,
          COUNT(r.*) as nb_reservations_mois
        FROM cohortes_base cb
        LEFT JOIN reservation r ON cb.email = r.email
          AND r.statut = 'confirmée'
          AND r.datereservation >= cb.premiere_resa
        GROUP BY cb.mois_acquisition, cb.email, DATE_TRUNC('month', r.datereservation)
      )
      SELECT 
        mois_acquisition,
        mois_depuis_acquisition,
        COUNT(DISTINCT email) as nb_clients_actifs,
        ROUND(
          COUNT(DISTINCT email) * 100.0 / 
          FIRST_VALUE(COUNT(DISTINCT email)) OVER (PARTITION BY mois_acquisition ORDER BY mois_depuis_acquisition), 
          2
        ) as taux_retention_pct,
        SUM(nb_reservations_mois) as total_reservations_mois
      FROM activite_mensuelle
      GROUP BY mois_acquisition, mois_depuis_acquisition
      HAVING COUNT(DISTINCT email) > 0
      ORDER BY mois_acquisition DESC, mois_depuis_acquisition
    `);

    // 3. Analyse des profils de churn (perte de clients)
    const analyseChurn = await db.query(`
      WITH comportement_clients AS (
        SELECT 
          u.email,
          u.nom,
          u.prenom,
          COUNT(r.*) as nb_reservations_total,
          COALESCE(SUM(r.tarif), 0) as depense_totale,
          MIN(r.datereservation) as premiere_resa,
          MAX(r.datereservation) as derniere_resa,
          ROUND(AVG(r.tarif), 2) as tarif_moyen,
          COUNT(DISTINCT r.nomterrain) as diversite_terrains,
          CASE 
            WHEN MAX(r.datereservation) < CURRENT_DATE - INTERVAL '90 days' THEN 'CHURN_LONG'
            WHEN MAX(r.datereservation) < CURRENT_DATE - INTERVAL '60 days' THEN 'CHURN_MOYEN'
            WHEN MAX(r.datereservation) < CURRENT_DATE - INTERVAL '30 days' THEN 'CHURN_COURT'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '7 days' THEN 'ACTIF'
            ELSE 'INACTIF_RECENT'
          END as statut_churn
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        WHERE r.statut = 'confirmée'
          AND r.datereservation >= CURRENT_DATE - INTERVAL '180 days'
        GROUP BY u.email, u.nom, u.prenom
        HAVING COUNT(r.*) >= 1
      )
      SELECT 
        statut_churn,
        COUNT(*) as nb_clients,
        SUM(nb_reservations_total) as total_reservations_groupe,
        SUM(depense_totale) as depense_totale_groupe,
        ROUND(AVG(nb_reservations_total), 2) as reservations_moyennes_groupe,
        ROUND(AVG(depense_totale), 2) as depense_moyenne_groupe,
        ROUND(AVG(diversite_terrains), 2) as diversite_moyenne_groupe,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as pourcentage_clients,
        CASE 
          WHEN statut_churn LIKE 'CHURN_%' THEN 
            ROUND(SUM(depense_totale) * 100.0 / SUM(SUM(depense_totale)) FILTER (WHERE statut_churn LIKE 'CHURN_%') OVER(), 2)
          ELSE 0
        END as part_revenu_perdu
      FROM comportement_clients
      GROUP BY statut_churn
      ORDER BY 
        CASE 
          WHEN statut_churn = 'ACTIF' THEN 1
          WHEN statut_churn = 'INACTIF_RECENT' THEN 2
          WHEN statut_churn = 'CHURN_COURT' THEN 3
          WHEN statut_churn = 'CHURN_MOYEN' THEN 4
          WHEN statut_churn = 'CHURN_LONG' THEN 5
        END
    `);

    // 4. Identification des clients à risque de churn
    const risqueChurn = await db.query(`
      WITH indicateurs_risque AS (
        SELECT 
          u.email,
          u.nom,
          u.prenom,
          COUNT(r.*) as nb_reservations,
          COALESCE(SUM(r.tarif), 0) as depense_totale,
          MAX(r.datereservation) as derniere_resa,
          ROUND(AVG(r.tarif), 2) as tarif_moyen,
          CURRENT_DATE - MAX(r.datereservation) as jours_inactivite,
          CASE 
            WHEN CURRENT_DATE - MAX(r.datereservation) > 60 THEN 40
            WHEN CURRENT_DATE - MAX(r.datereservation) > 30 THEN 25
            WHEN CURRENT_DATE - MAX(r.datereservation) > 14 THEN 15
            ELSE 0
          END as score_inactivite,
          CASE 
            WHEN COUNT(r.*) = 1 THEN 20
            WHEN COUNT(r.*) < 3 THEN 15
            WHEN COUNT(r.*) < 5 THEN 10
            ELSE 5
          END as score_frequence,
          CASE 
            WHEN COUNT(DISTINCT r.nomterrain) = 1 THEN 15
            WHEN COUNT(DISTINCT r.nomterrain) = 2 THEN 10
            ELSE 5
          END as score_diversite
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        WHERE r.statut = 'confirmée'
          AND r.datereservation >= CURRENT_DATE - INTERVAL '180 days'
        GROUP BY u.email, u.nom, u.prenom
        HAVING COUNT(r.*) >= 1
      )
      SELECT 
        email,
        nom,
        prenom,
        nb_reservations,
        depense_totale,
        tarif_moyen,
        jours_inactivite,
        score_inactivite + score_frequence + score_diversite as score_risque_total,
        CASE 
          WHEN score_inactivite + score_frequence + score_diversite >= 60 THEN 'RISQUE ÉLEVÉ'
          WHEN score_inactivite + score_frequence + score_diversite >= 40 THEN 'RISQUE MODÉRÉ'
          WHEN score_inactivite + score_frequence + score_diversite >= 20 THEN 'RISQUE FAIBLE'
          ELSE 'RISQUE MINIMAL'
        END as niveau_risque,
        CASE 
          WHEN score_inactivite + score_frequence + score_diversite >= 60 THEN 'ACTION IMMÉDIATE RECOMMANDÉE'
          WHEN score_inactivite + score_frequence + score_diversite >= 40 THEN 'PLAN DE RÉACTIVATION RECOMMANDÉ'
          WHEN score_inactivite + score_frequence + score_diversite >= 20 THEN 'SURVEILLANCE RENFORCÉE'
          ELSE 'MAINTENIR STATU QUO'
        END as recommandation_action
      FROM indicateurs_risque
      WHERE score_inactivite + score_frequence + score_diversite >= 20
      ORDER BY score_risque_total DESC, depense_totale DESC
      LIMIT 30
    `);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        cohortes_acquisition: cohortesAcquisition.rows,
        retention_cohortes: retentionCohortes.rows,
        analyse_churn: analyseChurn.rows,
        risque_churn: risqueChurn.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans cycles-vie:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des cycles de vie utilisateurs',
      error: error.message
    });
  }
});

// 🎯 Analyse des segments d'utilisateurs pour actions marketing
router.get('/segments-marketing', async (req, res) => {
  try {
    const { periode = '30jours' } = req.query;

    let whereClause = `WHERE r.statut = 'confirmée'`;
    
    if (periode === '30jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '30 days'`;
    }

    // 1. Segmentation RFM (Récence, Fréquence, Montant)
    const segmentationRFM = await db.query(`
      WITH scores_rfm AS (
        SELECT 
          u.email,
          u.nom,
          u.prenom,
          COUNT(r.*) as frequence,
          COALESCE(SUM(r.tarif), 0) as montant,
          CASE 
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '7 days' THEN 5
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '14 days' THEN 4
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '30 days' THEN 3
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '60 days' THEN 2
            ELSE 1
          END as score_recence,
          CASE 
            WHEN COUNT(r.*) >= 10 THEN 5
            WHEN COUNT(r.*) >= 7 THEN 4
            WHEN COUNT(r.*) >= 5 THEN 3
            WHEN COUNT(r.*) >= 3 THEN 2
            ELSE 1
          END as score_frequence,
          CASE 
            WHEN COALESCE(SUM(r.tarif), 0) >= 500 THEN 5
            WHEN COALESCE(SUM(r.tarif), 0) >= 300 THEN 4
            WHEN COALESCE(SUM(r.tarif), 0) >= 150 THEN 3
            WHEN COALESCE(SUM(r.tarif), 0) >= 50 THEN 2
            ELSE 1
          END as score_montant
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.email, u.nom, u.prenom
        HAVING COUNT(r.*) >= 1
      )
      SELECT 
        score_recence,
        score_frequence,
        score_montant,
        COUNT(*) as nb_clients,
        SUM(frequence) as total_frequence_segment,
        SUM(montant) as total_montant_segment,
        ROUND(AVG(frequence)::numeric, 2) as frequence_moyenne_segment,
        ROUND(AVG(montant)::numeric, 2) as montant_moyen_segment,
        CASE 
          WHEN score_recence >= 4 AND score_frequence >= 4 AND score_montant >= 4 THEN 'CHAMPIONS'
          WHEN score_recence >= 4 AND score_frequence >= 3 AND score_montant >= 3 THEN 'CLIENTS LOYAUX'
          WHEN score_recence >= 3 AND score_frequence >= 3 AND score_montant >= 3 THEN 'CLIENTS POTENTIELS'
          WHEN score_recence >= 4 AND score_frequence <= 2 AND score_montant <= 2 THEN 'NOUVEAUX CLIENTS'
          WHEN score_recence <= 2 AND score_frequence >= 4 AND score_montant >= 4 THEN 'CLIENTS À RÉACTIVER'
          WHEN score_recence <= 2 AND score_frequence <= 2 AND score_montant <= 2 THEN 'CLIENTS PERDUS'
          WHEN score_recence >= 3 AND score_frequence <= 2 AND score_montant >= 3 THEN 'DÉPENSIERS OCCASIONNELS'
            ELSE 'AUTRES'
        END as segment_rfm,
        CASE 
          WHEN score_recence >= 4 AND score_frequence >= 4 AND score_montant >= 4 THEN 'PROGRAMME FIDÉLITÉ VIP'
          WHEN score_recence >= 4 AND score_frequence >= 3 AND score_montant >= 3 THEN 'OFFRES EXCLUSIVES'
          WHEN score_recence >= 3 AND score_frequence >= 3 AND score_montant >= 3 THEN 'PROMOTIONS PERSONNALISÉES'
          WHEN score_recence >= 4 AND score_frequence <= 2 AND score_montant <= 2 THEN 'DÉCOUVERTE SERVICES'
          WHEN score_recence <= 2 AND score_frequence >= 4 AND score_montant >= 4 THEN 'CAMPAGNE RÉACTIVATION'
          WHEN score_recence <= 2 AND score_frequence <= 2 AND score_montant <= 2 THEN 'CAMPAGNE DE RETOUR'
          WHEN score_recence >= 3 AND score_frequence <= 2 AND score_montant >= 3 THEN 'OFFRES SPÉCIALES'
          ELSE 'SURVEILLANCE'
        END as action_marketing
      FROM scores_rfm
      GROUP BY score_recence, score_frequence, score_montant
      ORDER BY total_montant_segment DESC
    `);

    // 2. Analyse des préférences par segment
    const preferencesSegments = await db.query(`
      WITH segments_utilisateurs AS (
        SELECT 
          u.email,
          CASE 
            WHEN COUNT(r.*) >= 10 THEN 'VIP'
            WHEN COUNT(r.*) >= 5 THEN 'PRÉMIUM'
            WHEN COUNT(r.*) >= 2 THEN 'RÉGULIER'
            ELSE 'OCCASIONNEL'
          END as segment_volume
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.email
        HAVING COUNT(r.*) >= 1
      )
      SELECT 
        su.segment_volume,
        r.typeTerrain,
        r.nomterrain,
        COUNT(*) as nb_reservations_segment,
        COUNT(DISTINCT su.email) as nb_clients_segment,
        COALESCE(SUM(r.tarif), 0) as revenu_segment,
        ROUND(AVG(r.tarif), 2) as tarif_moyen_segment,
        ROUND(
          COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY su.segment_volume), 
          2
        ) as pourcentage_preferences_segment
      FROM segments_utilisateurs su
      JOIN reservation r ON su.email = r.email
      WHERE r.statut = 'confirmée'
      GROUP BY su.segment_volume, r.typeTerrain, r.nomterrain
      HAVING COUNT(*) >= 2
      ORDER BY su.segment_volume, nb_reservations_segment DESC
    `);

    // 3. Recommandations d'actions personnalisées
    const recommandationsPersonnalisees = await db.query(`
      WITH profil_complet AS (
        SELECT 
          u.email,
          u.nom,
          u.prenom,
          COUNT(r.*) as nb_reservations,
          COALESCE(SUM(r.tarif), 0) as depense_totale,
          ROUND(AVG(r.tarif), 2) as tarif_moyen,
          MAX(r.datereservation) as derniere_resa,
          CURRENT_DATE - MAX(r.datereservation) as jours_inactivite,
          COUNT(DISTINCT r.nomterrain) as diversite_terrains,
          COUNT(DISTINCT EXTRACT(DOW FROM r.datereservation)) as diversite_jours,
          MODE() WITHIN GROUP (ORDER BY r.typeTerrain) as terrain_prefere,
          MODE() WITHIN GROUP (ORDER BY EXTRACT(DOW FROM r.datereservation)) as jour_prefere
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.email, u.nom, u.prenom
        HAVING COUNT(r.*) >= 1
      )
      SELECT 
        email,
        nom,
        prenom,
        nb_reservations,
        depense_totale,
        tarif_moyen,
        jours_inactivite,
        diversite_terrains,
        terrain_prefere,
        jour_prefere,
        CASE 
          WHEN nb_reservations >= 10 AND jours_inactivite <= 7 THEN 
            'OFFRE VIP SUR ' || terrain_prefere || ' - RÉDUCTION 20% PROCHAINS CRÉNEAUX'
          WHEN nb_reservations >= 5 AND jours_inactivite <= 14 THEN 
            'PROGRAMME FIDÉLITÉ - CRÉNEAU GRATUIT TOUS LES 10 RÉSERVATIONS'
          WHEN nb_reservations >= 3 AND jours_inactivite <= 30 THEN 
            'PROMOTION PERSONNALISÉE -15% SUR CRÉNEAUX ' || terrain_prefere
          WHEN jours_inactivite > 30 AND nb_reservations >= 3 THEN 
            'CAMPAGNE RÉACTIVATION - OFFRE SPÉCIALE RETOUR'
          WHEN jours_inactivite > 60 AND depense_totale >= 200 THEN 
            'OFFRE DE RETOUR PRIORITAIRE - RÉDUCTION 30%'
          WHEN nb_reservations = 1 AND jours_inactivite <= 7 THEN 
            'DÉCOUVERTE COMPLÈTE -10% SUR AUTRES TERRAINS'
          WHEN diversite_terrains = 1 AND nb_reservations >= 5 THEN 
            'DÉCOUVERTE NOUVEAUX TERRAINS - OFFRE SPÉCIALE'
          ELSE 'SURVEILLANCE - SANS ACTION SPÉCIFIQUE'
        END as recommandation_personnalisee,
        CASE 
          WHEN nb_reservations >= 10 AND jours_inactivite <= 7 THEN 'PRIORITÉ HAUTE'
          WHEN nb_reservations >= 5 AND jours_inactivite <= 14 THEN 'PRIORITÉ HAUTE'
          WHEN jours_inactivite > 30 AND nb_reservations >= 3 THEN 'PRIORITÉ MOYENNE'
          WHEN jours_inactivite > 60 AND depense_totale >= 200 THEN 'PRIORITÉ URGENTE'
          ELSE 'PRIORITÉ BASSE'
        END as priorite_action
      FROM profil_complet
      WHERE recommandation_personnalisee != 'SURVEILLANCE - SANS ACTION SPÉCIFIQUE'
      ORDER BY 
        CASE 
          WHEN priorite_action = 'PRIORITÉ URGENTE' THEN 1
          WHEN priorite_action = 'PRIORITÉ HAUTE' THEN 2
          WHEN priorite_action = 'PRIORITÉ MOYENNE' THEN 3
          ELSE 4
        END,
        depense_totale DESC
      LIMIT 50
    `);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        segmentation_rfm: segmentationRFM.rows,
        preferences_segments: preferencesSegments.rows,
        recommandations_personnalisees: recommandationsPersonnalisees.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans segments-marketing:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des segments marketing',
      error: error.message
    });
  }
});

export default router;
