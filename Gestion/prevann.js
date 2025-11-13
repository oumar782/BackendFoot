// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (version annulations)
// 🔮 Prévisions et tendances des réservations ANNULÉES
router.get('/previsions-tendances', async (req, res) => {
    try {
      const { periode = '30' } = req.query;
      
      const result = await db.query(`
        WITH reservations_futures AS (
          SELECT 
            datereservation,
            COUNT(*) as reservations_annulees,
            COALESCE(SUM(tarif), 0) as revenus_perdus,
            COUNT(DISTINCT numeroterrain) as terrains_concernes
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
          GROUP BY datereservation
        ),
        stats_historiques AS (
          SELECT 
            ROUND(AVG(annulations_jour), 2) as annulations_moyennes,
            ROUND(AVG(revenus_perdus_jour), 2) as revenus_perdus_moyens
          FROM (
            SELECT 
              datereservation,
              COUNT(*) as annulations_jour,
              COALESCE(SUM(tarif), 0) as revenus_perdus_jour
            FROM reservation 
            WHERE statut = 'annulée'
              AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE - INTERVAL '1 day'
            GROUP BY datereservation
          ) historique
        )
        SELECT 
          rf.datereservation,
          TO_CHAR(rf.datereservation, 'DD/MM') as date_formattee,
          rf.reservations_annulees,
          rf.revenus_perdus,
          rf.terrains_concernes,
          sh.annulations_moyennes,
          sh.revenus_perdus_moyens,
          CASE 
            WHEN rf.reservations_annulees > sh.annulations_moyennes THEN 'supérieur'
            WHEN rf.reservations_annulees < sh.annulations_moyennes THEN 'inférieur'
            ELSE 'identique'
          END as tendance_annulations,
          CASE 
            WHEN rf.revenus_perdus > sh.revenus_perdus_moyens THEN 'supérieur'
            WHEN rf.revenus_perdus < sh.revenus_perdus_moyens THEN 'inférieur'
            ELSE 'identique'
          END as tendance_revenus_perdus
        FROM reservations_futures rf
        CROSS JOIN stats_historiques sh
        ORDER BY rf.datereservation ASC
      `);
  
      // Calcul des totaux et moyennes
      const stats = {
        annulations_total: result.rows.reduce((sum, row) => sum + parseInt(row.reservations_annulees), 0),
        revenus_perdus_total: result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_perdus), 0),
        jours_avec_annulations: result.rows.length,
        revenus_perdus_moyen_par_jour: result.rows.length > 0 
          ? Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenus_perdus), 0) / result.rows.length)
          : 0,
        jours_superieurs_moyenne: result.rows.filter(row => row.tendance_annulations === 'supérieur').length
      };
  
      res.json({
        success: true,
        data: result.rows,
        statistiques: stats,
        periode_analyse: parseInt(periode)
      });
    } catch (error) {
      console.error('❌ Erreur prévisions annulations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
  });
  
  // 📊 Analyse détaillée des annulations
  router.get('/analyse-annulations', async (req, res) => {
    try {
      const [
        statsGlobales,
        annulationsParTerrain,
        annulationsParJourSemaine,
        annulationsParHoraire,
        evolutionMensuelle,
        comparatifStatuts
      ] = await Promise.all([
        // Statistiques globales des annulations
        db.query(`
          SELECT 
            COUNT(*) as total_annulations,
            COALESCE(SUM(tarif), 0) as revenus_perdus_total,
            ROUND(AVG(tarif), 2) as perte_moyenne_par_annulation,
            COUNT(DISTINCT numeroterrain) as terrains_affectes,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM reservation)
              ), 2
            ) as taux_annulation_global,
            MIN(datereservation) as premiere_annulation,
            MAX(datereservation) as derniere_annulation
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
        `),
  
        // Annulations par terrain
        db.query(`
          SELECT 
            numeroterrain,
            nomterrain,
            typeterrain,
            COUNT(*) as annulations,
            COALESCE(SUM(tarif), 0) as revenus_perdus,
            ROUND(AVG(tarif), 2) as perte_moyenne,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM reservation WHERE numeroterrain = r.numeroterrain)
              ), 2
            ) as taux_annulation_terrain
          FROM reservation r
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY numeroterrain, nomterrain, typeterrain
          ORDER BY annulations DESC
        `),
  
        // Annulations par jour de la semaine
        db.query(`
          SELECT 
            TO_CHAR(datereservation, 'Day') as jour_semaine,
            EXTRACT(DOW FROM datereservation) as jour_numero,
            COUNT(*) as nombre_annulations,
            COALESCE(SUM(tarif), 0) as revenus_perdus,
            ROUND(AVG(tarif), 2) as perte_moyenne
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY jour_semaine, jour_numero
          ORDER BY jour_numero
        `),
  
        // Annulations par créneau horaire
        db.query(`
          SELECT 
            heuredebut,
            COUNT(*) as annulations,
            COALESCE(SUM(tarif), 0) as revenus_perdus,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM reservation WHERE heuredebut = r.heuredebut AND statut = 'annulée')
              ), 2
            ) as concentration_horaire
          FROM reservation r
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY heuredebut
          ORDER BY annulations DESC
          LIMIT 10
        `),
  
        // Évolution mensuelle des annulations
        db.query(`
          WITH mois_series AS (
            SELECT generate_series(
              CURRENT_DATE - INTERVAL '11 months',
              CURRENT_DATE,
              '1 month'::interval
            )::date as mois
          )
          SELECT 
            TO_CHAR(ms.mois, 'YYYY-MM') as periode,
            TO_CHAR(ms.mois, 'Mon YYYY') as periode_affichage,
            COUNT(r.numeroreservation) as annulations,
            COALESCE(SUM(r.tarif), 0) as revenus_perdus,
            COUNT(DISTINCT r.numeroterrain) as terrains_affectes
          FROM mois_series ms
          LEFT JOIN reservation r ON 
            EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
            AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
            AND r.statut = 'annulée'
          GROUP BY ms.mois
          ORDER BY ms.mois ASC
        `),
  
        // Comparatif avec les autres statuts
        db.query(`
          SELECT 
            statut,
            COUNT(*) as nombre,
            COALESCE(SUM(tarif), 0) as revenus,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM reservation WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days')
              ), 2
            ) as pourcentage
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY statut
          ORDER BY nombre DESC
        `)
      ]);
  
      res.json({
        success: true,
        data: {
          statistiques_globales: statsGlobales.rows[0],
          par_terrain: annulationsParTerrain.rows,
          par_jour_semaine: annulationsParJourSemaine.rows,
          par_horaire: annulationsParHoraire.rows,
          evolution_mensuelle: evolutionMensuelle.rows,
          comparatif_statuts: comparatifStatuts.rows
        }
      });
    } catch (error) {
      console.error('❌ Erreur analyse annulations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
  });
  
  // 🎯 Terrains les plus touchés par les annulations
  router.get('/terrains-annulations-critiques', async (req, res) => {
    try {
      const result = await db.query(`
        WITH stats_terrain AS (
          SELECT 
            numeroterrain,
            nomterrain,
            typeterrain,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
            COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
            COUNT(*) as total_reservations,
            COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif END), 0) as revenus_perdus,
            COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif END), 0) as revenus_realises
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '60 days'
          GROUP BY numeroterrain, nomterrain, typeterrain
        )
        SELECT 
          *,
          ROUND((annulations * 100.0 / NULLIF(total_reservations, 0)), 2) as taux_annulation,
          ROUND((revenus_perdus * 100.0 / NULLIF((revenus_perdus + revenus_realises), 0)), 2) as pourcentage_pertes,
          CASE 
            WHEN (annulations * 100.0 / NULLIF(total_reservations, 0)) > 30 THEN 'Critique'
            WHEN (annulations * 100.0 / NULLIF(total_reservations, 0)) > 15 THEN 'Préoccupant'
            ELSE 'Normal'
          END as niveau_alerte
        FROM stats_terrain
        ORDER BY taux_annulation DESC, revenus_perdus DESC
      `);
  
      res.json({
        success: true,
        data: result.rows,
        alertes: {
          terrains_critiques: result.rows.filter(t => t.niveau_alerte === 'Critique').length,
          terrains_preoccupants: result.rows.filter(t => t.niveau_alerte === 'Préoccupant').length,
          pertes_totales: result.rows.reduce((sum, t) => sum + parseFloat(t.revenus_perdus), 0)
        }
      });
    } catch (error) {
      console.error('❌ Erreur terrains critiques:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
  });
  
  // 📈 Patterns et tendances des annulations
  router.get('/patterns-annulations', async (req, res) => {
    try {
      const [
        patternsTemporels,
        correlationTarifs,
        anticipationAnnulations
      ] = await Promise.all([
        // Patterns temporels
        db.query(`
          SELECT 
            CASE 
              WHEN EXTRACT(DAY FROM datereservation - CURRENT_DATE) <= 7 THEN 'Moins de 7 jours'
              WHEN EXTRACT(DAY FROM datereservation - CURRENT_DATE) <= 14 THEN '7-14 jours'
              WHEN EXTRACT(DAY FROM datereservation - CURRENT_DATE) <= 30 THEN '15-30 jours'
              ELSE 'Plus de 30 jours'
            END as delai_annulation,
            COUNT(*) as nombre_annulations,
            COALESCE(SUM(tarif), 0) as revenus_perdus,
            ROUND(AVG(tarif), 2) as perte_moyenne
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE
          GROUP BY delai_annulation
          ORDER BY 
            CASE delai_annulation
              WHEN 'Moins de 7 jours' THEN 1
              WHEN '7-14 jours' THEN 2
              WHEN '15-30 jours' THEN 3
              ELSE 4
            END
        `),
  
        // Corrélation avec les tarifs
        db.query(`
          SELECT 
            CASE 
              WHEN tarif < 100 THEN 'Moins de 100 DH'
              WHEN tarif < 200 THEN '100-200 DH'
              WHEN tarif < 300 THEN '200-300 DH'
              ELSE 'Plus de 300 DH'
            END as tranche_tarif,
            COUNT(*) as annulations,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée' AND datereservation >= CURRENT_DATE - INTERVAL '60 days')
              ), 2
            ) as pourcentage_annulations
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '60 days'
          GROUP BY tranche_tarif
          ORDER BY 
            CASE tranche_tarif
              WHEN 'Moins de 100 DH' THEN 1
              WHEN '100-200 DH' THEN 2
              WHEN '200-300 DH' THEN 3
              ELSE 4
            END
        `),
  
        // Anticipation des annulations futures
        db.query(`
          WITH historique_taux AS (
            SELECT 
              EXTRACT(DOW FROM datereservation) as jour_semaine,
              COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_historiques,
              COUNT(*) as total_historique,
              ROUND(
                (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
                NULLIF(COUNT(*), 0)
                ), 2
              ) as taux_annulation_historique
            FROM reservation 
            WHERE datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE
            GROUP BY jour_semaine
          ),
          reservations_futures AS (
            SELECT 
              datereservation,
              EXTRACT(DOW FROM datereservation) as jour_semaine,
              COUNT(*) as reservations_planifiees
            FROM reservation 
            WHERE statut = 'confirmée'
              AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            GROUP BY datereservation, jour_semaine
          )
          SELECT 
            rf.datereservation,
            TO_CHAR(rf.datereservation, 'DD/MM/YYYY') as date_formattee,
            TO_CHAR(rf.datereservation, 'Day') as jour_nom,
            rf.reservations_planifiees,
            ht.taux_annulation_historique,
            ROUND(rf.reservations_planifiees * ht.taux_annulation_historique / 100.0, 0) as annulations_estimees,
            CASE 
              WHEN ht.taux_annulation_historique > 25 THEN 'Risque élevé'
              WHEN ht.taux_annulation_historique > 15 THEN 'Risque modéré'
              ELSE 'Risque faible'
            END as niveau_risque
          FROM reservations_futures rf
          JOIN historique_taux ht ON rf.jour_semaine = ht.jour_semaine
          ORDER BY rf.datereservation ASC
        `)
      ]);
  
      res.json({
        success: true,
        data: {
          patterns_temporels: patternsTemporels.rows,
          correlation_tarifs: correlationTarifs.rows,
          anticipation: anticipationAnnulations.rows
        },
        insights: {
          jours_risque_eleve: anticipationAnnulations.rows.filter(r => r.niveau_risque === 'Risque élevé').length,
          annulations_estimees_30j: anticipationAnnulations.rows.reduce((sum, r) => sum + parseInt(r.annulations_estimees || 0), 0)
        }
      });
    } catch (error) {
      console.error('❌ Erreur patterns annulations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
  });
  
  // 💡 Recommandations basées sur les annulations
  router.get('/recommandations-annulations', async (req, res) => {
    try {
      const [
        terrainsProblematiques,
        horairesCritiques,
        tendanceGenerale
      ] = await Promise.all([
        // Terrains avec taux d'annulation élevé
        db.query(`
          SELECT 
            numeroterrain,
            nomterrain,
            COUNT(*) as annulations_recentes,
            ROUND(
              (COUNT(*) * 100.0 / 
              (SELECT COUNT(*) FROM reservation WHERE numeroterrain = r.numeroterrain AND datereservation >= CURRENT_DATE - INTERVAL '30 days')
              ), 2
            ) as taux_annulation
          FROM reservation r
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY numeroterrain, nomterrain
          HAVING COUNT(*) * 100.0 / 
            (SELECT COUNT(*) FROM reservation WHERE numeroterrain = r.numeroterrain AND datereservation >= CURRENT_DATE - INTERVAL '30 days') > 20
          ORDER BY taux_annulation DESC
        `),
  
        // Horaires avec le plus d'annulations
        db.query(`
          SELECT 
            heuredebut,
            COUNT(*) as annulations,
            ROUND(AVG(tarif), 2) as perte_moyenne
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY heuredebut
          HAVING COUNT(*) > 3
          ORDER BY annulations DESC
          LIMIT 5
        `),
  
        // Tendance générale
        db.query(`
          SELECT 
            COUNT(*) as annulations_30j,
            (SELECT COUNT(*) FROM reservation WHERE statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '30 days') as annulations_30j_precedent,
            COALESCE(SUM(tarif), 0) as pertes_30j
          FROM reservation 
          WHERE statut = 'annulée'
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        `)
      ]);
  
      // Génération des recommandations
      const recommandations = [];
      
      if (terrainsProblematiques.rows.length > 0) {
        recommandations.push({
          type: 'critique',
          categorie: 'Terrains',
          message: `${terrainsProblematiques.rows.length} terrain(s) ont un taux d'annulation supérieur à 20%`,
          action: 'Analyser les causes et améliorer la qualité ou les conditions de réservation',
          terrains: terrainsProblematiques.rows.map(t => t.nomterrain)
        });
      }
  
      if (horairesCritiques.rows.length > 0) {
        recommandations.push({
          type: 'attention',
          categorie: 'Horaires',
          message: `${horairesCritiques.rows.length} créneau(x) horaire(s) sont particulièrement touchés`,
          action: 'Revoir la politique tarifaire ou proposer des incitations pour ces horaires',
          horaires: horairesCritiques.rows
        });
      }
  
      const tendance = tendanceGenerale.rows[0];
      if (tendance.annulations_30j > tendance.annulations_30j_precedent) {
        const augmentation = Math.round(((tendance.annulations_30j - tendance.annulations_30j_precedent) / tendance.annulations_30j_precedent) * 100);
        recommandations.push({
          type: 'alerte',
          categorie: 'Tendance',
          message: `Augmentation de ${augmentation}% des annulations ce mois`,
          action: 'Mettre en place une politique d\'annulation plus stricte ou des frais d\'annulation',
          impact_financier: tendance.pertes_30j
        });
      }
  
      res.json({
        success: true,
        recommandations,
        donnees_support: {
          terrains_problematiques: terrainsProblematiques.rows,
          horaires_critiques: horairesCritiques.rows,
          statistiques: tendance
        }
      });
    } catch (error) {
      console.error('❌ Erreur recommandations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
  });

export default router;