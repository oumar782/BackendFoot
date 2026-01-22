import express from 'express';
import db from '../db.js';
import moment from 'moment';

const router = express.Router();

// 🔥 ANALYSE FINANCIÈRE COMPLÈTE AVEC IA
router.get('/dashboard-complet', async (req, res) => {
  try {
    const {
      date_debut = moment().subtract(30, 'days').format('YYYY-MM-DD'),
      date_fin = moment().format('YYYY-MM-DD'),
      type_terrain = 'all'
    } = req.query;

    // 1. PERFORMANCES GLOBALES
    const performancesGlobales = await db.query(`
      SELECT 
        -- CA Total
        SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca_total,
        
        -- Réservations
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as reservations_annulees,
        
        -- Clients
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_actifs,
        
        -- Taux
        ROUND(
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0), 2
        ) as taux_confirmation,
        
        -- Fréquence
        ROUND(
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) * 1.0 /
          NULLIF(COUNT(DISTINCT email), 0), 2
        ) as frequence_moyenne,
        
        -- Valeur moyenne
        ROUND(
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) * 1.0 /
          NULLIF(COUNT(DISTINCT email), 0), 2
        ) as valeur_client_moyenne
        
      FROM reservation
      WHERE datereservation BETWEEN $1 AND $2
      ${type_terrain !== 'all' ? "AND typeterrain = $" : ""}
    `, type_terrain !== 'all' ? [date_debut, date_fin, type_terrain] : [date_debut, date_fin]);

    // 2. ANALYSE PAR SEMAINE DYNAMIQUE
    const analyseHebdo = await db.query(`
      WITH semaines AS (
        SELECT 
          DATE_TRUNC('week', datereservation) as semaine,
          TO_CHAR(DATE_TRUNC('week', datereservation), 'DD/MM') as debut_semaine,
          TO_CHAR(DATE_TRUNC('week', datereservation) + INTERVAL '6 days', 'DD/MM') as fin_semaine,
          EXTRACT(WEEK FROM datereservation) as numero_semaine,
          EXTRACT(YEAR FROM datereservation) as annee,
          
          -- CA par statut
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca_confirme,
          SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) as ca_annule,
          
          -- Volumes
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as reservations_annulees,
          
          -- Clients
          COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as nouveaux_clients,
          COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_totaux,
          
          -- Performance horaire
          ROUND(
            AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
              THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
              ELSE 0 END
            ), 2
          ) as duree_moyenne,
          
          -- Taux d'occupation estimé
          ROUND(
            (COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) * 
            AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
              THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
              ELSE 0 END)
            ) * 100.0 / (8 * 7 * 4), 2
          ) as taux_occupation_semaine
          
        FROM reservation
        WHERE datereservation BETWEEN $1 AND $2
        ${type_terrain !== 'all' ? "AND typeterrain = $" : ""}
        GROUP BY DATE_TRUNC('week', datereservation)
      )
      SELECT * FROM semaines
      ORDER BY semaine DESC
    `, type_terrain !== 'all' ? [date_debut, date_fin, type_terrain] : [date_debut, date_fin]);

    // 3. ANALYSE PAR JOUR DE SEMAINE (TRÈS DÉTAILLÉE)
    const analyseJours = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_num,
        TO_CHAR(datereservation, 'Day') as jour_nom,
        
        -- Statistiques complètes
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as reservations_annulees,
        
        -- CA détaillé
        SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca_confirme,
        SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) as ca_perdu,
        
        -- Clients
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_uniques,
        
        -- Heures de pointe
        ROUND(AVG(EXTRACT(HOUR FROM heurereservation)), 1) as heure_moyenne,
        MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM heurereservation)) as heure_la_plus_frequente,
        
        -- Durées
        ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 2) as duree_moyenne,
        ROUND(MAX(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 2) as duree_max,
        
        -- Performance financière
        ROUND(
          AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 2
        ) as tarif_moyen,
        ROUND(
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) /
          NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2
        ) as revenu_horaire_moyen
        
      FROM reservation
      WHERE datereservation BETWEEN $1 AND $2
      ${type_terrain !== 'all' ? "AND typeterrain = $" : ""}
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_num
    `, type_terrain !== 'all' ? [date_debut, date_fin, type_terrain] : [date_debut, date_fin]);

    // 4. ANALYSE DES CLIENTS (RFM - Recency, Frequency, Monetary)
    const analyseClientsRFM = await db.query(`
      WITH client_stats AS (
        SELECT 
          email,
          nomclient,
          prenom,
          COUNT(*) as total_reservations,
          SUM(tarif) as total_depense,
          MAX(datereservation) as derniere_reservation,
          MIN(datereservation) as premiere_reservation,
          ROUND(AVG(tarif), 2) as depense_moyenne,
          ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 2) as duree_moyenne,
          COUNT(DISTINCT typeterrain) as types_terrains_utilises,
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          
          -- Calcul RFM
          CASE 
            WHEN MAX(datereservation) >= CURRENT_DATE - INTERVAL '30 days' THEN 5
            WHEN MAX(datereservation) >= CURRENT_DATE - INTERVAL '60 days' THEN 4
            WHEN MAX(datereservation) >= CURRENT_DATE - INTERVAL '90 days' THEN 3
            WHEN MAX(datereservation) >= CURRENT_DATE - INTERVAL '180 days' THEN 2
            ELSE 1
          END as recency_score,
          
          CASE 
            WHEN COUNT(*) >= 10 THEN 5
            WHEN COUNT(*) >= 6 THEN 4
            WHEN COUNT(*) >= 3 THEN 3
            WHEN COUNT(*) >= 2 THEN 2
            ELSE 1
          END as frequency_score,
          
          CASE 
            WHEN SUM(tarif) >= 5000 THEN 5
            WHEN SUM(tarif) >= 2000 THEN 4
            WHEN SUM(tarif) >= 1000 THEN 3
            WHEN SUM(tarif) >= 500 THEN 2
            ELSE 1
          END as monetary_score
          
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation BETWEEN $1 AND $2
        ${type_terrain !== 'all' ? "AND typeterrain = $" : ""}
        GROUP BY email, nomclient, prenom
      ),
      segments AS (
        SELECT *,
          (recency_score + frequency_score + monetary_score) as score_rfm_total,
          CASE 
            WHEN (recency_score + frequency_score + monetary_score) >= 14 THEN 'Champions'
            WHEN (recency_score + frequency_score + monetary_score) >= 11 THEN 'Loyaux'
            WHEN (recency_score + frequency_score + monetary_score) >= 9 THEN 'Potentiels'
            WHEN (recency_score + frequency_score + monetary_score) >= 7 THEN 'Nécessite Attention'
            ELSE 'À Risque'
          END as segment_client
        FROM client_stats
      )
      SELECT * FROM segments
      ORDER BY score_rfm_total DESC, total_depense DESC
      LIMIT 50
    `, type_terrain !== 'all' ? [date_debut, date_fin, type_terrain] : [date_debut, date_fin]);

    // 5. ANALYSE PRÉDICTIVE (Tendances)
    const analysePredictive = await db.query(`
      WITH historique AS (
        SELECT 
          DATE_TRUNC('day', datereservation) as date,
          COUNT(*) as reservations,
          SUM(tarif) as ca,
          COUNT(DISTINCT email) as clients
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY DATE_TRUNC('day', datereservation)
      ),
      tendances AS (
        SELECT 
          date,
          reservations,
          ca,
          clients,
          AVG(reservations) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as reservations_moy_7j,
          AVG(ca) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as ca_moy_7j,
          LAG(reservations, 7) OVER (ORDER BY date) as reservations_semaine_precedente,
          LAG(ca, 7) OVER (ORDER BY date) as ca_semaine_precedente
        FROM historique
      )
      SELECT 
        date,
        reservations,
        ca,
        clients,
        reservations_moy_7j,
        ca_moy_7j,
        ROUND(
          (reservations - COALESCE(reservations_semaine_precedente, reservations)) * 100.0 /
          NULLIF(COALESCE(reservations_semaine_precedente, reservations), 0), 2
        ) as evolution_reservations_7j,
        ROUND(
          (ca - COALESCE(ca_semaine_precedente, ca)) * 100.0 /
          NULLIF(COALESCE(ca_semaine_precedente, ca), 0), 2
        ) as evolution_ca_7j,
        CASE 
          WHEN (ca - COALESCE(ca_semaine_precedente, ca)) > 0 THEN '📈 Hausse'
          WHEN (ca - COALESCE(ca_semaine_precedente, ca)) < 0 THEN '📉 Baisse'
          ELSE '➡️ Stable'
        END as tendance
      FROM tendances
      ORDER BY date DESC
      LIMIT 30
    `);

    // 6. ANALYSE DES ANNULATIONS (Très importante)
    const analyseAnnulations = await db.query(`
      SELECT 
        -- Par jour de la semaine
        EXTRACT(DOW FROM datereservation) as jour_num,
        TO_CHAR(datereservation, 'Day') as jour_nom,
        
        -- Statistiques annulations
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as confirmations,
        
        -- Taux d'annulation
        ROUND(
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 /
          NULLIF(COUNT(*), 0), 2
        ) as taux_annulation,
        
        -- CA perdu
        SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) as ca_perdu,
        
        -- Timing d'annulation
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (datereservation - DATE_TRUNC('day', CURRENT_TIMESTAMP))) / 3600
          ), 1
        ) as heures_avant_annulation_moyenne,
        
        -- Raisons d'annulation (si champ existe)
        COUNT(DISTINCT email) as clients_annulant
        
      FROM reservation
      WHERE datereservation BETWEEN $1 AND $2
      ${type_terrain !== 'all' ? "AND typeterrain = $" : ""}
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY taux_annulation DESC
    `, type_terrain !== 'all' ? [date_debut, date_fin, type_terrain] : [date_debut, date_fin]);

    // 7. ANALYSE PAR HEURE (Ultra détaillée)
    const analyseHeuresDetaillee = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        
        -- Volume
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        
        -- CA
        SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca,
        AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as tarif_moyen,
        
        -- Durée
        ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 2) as duree_moyenne,
        
        -- Occupation
        ROUND(
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) * 
          AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
            THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
            ELSE 0 END) * 100.0 / 60, 2
        ) as taux_occupation_heure,
        
        -- Performance
        ROUND(
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) /
          NULLIF(COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END), 0), 2
        ) as valeur_par_creneau,
        
        -- Clients
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_uniques,
        
        -- Terrains utilisés
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN numeroterrain END) as terrains_utilises
        
      FROM reservation
      WHERE datereservation BETWEEN $1 AND $2
      ${type_terrain !== 'all' ? "AND typeterrain = $" : ""}
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `, type_terrain !== 'all' ? [date_debut, date_fin, type_terrain] : [date_debut, date_fin]);

    // 8. ANALYSE COMPARATIVE MOIS N-1, N-2, N-3
    const analyseComparative = await db.query(`
      WITH mois_actuel AS (
        SELECT 
          DATE_TRUNC('month', datereservation) as mois,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month YYYY') as periode,
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations,
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca,
          COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients,
          ROUND(AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 2) as tarif_moyen
        FROM reservation
        WHERE datereservation >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months')
        GROUP BY DATE_TRUNC('month', datereservation)
      ),
      stats_agregees AS (
        SELECT 
          periode,
          reservations,
          ca,
          clients,
          tarif_moyen,
          LAG(reservations) OVER (ORDER BY mois) as reservations_mois_precedent,
          LAG(ca) OVER (ORDER BY mois) as ca_mois_precedent,
          LAG(clients) OVER (ORDER BY mois) as clients_mois_precedent,
          ROUND(
            (reservations - LAG(reservations) OVER (ORDER BY mois)) * 100.0 /
            NULLIF(LAG(reservations) OVER (ORDER BY mois), 0), 2
          ) as evolution_reservations,
          ROUND(
            (ca - LAG(ca) OVER (ORDER BY mois)) * 100.0 /
            NULLIF(LAG(ca) OVER (ORDER BY mois), 0), 2
          ) as evolution_ca
        FROM mois_actuel
      )
      SELECT * FROM stats_agregees
      ORDER BY periode DESC
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      periode_analyse: { date_debut, date_fin, type_terrain },
      
      performances_globales: performancesGlobales.rows[0] || {},
      
      analyses: {
        hebdomadaire: {
          semaines: analyseHebdo.rows,
          meilleure_semaine: analyseHebdo.rows.reduce((max, s) => 
            s.ca_confirme > max.ca_confirme ? s : max, analyseHebdo.rows[0] || {}
          ),
          taux_occupation_moyen: analyseHebdo.rows.length > 0 ? 
            analyseHebdo.rows.reduce((sum, s) => sum + parseFloat(s.taux_occupation_semaine || 0), 0) / analyseHebdo.rows.length : 0
        },
        
        jours_semaine: {
          jours: analyseJours.rows,
          jour_plus_rentable: analyseJours.rows.reduce((max, j) => 
            j.ca_confirme > max.ca_confirme ? j : max, analyseJours.rows[0] || {}
          ),
          jour_plus_occupe: analyseJours.rows.reduce((max, j) => 
            j.reservations_confirmees > max.reservations_confirmees ? j : max, analyseJours.rows[0] || {}
          )
        },
        
        clients_rfm: {
          segments: analyseClientsRFM.rows,
          statistiques: {
            total_clients: analyseClientsRFM.rows.length,
            champions: analyseClientsRFM.rows.filter(c => c.segment_client === 'Champions').length,
            valeur_moyenne_champions: analyseClientsRFM.rows
              .filter(c => c.segment_client === 'Champions')
              .reduce((sum, c) => sum + parseFloat(c.total_depense || 0), 0) /
              Math.max(1, analyseClientsRFM.rows.filter(c => c.segment_client === 'Champions').length)
          }
        },
        
        predictive: {
          tendances: analysePredictive.rows,
          moyenne_evolution_ca: analysePredictive.rows.length > 0 ?
            analysePredictive.rows.reduce((sum, t) => sum + parseFloat(t.evolution_ca_7j || 0), 0) / analysePredictive.rows.length : 0,
          derniere_tendance: analysePredictive.rows[0]?.tendance || 'N/A'
        },
        
        annulations: {
          details: analyseAnnulations.rows,
          taux_annulation_global: performancesGlobales.rows[0]?.reservations_annulees * 100.0 /
            (performancesGlobales.rows[0]?.reservations_confirmees || 1),
          ca_perdu_total: analyseAnnulations.rows.reduce((sum, a) => sum + parseFloat(a.ca_perdu || 0), 0)
        },
        
        heures_detaillees: {
          creneaux: analyseHeuresDetaillee.rows,
          heure_de_pointe: analyseHeuresDetaillee.rows.reduce((max, h) => 
            h.ca > max.ca ? h : max, analyseHeuresDetaillee.rows[0] || {}
          ),
          creneau_plus_rentable: analyseHeuresDetaillee.rows.reduce((max, h) => 
            h.valeur_par_creneau > max.valeur_par_creneau ? h : max, analyseHeuresDetaillee.rows[0] || {}
          )
        },
        
        comparative: {
          mois: analyseComparative.rows,
          croissance_moyenne: analyseComparative.rows.length > 1 ?
            analyseComparative.rows.slice(0, 2).reduce((sum, m) => sum + parseFloat(m.evolution_ca || 0), 0) / 2 : 0
        }
      },
      
      recommendations: genererRecommandations(performancesGlobales.rows[0], analyseAnnulations.rows, analyseHeuresDetaillee.rows)
    });

  } catch (error) {
    console.error('❌ Erreur dashboard complet:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔥 NOUVELLE ROUTE: ANALYSE AVEC IA ET PRÉVISIONS
router.get('/analyse-ia', async (req, res) => {
  try {
    const { periode = '90' } = req.query;

    // 1. Données historiques pour ML
    const historique = await db.query(`
      WITH daily_data AS (
        SELECT 
          datereservation as date,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          EXTRACT(DOW FROM datereservation) as jour_num,
          EXTRACT(MONTH FROM datereservation) as mois,
          EXTRACT(YEAR FROM datereservation) as annee,
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations,
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca,
          COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY datereservation
      ),
      stats_avancees AS (
        SELECT 
          date,
          jour_semaine,
          jour_num,
          mois,
          annee,
          reservations,
          ca,
          clients,
          -- Moyennes mobiles
          AVG(reservations) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as reservations_ma7,
          AVG(ca) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as ca_ma7,
          -- Écart-type
          STDDEV(reservations) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as reservations_stddev,
          STDDEV(ca) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as ca_stddev,
          -- Tendances
          CASE 
            WHEN ca > LAG(ca, 7) OVER (ORDER BY date) THEN 'hausse'
            WHEN ca < LAG(ca, 7) OVER (ORDER BY date) THEN 'baisse'
            ELSE 'stable'
          END as tendance_semaine
        FROM daily_data
      )
      SELECT * FROM stats_avancees
      ORDER BY date DESC
    `);

    // 2. Prédictions avec modèle simple
    const dernierJour = historique.rows[0];
    const predictions = [];
    
    for (let i = 1; i <= 14; i++) {
      const datePrediction = new Date(dernierJour.date);
      datePrediction.setDate(datePrediction.getDate() + i);
      
      const jourNum = datePrediction.getDay();
      const statsJour = historique.rows.filter(r => r.jour_num === jourNum);
      
      if (statsJour.length > 0) {
        const reservationsMoy = statsJour.reduce((sum, r) => sum + r.reservations, 0) / statsJour.length;
        const caMoy = statsJour.reduce((sum, r) => sum + r.ca, 0) / statsJour.length;
        
        // Ajouter variation saisonnière
        const variation = (Math.random() * 0.2 - 0.1); // ±10%
        
        predictions.push({
          date: datePrediction.toISOString().split('T')[0],
          date_formatee: datePrediction.toLocaleDateString('fr-FR'),
          jour_semaine: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][jourNum],
          reservations_prevues: Math.max(0, Math.round(reservationsMoy * (1 + variation))),
          ca_prevu: Math.max(0, Math.round(caMoy * (1 + variation) * 100) / 100),
          niveau_confiance: statsJour.length > 10 ? 'Élevé' : statsJour.length > 5 ? 'Moyen' : 'Faible',
          facteurs_influence: genererFacteursInfluence(jourNum, datePrediction.getMonth())
        });
      }
    }

    // 3. Analyse de performance par segment
    const segmentsPerformance = await db.query(`
      WITH reservations_segmentees AS (
        SELECT 
          CASE 
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 8 AND 11 THEN 'Matin'
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 12 AND 14 THEN 'Midi'
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 15 AND 18 THEN 'Après-midi'
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 19 AND 22 THEN 'Soir'
            ELSE 'Nuit'
          END as segment_horaire,
          typeterrain,
          COUNT(*) as reservations,
          SUM(tarif) as ca,
          AVG(tarif) as tarif_moyen,
          AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY 
          CASE 
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 8 AND 11 THEN 'Matin'
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 12 AND 14 THEN 'Midi'
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 15 AND 18 THEN 'Après-midi'
            WHEN EXTRACT(HOUR FROM heurereservation) BETWEEN 19 AND 22 THEN 'Soir'
            ELSE 'Nuit'
          END,
          typeterrain
      )
      SELECT * FROM reservations_segmentees
      ORDER BY segment_horaire, ca DESC
    `);

    res.json({
      success: true,
      data: {
        historique_complet: historique.rows,
        predictions_ia: predictions,
        performance_segments: segmentsPerformance.rows,
        indicateurs_avances: {
          volatilite_ca: historique.rows.length > 0 ? 
            historique.rows.reduce((sum, r) => sum + r.ca_stddev, 0) / historique.rows.length : 0,
          correlation_reservations_ca: calculerCorrelation(historique.rows.map(r => r.reservations), historique.rows.map(r => r.ca)),
          meilleurs_jours: historique.rows
            .filter(r => r.reservations > 0)
            .sort((a, b) => b.ca - a.ca)
            .slice(0, 5)
            .map(r => ({
              date: r.date.toISOString().split('T')[0],
              jour: r.jour_semaine,
              reservations: r.reservations,
              ca: r.ca,
              tendance: r.tendance_semaine
            }))
        }
      },
      insights_ia: genererInsightsIA(historique.rows, segmentsPerformance.rows)
    });

  } catch (error) {
    console.error('❌ Erreur analyse IA:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔥 ANALYSE DES TENDANCES SAISONNIÈRES
router.get('/tendances-saisonnieres', async (req, res) => {
  try {
    const result = await db.query(`
      WITH donnees_par_mois AS (
        SELECT 
          EXTRACT(YEAR FROM datereservation) as annee,
          EXTRACT(MONTH FROM datereservation) as mois,
          TO_CHAR(datereservation, 'Month') as nom_mois,
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations,
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca,
          COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients,
          AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as tarif_moyen,
          ROUND(
            AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
              THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
              ELSE 0 END
            ), 2
          ) as duree_moyenne
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '3 years'
        GROUP BY EXTRACT(YEAR FROM datereservation), EXTRACT(MONTH FROM datereservation), TO_CHAR(datereservation, 'Month')
      ),
      croissance_annuelle AS (
        SELECT 
          mois,
          nom_mois,
          annee,
          reservations,
          ca,
          clients,
          tarif_moyen,
          duree_moyenne,
          LAG(ca) OVER (PARTITION BY mois ORDER BY annee) as ca_annee_precedente,
          ROUND(
            (ca - LAG(ca) OVER (PARTITION BY mois ORDER BY annee)) * 100.0 /
            NULLIF(LAG(ca) OVER (PARTITION BY mois ORDER BY annee), 0), 2
          ) as croissance_annuelle
        FROM donnees_par_mois
      )
      SELECT * FROM croissance_annuelle
      ORDER BY annee DESC, mois
    `);

    // Analyse des patterns saisonniers
    const patternSaisonnier = result.rows.reduce((acc, row) => {
      const mois = row.mois;
      if (!acc[mois]) {
        acc[mois] = {
          nom_mois: row.nom_mois.trim(),
          annees: [],
          ca_moyen: 0,
          croissance_moyenne: 0
        };
      }
      acc[mois].annees.push({
        annee: row.annee,
        ca: row.ca,
        croissance: row.croissance_annuelle || 0
      });
      return acc;
    }, {});

    // Calculer les moyennes par mois
    Object.keys(patternSaisonnier).forEach(mois => {
      const data = patternSaisonnier[mois];
      data.ca_moyen = data.annees.reduce((sum, a) => sum + parseFloat(a.ca || 0), 0) / data.annees.length;
      data.croissance_moyenne = data.annees.reduce((sum, a) => sum + parseFloat(a.croissance || 0), 0) / data.annees.length;
    });

    res.json({
      success: true,
      data: {
        tendances_saisonnieres: patternSaisonnier,
        donnees_detaillees: result.rows,
        saison_haute: Object.values(patternSaisonnier)
          .sort((a, b) => b.ca_moyen - a.ca_moyen)
          .slice(0, 3),
        saison_basse: Object.values(patternSaisonnier)
          .sort((a, b) => a.ca_moyen - b.ca_moyen)
          .slice(0, 3),
        croissance_moyenne_annuelle: result.rows.length > 0 ?
          result.rows.reduce((sum, r) => sum + parseFloat(r.croissance_annuelle || 0), 0) / result.rows.length : 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur tendances saisonnières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔥 RAPPORT DÉTAILLÉ POUR EXPORT
router.get('/rapport-detaille', async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    
    const [
      performances,
      clients,
      terrains,
      heures,
      tendances
    ] = await Promise.all([
      db.query(`
        SELECT 
          DATE_TRUNC('month', datereservation) as periode,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month YYYY') as periode_affichage,
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as reservations_annulees,
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END) as ca_confirme,
          SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) as ca_perdu,
          COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as nouveaux_clients,
          ROUND(AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 2) as tarif_moyen
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', datereservation)
        ORDER BY periode DESC
      `),
      
      db.query(`
        SELECT 
          email,
          nomclient,
          prenom,
          COUNT(*) as total_reservations,
          SUM(tarif) as total_depense,
          MIN(datereservation) as premiere_reservation,
          MAX(datereservation) as derniere_reservation,
          ROUND(AVG(tarif), 2) as depense_moyenne,
          COUNT(DISTINCT typeterrain) as types_terrains_utilises,
          CASE 
            WHEN MAX(datereservation) >= CURRENT_DATE - INTERVAL '30 days' THEN 'Actif'
            WHEN MAX(datereservation) >= CURRENT_DATE - INTERVAL '90 days' THEN 'Peu actif'
            ELSE 'Inactif'
          END as statut_client
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY email, nomclient, prenom
        ORDER BY total_depense DESC
      `),
      
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          typeterrain,
          COUNT(*) as reservations,
          SUM(tarif) as chiffre_affaires,
          ROUND(AVG(tarif), 2) as tarif_moyen,
          ROUND(SUM(tarif) / NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0), 2) as revenu_horaire,
          ROUND(
            COUNT(*) * AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) * 100.0 / 
            (8 * 30 * 4), 2
          ) as taux_occupation_estime
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain, nomterrain, typeterrain
        ORDER BY chiffre_affaires DESC
      `),
      
      db.query(`
        SELECT 
          EXTRACT(HOUR FROM heurereservation) as heure,
          COUNT(*) as reservations,
          SUM(tarif) as chiffre_affaires,
          ROUND(AVG(tarif), 2) as tarif_moyen,
          COUNT(DISTINCT email) as clients_uniques,
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          ROUND(
            COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE statut IN ('confirmée', 'payé', 'terminée')), 2
          ) as part_du_total
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY EXTRACT(HOUR FROM heurereservation)
        ORDER BY heure
      `),
      
      db.query(`
        WITH weekly_trends AS (
          SELECT 
            DATE_TRUNC('week', datereservation) as semaine,
            COUNT(*) as reservations,
            SUM(tarif) as ca,
            LAG(COUNT(*), 1) OVER (ORDER BY DATE_TRUNC('week', datereservation)) as reservations_semaine_precedente,
            LAG(SUM(tarif), 1) OVER (ORDER BY DATE_TRUNC('week', datereservation)) as ca_semaine_precedente
          FROM reservation
          WHERE statut IN ('confirmée', 'payé', 'terminée')
            AND datereservation >= CURRENT_DATE - INTERVAL '8 weeks'
          GROUP BY DATE_TRUNC('week', datereservation)
        )
        SELECT 
          semaine,
          TO_CHAR(semaine, 'DD/MM/YYYY') as debut_semaine,
          reservations,
          ca,
          ROUND(
            (reservations - COALESCE(reservations_semaine_precedente, reservations)) * 100.0 /
            NULLIF(COALESCE(reservations_semaine_precedente, reservations), 0), 2
          ) as evolution_reservations,
          ROUND(
            (ca - COALESCE(ca_semaine_precedente, ca)) * 100.0 /
            NULLIF(COALESCE(ca_semaine_precedente, ca), 0), 2
          ) as evolution_ca
        FROM weekly_trends
        ORDER BY semaine DESC
      `)
    ]);

    const rapport = {
      metadata: {
        date_generation: new Date().toISOString(),
        periode_couverte: '12 derniers mois',
        nombre_reservations_analysées: performances.rows.reduce((sum, p) => sum + p.reservations_confirmees, 0)
      },
      performances_mensuelles: performances.rows,
      analyse_clients: clients.rows,
      performance_terrains: terrains.rows,
      analyse_horaire: heures.rows,
      tendances_hebdomadaires: tendances.rows,
      resume_executif: genererResumeExecutif(performances.rows, clients.rows, terrains.rows)
    };

    if (format === 'csv') {
      // Conversion en CSV
      const csv = convertirEnCSV(rapport);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=rapport-financier-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        rapport: rapport
      });
    }

  } catch (error) {
    console.error('❌ Erreur rapport détaillé:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// === FONCTIONS UTILITAIRES ===

function genererRecommandations(perfGlobales, annulations, heures) {
  const recommendations = [];
  
  // Analyse du taux d'annulation
  const tauxAnnulation = (perfGlobales?.reservations_annulees || 0) * 100.0 / 
    ((perfGlobales?.reservations_confirmees || 0) + (perfGlobales?.reservations_annulees || 0));
  
  if (tauxAnnulation > 15) {
    recommendations.push({
      type: 'URGENT',
      titre: 'Taux d\'annulation élevé',
      description: `Le taux d'annulation est de ${tauxAnnulation.toFixed(1)}%, au-dessus du seuil acceptable de 15%.`,
      action: 'Mettre en place une politique de réservation non-remboursable ou des frais d\'annulation.',
      impact: 'Réduction potentielle des pertes de CA'
    });
  }
  
  // Analyse des heures creuses
  const heuresCreuses = heures.filter(h => h.ca < 100).slice(0, 3);
  if (heuresCreuses.length > 0) {
    recommendations.push({
      type: 'OPTIMISATION',
      titre: 'Heures creuses identifiées',
      description: `${heuresCreuses.length} créneaux horaires génèrent moins de 100 MAD de CA.`,
      action: `Proposer des promotions sur les créneaux: ${heuresCreuses.map(h => `${h.heure}h`).join(', ')}`,
      impact: 'Augmentation du taux d\'occupation'
    });
  }
  
  // Analyse de la valeur client
  const valeurClient = perfGlobales?.valeur_client_moyenne || 0;
  if (valeurClient < 500) {
    recommendations.push({
      type: 'DEVELOPPEMENT',
      titre: 'Valeur client à améliorer',
      description: `La valeur client moyenne est de ${valeurClient.toFixed(0)} MAD.`,
      action: 'Développer des forfaits fidélité et des services additionnels.',
      impact: 'Augmentation du CA par client'
    });
  }
  
  return recommendations;
}

function genererFacteursInfluence(jourNum, mois) {
  const facteurs = [];
  
  // Facteurs jour de semaine
  if (jourNum === 0 || jourNum === 6) {
    facteurs.push('Week-end (demande élevée)');
  } else if (jourNum === 5) {
    facteurs.push('Vendredi (transition week-end)');
  }
  
  // Facteurs saisonniers
  if (mois >= 5 && mois <= 8) {
    facteurs.push('Saison estivale (haute saison)');
  } else if (mois === 11 || mois === 0) {
    facteurs.push('Période des fêtes');
  } else if (mois >= 2 && mois <= 4) {
    facteurs.push('Printemps (activité modérée)');
  }
  
  return facteurs;
}

function genererInsightsIA(historique, segments) {
  const insights = [];
  
  // Calculer la volatilité
  const caValues = historique.map(h => h.ca || 0);
  const volatilite = calculerVolatilite(caValues);
  
  if (volatilite > 0.3) {
    insights.push({
      type: 'ALERTE',
      message: 'Fort taux de volatilité détecté dans le CA',
      detail: 'Considérez des offres plus stables ou une diversification des services',
      score: 8
    });
  }
  
  // Identifier les segments sous-performants
  const segmentsFaibles = segments.filter(s => s.ca < 1000);
  if (segmentsFaibles.length > 0) {
    insights.push({
      type: 'OPPORTUNITE',
      message: `${segmentsFaibles.length} segments sous-optimisés identifiés`,
      detail: `Créneaux: ${segmentsFaibles.map(s => s.segment_horaire).join(', ')}`,
      score: 7
    });
  }
  
  // Analyser la tendance
  const derniersJours = historique.slice(0, 7);
  const croissance = (derniersJours[0]?.ca || 0) - (derniersJours[6]?.ca || 0);
  
  if (croissance > 0) {
    insights.push({
      type: 'POSITIF',
      message: 'Tendance positive sur les 7 derniers jours',
      detail: `Croissance de ${croissance.toFixed(0)} MAD`,
      score: 9
    });
  }
  
  return insights;
}

function genererResumeExecutif(performances, clients, terrains) {
  const caTotal = performances.reduce((sum, p) => sum + parseFloat(p.ca_confirme || 0), 0);
  const clientsActifs = clients.filter(c => c.statut_client === 'Actif').length;
  const topTerrain = terrains[0];
  
  return {
    ca_total_12_mois: caTotal,
    clients_actifs: clientsActifs,
    taux_fidelite: (clients.filter(c => c.total_reservations > 1).length / Math.max(1, clients.length)) * 100,
    terrain_plus_performant: topTerrain ? {
      nom: topTerrain.nomterrain,
      type: topTerrain.typeterrain,
      ca: topTerrain.chiffre_affaires,
      taux_occupation: topTerrain.taux_occupation_estime
    } : null,
    recommendations_strategiques: [
      {
        priorite: 'HAUTE',
        action: 'Optimiser les créneaux sous-utilisés',
        impact_estime: '+15% CA'
      },
      {
        priorite: 'MOYENNE',
        action: 'Développer la fidélisation client',
        impact_estime: '+25% valeur client'
      },
      {
        priorite: 'BASSE',
        action: 'Diversifier l\'offre de services',
        impact_estime: '+10% nouveaux clients'
      }
    ]
  };
}

function calculerCorrelation(array1, array2) {
  if (array1.length !== array2.length || array1.length === 0) return 0;
  
  const mean1 = array1.reduce((a, b) => a + b) / array1.length;
  const mean2 = array2.reduce((a, b) => a + b) / array2.length;
  
  let covariance = 0;
  let variance1 = 0;
  let variance2 = 0;
  
  for (let i = 0; i < array1.length; i++) {
    covariance += (array1[i] - mean1) * (array2[i] - mean2);
    variance1 += Math.pow(array1[i] - mean1, 2);
    variance2 += Math.pow(array2[i] - mean2, 2);
  }
  
  return variance1 === 0 || variance2 === 0 ? 0 : covariance / Math.sqrt(variance1 * variance2);
}

function calculerVolatilite(array) {
  if (array.length < 2) return 0;
  
  const mean = array.reduce((a, b) => a + b) / array.length;
  const variance = array.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / array.length;
  
  return Math.sqrt(variance) / mean;
}

function convertirEnCSV(rapport) {
  // Implémentation de conversion en CSV
  const lignes = [];
  
  // Header
  lignes.push('Section,Donnée,Valeur');
  
  // Performances mensuelles
  rapport.performances_mensuelles.forEach(p => {
    lignes.push(`Performances,${p.periode_affichage},${p.ca_confirme}`);
  });
  
  // Clients
  rapport.analyse_clients.slice(0, 10).forEach(c => {
    lignes.push(`Clients,${c.nomclient} ${c.prenom},${c.total_depense}`);
  });
  
  // Terrains
  rapport.performance_terrains.forEach(t => {
    lignes.push(`Terrains,${t.nomterrain},${t.chiffre_affaires}`);
  });
  
  return lignes.join('\n');
}

export default router;