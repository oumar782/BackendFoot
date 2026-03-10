// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard (ANNULATIONS)
router.get('/dashboard-annulations', async (req, res) => {
  try {
    // Vérifier la connexion à la base de données
    if (!db || !db.query) {
      console.error('❌ Connexion à la base de données non disponible');
      return res.status(503).json({
        success: false,
        message: 'Service de base de données indisponible'
      });
    }

    // Récupérer les statistiques d'annulation en parallèle
    const [
      revenusPerdusMois,
      annulationsMois,
      terrainsAffectes,
      tauxAnnulation,
      statsTempsReel,
      revenusPerdusAnnee
    ] = await Promise.all([
      // Revenus perdus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `).catch(err => {
        console.error('❌ Erreur requête revenus perdus mois:', err);
        return { rows: [{ revenus_perdus_mois: 0 }] };
      }),
      
      // Annulations du mois
      db.query(`
        SELECT COUNT(*) as annulations_mois
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `).catch(err => {
        console.error('❌ Erreur requête annulations mois:', err);
        return { rows: [{ annulations_mois: 0 }] };
      }),
      
      // Terrains affectés par les annulations ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT numeroterrain) as terrains_affectes
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `).catch(err => {
        console.error('❌ Erreur requête terrains affectés:', err);
        return { rows: [{ terrains_affectes: 0 }] };
      }),
      
      // Taux d'annulation moyen du mois
      db.query(`
        SELECT 
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `).catch(err => {
        console.error('❌ Erreur requête taux annulation:', err);
        return { rows: [{ taux_annulation: 0 }] };
      }),
      
      // Statistiques temps réel des annulations
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as total_aujourdhui,
          ROUND(
            (COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END), 0)
            ), 2
          ) as taux_annulation_aujourdhui
        FROM reservation
      `).catch(err => {
        console.error('❌ Erreur requête stats temps réel:', err);
        return { rows: [{ annules_aujourdhui: 0, confirmes_aujourdhui: 0, total_aujourdhui: 0, taux_annulation_aujourdhui: 0 }] };
      }),
      
      // Revenus perdus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_perdus_annee
        FROM reservation 
        WHERE statut = 'annulée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `).catch(err => {
        console.error('❌ Erreur requête revenus perdus année:', err);
        return { rows: [{ revenus_perdus_annee: 0 }] };
      })
    ]);

    const stats = {
      revenus_perdus_mois: parseFloat(revenusPerdusMois?.rows[0]?.revenus_perdus_mois || 0),
      annulations_mois: parseInt(annulationsMois?.rows[0]?.annulations_mois || 0),
      terrains_affectes: parseInt(terrainsAffectes?.rows[0]?.terrains_affectes || 0),
      taux_annulation: parseFloat(tauxAnnulation?.rows[0]?.taux_annulation || 0),
      annules_aujourdhui: parseInt(statsTempsReel?.rows[0]?.annules_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel?.rows[0]?.confirmes_aujourdhui || 0),
      total_aujourdhui: parseInt(statsTempsReel?.rows[0]?.total_aujourdhui || 0),
      taux_annulation_aujourdhui: parseFloat(statsTempsReel?.rows[0]?.taux_annulation_aujourdhui || 0),
      revenus_perdus_annee: parseFloat(revenusPerdusAnnee?.rows[0]?.revenus_perdus_annee || 0)
    };

    // Calcul des trends d'annulation
    const trends = await calculateAnnulationTrends(stats).catch(err => {
      console.error('❌ Erreur calcul trends:', err);
      return {};
    });

    res.status(200).json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Route pour les terrains les plus affectés
router.get('/terrains-annulations', async (req, res) => {
    try {
      console.log('📡 Requête terrains annulations reçue');
      
      const result = await db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          typeterrain,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_total,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_total,
          COUNT(*) as total_reservations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_terrain,
          (
            SELECT TO_CHAR(datereservation, 'YYYY-MM')
            FROM reservation r2 
            WHERE r2.numeroterrain = reservation.numeroterrain 
            AND r2.statut = 'annulée'
            GROUP BY TO_CHAR(datereservation, 'YYYY-MM')
            ORDER BY COUNT(*) DESC
            LIMIT 1
          ) as periode_max_annulations
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY numeroterrain, nomterrain, typeterrain
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY annulations_total DESC, taux_annulation_terrain DESC
        LIMIT 10
      `).catch(err => {
        console.error('❌ Erreur requête terrains:', err);
        return { rows: [] };
      });
  
      console.log(`✅ ${result.rows.length} terrains trouvés`);
  
      res.status(200).json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
  
    } catch (error) {
      console.error('❌ Erreur analyse terrains annulations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
});

// 📊 Statistiques des annulations par période
router.get('/stats-periodes-annulations', async (req, res) => {
    try {
      const result = await db.query(`
        SELECT 
          -- Annulations futures (à venir)
          COUNT(CASE WHEN statut = 'annulée' AND datereservation > CURRENT_DATE THEN 1 END) as annulations_futures,
          COALESCE(SUM(CASE WHEN statut = 'annulée' AND datereservation > CURRENT_DATE THEN tarif ELSE 0 END), 0) as revenus_perdus_futurs,
          
          -- Annulations d'aujourd'hui
          COUNT(CASE WHEN statut = 'annulée' AND datereservation = CURRENT_DATE THEN 1 END) as annulations_aujourdhui,
          COALESCE(SUM(CASE WHEN statut = 'annulée' AND datereservation = CURRENT_DATE THEN tarif ELSE 0 END), 0) as revenus_perdus_aujourdhui,
          
          -- Annulations des 7 derniers jours
          COUNT(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as annulations_7_jours,
          COALESCE(SUM(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE - INTERVAL '7 days' AND CURRENT_DATE - INTERVAL '1 day' THEN tarif ELSE 0 END), 0) as revenus_perdus_7_jours,
          
          -- Prochaines annulations programmées
          COUNT(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '7 days' THEN 1 END) as annulations_7_prochains_jours,
          COALESCE(SUM(CASE WHEN statut = 'annulée' AND datereservation BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '7 days' THEN tarif ELSE 0 END), 0) as revenus_risque_7_jours
        FROM reservation
        WHERE statut = 'annulée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      `).catch(err => {
        console.error('❌ Erreur requête périodes:', err);
        return { rows: [{
          annulations_futures: 0,
          revenus_perdus_futurs: 0,
          annulations_aujourdhui: 0,
          revenus_perdus_aujourdhui: 0,
          annulations_7_jours: 0,
          revenus_perdus_7_jours: 0,
          annulations_7_prochains_jours: 0,
          revenus_risque_7_jours: 0
        }] };
      });
  
      res.status(200).json({
        success: true,
        data: result.rows[0] || {},
        periodes: {
          futur: 'Réservations annulées à venir',
          aujourdhui: "Annulations d'aujourd'hui",
          passe_recent: '7 derniers jours',
          futur_proche: '7 prochains jours'
        }
      });
    } catch (error) {
      console.error('❌ Erreur stats périodes annulations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
});

// 📈 Évolution des annulations sur 12 mois
router.get('/evolution-annulations', async (req, res) => {
  try {
    const { mois_centre = 'true' } = req.query;
    
    let query;
    
    if (mois_centre === 'true') {
      query = `
        WITH RECURSIVE mois_series AS (
          SELECT 
            DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months' as mois
          UNION ALL
          SELECT mois + INTERVAL '1 month'
          FROM mois_series
          WHERE mois < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '6 months'
        )
        SELECT 
          TO_CHAR(ms.mois, 'YYYY-MM') as periode,
          TO_CHAR(ms.mois, 'Mon YYYY') as periode_affichage,
          EXTRACT(MONTH FROM ms.mois) as numero_mois,
          EXTRACT(YEAR FROM ms.mois) as annee,
          COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as confirmations,
          COUNT(r.numeroreservations) as total_reservations,
          COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
          ROUND(
            (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(r.numeroreservations), 0)
            ), 2
          ) as taux_annulation_mensuel,
          CASE 
            WHEN DATE_TRUNC('month', ms.mois) = DATE_TRUNC('month', CURRENT_DATE) 
            THEN true 
            ELSE false 
          END as est_mois_courant
        FROM mois_series ms
        LEFT JOIN reservation r ON 
          DATE_TRUNC('month', r.datereservation) = ms.mois
        GROUP BY ms.mois
        ORDER BY ms.mois ASC
      `;
    } else {
      query = `
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
          EXTRACT(MONTH FROM ms.mois) as numero_mois,
          EXTRACT(YEAR FROM ms.mois) as annee,
          COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as confirmations,
          COUNT(r.numeroreservations) as total_reservations,
          COALESCE(SUM(CASE WHEN r.statut = 'annulée' THEN r.tarif ELSE 0 END), 0) as revenus_perdus,
          ROUND(
            (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(r.numeroreservations), 0)
            ), 2
          ) as taux_annulation_mensuel,
          CASE 
            WHEN DATE_TRUNC('month', ms.mois) = DATE_TRUNC('month', CURRENT_DATE) 
            THEN true 
            ELSE false 
          END as est_mois_courant
        FROM mois_series ms
        LEFT JOIN reservation r ON 
          DATE_TRUNC('month', r.datereservation) = ms.mois
        GROUP BY ms.mois
        ORDER BY ms.mois ASC
      `;
    }

    const result = await db.query(query).catch(err => {
      console.error('❌ Erreur requête évolution:', err);
      return { rows: [] };
    });

    // Ajouter des métadonnées
    const moisCourant = result.rows.find(row => row.est_mois_courant);
    const indexMoisCourant = result.rows.findIndex(row => row.est_mois_courant);

    res.status(200).json({
      success: true,
      data: result.rows,
      metadata: {
        type_analyse: mois_centre === 'true' ? 'centre' : 'standard',
        mois_courant: moisCourant || null,
        position_mois_courant: indexMoisCourant >= 0 ? indexMoisCourant + 1 : null,
        total_mois: result.rows.length
      }
    });
  } catch (error) {
    console.error('❌ Erreur évolution annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📋 Liste des annulations récentes
router.get('/annulations-recentes', async (req, res) => {
    try {
      const { limite = '20' } = req.query;
      
      const result = await db.query(`
        SELECT 
          r.numeroreservations,
          r.numeroterrain,
          r.nomterrain,
          r.typeterrain,
          r.datereservation,
          TO_CHAR(r.datereservation, 'DD/MM/YYYY') as date_formattee,
          TO_CHAR(r.datereservation, 'HH24:MI') as heure_reservation,
          r.tarif,
          r.nomclient,
          r.statut,
          r.email,
          r.telephone,
          CASE 
            WHEN r.datereservation > CURRENT_DATE THEN 
              'Dans ' || EXTRACT(DAY FROM (r.datereservation - CURRENT_DATE)) || ' jour(s)'
            WHEN r.datereservation = CURRENT_DATE THEN 
              'Aujourd\'hui'
            ELSE 
              'Il y a ' || EXTRACT(DAY FROM (CURRENT_DATE - r.datereservation)) || ' jour(s)'
          END as delai_affichage,
          CASE 
            WHEN r.datereservation > CURRENT_DATE THEN 'future'
            WHEN r.datereservation = CURRENT_DATE THEN 'present'
            ELSE 'passe'
          END as statut_temporel
        FROM reservation r
        WHERE r.statut = 'annulée'
          AND r.datereservation >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY 
          CASE 
            WHEN r.datereservation >= CURRENT_DATE THEN 0
            ELSE 1
          END,
          ABS(EXTRACT(EPOCH FROM (r.datereservation - CURRENT_DATE))) ASC
        LIMIT $1
      `, [limite]).catch(err => {
        console.error('❌ Erreur requête annulations récentes:', err);
        return { rows: [] };
      });
  
      const annulationsFutures = result.rows.filter(a => a.statut_temporel === 'future');
      const annulationsPresentes = result.rows.filter(a => a.statut_temporel === 'present');
      const annulationsPassees = result.rows.filter(a => a.statut_temporel === 'passe');
  
      res.status(200).json({
        success: true,
        data: {
          annulations_futures: annulationsFutures,
          annulations_aujourdhui: annulationsPresentes,
          annulations_passees: annulationsPassees.slice(0, 10),
          total: result.rows.length
        },
        resume: {
          futures: annulationsFutures.length,
          aujourdhui: annulationsPresentes.length,
          passees: annulationsPassees.length
        }
      });
    } catch (error) {
      console.error('❌ Erreur annulations récentes:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur interne du serveur',
        error: error.message
      });
    }
});

// 📅 Analyse temporelle des annulations
router.get('/analyse-temporelle-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH stats_journalieres AS (
        SELECT 
          datereservation,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          EXTRACT(DOW FROM datereservation) as num_jour_semaine,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
          COUNT(*) as total_reservations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY datereservation
      )
      SELECT 
        jour_semaine,
        num_jour_semaine,
        ROUND(AVG(annulations), 2) as annulations_moyennes,
        ROUND(AVG(confirmations), 2) as confirmations_moyennes,
        ROUND(AVG(total_reservations), 2) as reservations_moyennes,
        ROUND(AVG(revenus_perdus), 2) as revenus_perdus_moyens,
        ROUND(
          (SUM(annulations) * 100.0 / NULLIF(SUM(total_reservations), 0)
          ), 2
        ) as taux_annulation_jour,
        SUM(annulations) as annulations_total,
        SUM(confirmations) as confirmations_total
      FROM stats_journalieres
      GROUP BY jour_semaine, num_jour_semaine
      ORDER BY num_jour_semaine
    `).catch(err => {
      console.error('❌ Erreur requête analyse temporelle:', err);
      return { rows: [] };
    });

    const statsGlobales = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as total_revenus_perdus,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_global
      FROM reservation 
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
    `).catch(err => {
      console.error('❌ Erreur requête stats globales:', err);
      return { rows: [{ total_annulations: 0, total_confirmations: 0, total_reservations: 0, total_revenus_perdus: 0, taux_annulation_global: 0 }] };
    });

    res.status(200).json({
      success: true,
      data: {
        analyse_journaliere: result.rows,
        statistiques_globales: statsGlobales.rows[0] || {},
        periode_analyse: parseInt(periode)
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse temporelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions des annulations futures
router.get('/previsions-annulations', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const historiqueParJour = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_semaine,
        TO_CHAR(datereservation, 'Day') as nom_jour,
        COUNT(*) as total_reservations_historique,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_historique,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_historique,
        ROUND(
          (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
          NULLIF(COUNT(*), 0)
          ), 2
        ) as taux_annulation_historique
      FROM reservation 
      WHERE datereservation BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE - INTERVAL '1 day'
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_semaine
    `).catch(err => {
      console.error('❌ Erreur requête historique:', err);
      return { rows: [] };
    });

    const reservationsFutures = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as num_jour_semaine,
        COUNT(*) as reservations_prevues,
        COALESCE(SUM(tarif), 0) as revenus_prevus
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
      GROUP BY datereservation
      ORDER BY datereservation ASC
    `).catch(err => {
      console.error('❌ Erreur requête réservations futures:', err);
      return { rows: [] };
    });

    const previsionsParJour = reservationsFutures.rows.map(jour => {
      const statsJour = historiqueParJour.rows.find(
        stat => stat.jour_semaine === jour.num_jour_semaine
      );
      
      const tauxAnnulationMoyen = statsJour ? parseFloat(statsJour.taux_annulation_historique) : 10.0;
      const annulationsPrevues = Math.round(jour.reservations_prevues * (tauxAnnulationMoyen / 100));
      const revenusRisquePerte = Math.round(jour.revenus_prevus * (tauxAnnulationMoyen / 100));
      
      return {
        date: jour.datereservation,
        jour_semaine: jour.jour_semaine.trim(),
        reservations_prevues: parseInt(jour.reservations_prevues),
        revenus_prevus: parseFloat(jour.revenus_prevus),
        taux_annulation_historique: tauxAnnulationMoyen,
        annulations_prevues: annulationsPrevues,
        revenus_risque_perte: revenusRisquePerte,
        niveau_risque: getNiveauRisque(tauxAnnulationMoyen)
      };
    });

    const statsGlobalesPrevisions = previsionsParJour.reduce((acc, jour) => ({
      reservations_prevues_total: acc.reservations_prevues_total + jour.reservations_prevues,
      revenus_prevus_total: acc.revenus_prevus_total + jour.revenus_prevus,
      annulations_prevues_total: acc.annulations_prevues_total + jour.annulations_prevues,
      revenus_risque_total: acc.revenus_risque_total + jour.revenus_risque_perte
    }), {
      reservations_prevues_total: 0,
      revenus_prevus_total: 0,
      annulations_prevues_total: 0,
      revenus_risque_total: 0
    });

    const tauxAnnulationMoyenPrevu = statsGlobalesPrevisions.reservations_prevues_total > 0 
      ? (statsGlobalesPrevisions.annulations_prevues_total / statsGlobalesPrevisions.reservations_prevues_total) * 100
      : 0;

    const joursHautRisque = previsionsParJour
      .filter(jour => jour.niveau_risque === 'Élevé')
      .sort((a, b) => b.annulations_prevues - a.annulations_prevues);

    const patterns = await db.query(`
      SELECT 
        TO_CHAR(datereservation, 'YYYY-MM-DD') as date_annulation,
        COUNT(*) as annulations_ce_jour,
        COALESCE(SUM(tarif), 0) as revenus_perdus
      FROM reservation 
      WHERE statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY datereservation
      ORDER BY datereservation DESC
    `).catch(err => {
      console.error('❌ Erreur requête patterns:', err);
      return { rows: [] };
    });

    res.status(200).json({
      success: true,
      data: {
        previsions_globales: {
          ...statsGlobalesPrevisions,
          taux_annulation_moyen_prevu: Math.round(tauxAnnulationMoyenPrevu * 100) / 100,
          periode_analyse: parseInt(periode),
          niveau_risque_global: getNiveauRisque(tauxAnnulationMoyenPrevu)
        },
        previsions_par_jour: previsionsParJour,
        jours_haut_risque: joursHautRisque.slice(0, 5),
        statistiques_historiques: historiqueParJour.rows,
        patterns_recents: patterns.rows,
        resume_hebdomadaire: calculerResumeHebdomadaire(previsionsParJour)
      }
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

// 📅 Route pour récupérer les dates d'annulation détaillées par terrain
router.get('/dates-annulation-terrain/:terrainId', async (req, res) => {
  try {
    const { terrainId } = req.params;
    
    const result = await db.query(`
      SELECT 
        TO_CHAR(datereservation, 'YYYY-MM-DD') as date_annulation,
        TO_CHAR(datereservation, 'HH24:MI') as heure,
        tarif,
        nomclient as client,
        statut
      FROM reservation 
      WHERE numeroterrain = $1 
        AND statut = 'annulée'
        AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY datereservation DESC
      LIMIT 20
    `, [terrainId]).catch(err => {
      console.error('❌ Erreur requête dates terrain:', err);
      return { rows: [] };
    });

    res.status(200).json({
      success: true,
      data: result.rows,
      terrain_id: terrainId
    });
  } catch (error) {
    console.error('❌ Erreur dates annulation terrain:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 Tableau de bord complet annulations
router.get('/synthese-annulations', async (req, res) => {
  try {
    const [
      statsMois,
      topTerrains,
      evolutionMensuelle,
      analyseRecent
    ] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations_mois,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation_mois
        FROM reservation 
        WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `).catch(err => {
        console.error('❌ Erreur stats mois:', err);
        return { rows: [{ annulations_mois: 0, confirmations_mois: 0, revenus_perdus_mois: 0, taux_annulation_mois: 0 }] };
      }),
      
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '3 months'
        GROUP BY numeroterrain, nomterrain
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY annulations DESC
        LIMIT 5
      `).catch(err => {
        console.error('❌ Erreur top terrains:', err);
        return { rows: [] };
      }),
      
      db.query(`
        WITH mois_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '5 months',
            CURRENT_DATE,
            '1 month'::interval
          )::date as mois
        )
        SELECT 
          TO_CHAR(ms.mois, 'Mon YYYY') as periode,
          COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as annulations,
          ROUND(
            (COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(r.numeroreservations), 0)
            ), 2
          ) as taux_annulation
        FROM mois_series ms
        LEFT JOIN reservation r ON 
          EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
        GROUP BY ms.mois
        ORDER BY ms.mois ASC
      `).catch(err => {
        console.error('❌ Erreur évolution:', err);
        return { rows: [] };
      }),
      
      db.query(`
        SELECT 
          TO_CHAR(datereservation, 'DD/MM') as date_jour,
          TO_CHAR(datereservation, 'Day') as jour_semaine,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `).catch(err => {
        console.error('❌ Erreur analyse récente:', err);
        return { rows: [] };
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        stats_mois: statsMois.rows[0] || {},
        top_terrains_annulations: topTerrains.rows,
        evolution_6_mois: evolutionMensuelle.rows,
        analyse_7_jours: analyseRecent.rows
      }
    });
  } catch (error) {
    console.error('❌ Erreur synthèse annulations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// ============================================
// NOUVELLES ROUTES D'ANALYSE CLIENTS
// ============================================

// 👥 CLASSIFICATION DES CLIENTS PAR NIVEAU DE NUISANCE
router.get('/classification-clients', async (req, res) => {
  try {
    const { periode = '6 months' } = req.query;
    
    const result = await db.query(`
      WITH stats_clients AS (
        SELECT 
          nomclient,
          email,
          telephone,
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
          COUNT(CASE WHEN statut = 'annulée' AND datereservation > CURRENT_DATE THEN 1 END) as annulations_futures,
          COUNT(CASE WHEN statut = 'annulée' AND datereservation < CURRENT_DATE THEN 1 END) as annulations_passees,
          COUNT(CASE WHEN statut = 'annulée' AND datereservation = CURRENT_DATE THEN 1 END) as annulations_aujourdhui,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes_causees,
          COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as montant_generes,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0)
            ), 2
          ) as taux_annulation,
          MAX(CASE WHEN statut = 'annulée' THEN datereservation END) as derniere_annulation,
          MIN(CASE WHEN statut = 'annulée' THEN datereservation END) as premiere_annulation,
          AVG(CASE 
            WHEN statut = 'annulée' AND datereservation > CURRENT_DATE 
            THEN EXTRACT(DAY FROM (datereservation - CURRENT_DATE))
            ELSE NULL 
          END) as delai_moyen_annulation_jours,
          COUNT(DISTINCT DATE_TRUNC('day', datereservation)) as jours_avec_annulations
        FROM reservation 
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode}'
        GROUP BY nomclient, email, telephone
        HAVING COUNT(*) >= 2
      ),
      classification AS (
        SELECT 
          *,
          CASE 
            WHEN taux_annulation >= 50 OR total_annulations >= 5 
                 OR (montant_pertes_causees > montant_generes * 0.5)
                 OR (annulations_futures >= 3 AND delai_moyen_annulation_jours < 2)
            THEN 'Critique'
            
            WHEN taux_annulation BETWEEN 25 AND 49.99 
                 OR (total_annulations >= 3 AND total_annulations < 5)
                 OR (montant_pertes_causees BETWEEN montant_generes * 0.25 AND montant_generes * 0.5)
                 OR (annulations_futures >= 2)
            THEN 'Modérée'
            
            WHEN taux_annulation BETWEEN 10 AND 24.99
                 OR (total_annulations >= 1 AND total_annulations < 3)
                 OR (montant_pertes_causees < montant_generes * 0.25)
            THEN 'Faible'
            
            ELSE 'Fiable'
          END as niveau_nuisance,
          
          LEAST(100, (
            (taux_annulation * 0.4) + 
            (LEAST(total_annulations, 20) * 3) +
            ((montant_pertes_causees / NULLIF(montant_generes, 1)) * 30) +
            (CASE WHEN annulations_futures > 0 THEN 20 ELSE 0 END) +
            (CASE WHEN delai_moyen_annulation_jours < 3 THEN 15 ELSE 0 END)
          )) as score_nuisance,
          
          CASE 
            WHEN taux_annulation >= 50 THEN 'Taux annulation élevé'
            WHEN total_annulations >= 5 THEN 'Nombre annulations important'
            WHEN montant_pertes_causees > montant_generes * 0.5 THEN 'Pertes > 50% du CA généré'
            WHEN annulations_futures >= 3 AND delai_moyen_annulation_jours < 2 THEN 'Annulations tardives multiples'
            WHEN taux_annulation BETWEEN 25 AND 49.99 THEN 'Taux annulation modéré'
            WHEN total_annulations >= 3 THEN 'Annulations régulières'
            ELSE 'Comportement normal'
          END as raison_classification
        FROM stats_clients
      )
      SELECT 
        *,
        CASE niveau_nuisance
          WHEN 'Critique' THEN '🚫 Blocage recommandé ou caution obligatoire'
          WHEN 'Modérée' THEN '⚠️ Surveillance renforcée + rappels automatiques'
          WHEN 'Faible' THEN '📧 Relances préventives avant réservation'
          ELSE '💚 Aucune action particulière'
        END as recommandation,
        ROUND(montant_generes - montant_pertes_causees, 2) as impact_financier_net,
        ROUND((montant_pertes_causees / NULLIF(montant_generes, 0)) * 100, 2) as ratio_pertes_sur_gains
      FROM classification
      ORDER BY 
        CASE niveau_nuisance
          WHEN 'Critique' THEN 1
          WHEN 'Modérée' THEN 2
          WHEN 'Faible' THEN 3
          ELSE 4
        END,
        score_nuisance DESC,
        total_annulations DESC
    `).catch(err => {
      console.error('❌ Erreur requête classification:', err);
      return { rows: [] };
    });

    const statsParCategorie = {
      critique: result.rows.filter(r => r.niveau_nuisance === 'Critique').length,
      moderee: result.rows.filter(r => r.niveau_nuisance === 'Modérée').length,
      faible: result.rows.filter(r => r.niveau_nuisance === 'Faible').length,
      fiable: result.rows.filter(r => r.niveau_nuisance === 'Fiable').length
    };

    const impactFinancier = {
      critique: result.rows
        .filter(r => r.niveau_nuisance === 'Critique')
        .reduce((acc, r) => acc + parseFloat(r.montant_pertes_causees || 0), 0),
      moderee: result.rows
        .filter(r => r.niveau_nuisance === 'Modérée')
        .reduce((acc, r) => acc + parseFloat(r.montant_pertes_causees || 0), 0),
      faible: result.rows
        .filter(r => r.niveau_nuisance === 'Faible')
        .reduce((acc, r) => acc + parseFloat(r.montant_pertes_causees || 0), 0),
      fiable: result.rows
        .filter(r => r.niveau_nuisance === 'Fiable')
        .reduce((acc, r) => acc + parseFloat(r.montant_pertes_causees || 0), 0)
    };

    res.status(200).json({
      success: true,
      data: {
        classification_clients: result.rows,
        statistiques: {
          total_clients_analyses: result.rows.length,
          repartition_categories: statsParCategorie,
          impact_financier_par_categorie: impactFinancier,
          pertes_totales: Object.values(impactFinancier).reduce((a, b) => a + b, 0)
        },
        top_nuisibles: result.rows
          .filter(r => r.niveau_nuisance === 'Critique')
          .slice(0, 10)
          .map(r => ({
            client: r.nomclient,
            email: r.email,
            annulations: r.total_annulations,
            pertes: r.montant_pertes_causees,
            score: r.score_nuisance
          }))
      }
    });
  } catch (error) {
    console.error('❌ Erreur classification clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 ANALYSE COMPORTEMENTALE AVANCÉE DES CLIENTS
router.get('/analyse-comportementale', async (req, res) => {
  try {
    const result = await db.query(`
      WITH comportements AS (
        SELECT 
          nomclient,
          email,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            AND EXTRACT(HOUR FROM datereservation) BETWEEN 18 AND 23 
            THEN 1 
          END) as annulations_soir,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            AND EXTRACT(DOW FROM datereservation) IN (0, 6) 
            THEN 1 
          END) as annulations_weekend,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'
            THEN 1 
          END) as annulations_derniere_minute,
          COUNT(CASE 
            WHEN statut = 'annulée' 
            THEN 1 
          END) as total_annulations,
          COUNT(CASE 
            WHEN statut = 'annulée' AND datereservation > CURRENT_DATE
            THEN 1 
          END) as reservations_abandonnees,
          COUNT(DISTINCT DATE_TRUNC('week', datereservation)) as semaines_avec_annulations
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY nomclient, email
      )
      SELECT 
        *,
        CASE 
          WHEN annulations_soir >= 3 OR annulations_weekend >= 3 THEN 'Pattern soir/weekend'
          WHEN annulations_derniere_minute >= 2 THEN 'Annulations impulsives'
          WHEN reservations_abandonnees >= 3 THEN 'Réserve sans confirmer'
          WHEN semaines_avec_annulations >= 4 THEN 'Récidiviste chronique'
          ELSE 'Pattern normal'
        END as pattern_comportemental
      FROM comportements
      WHERE total_annulations >= 2
      ORDER BY total_annulations DESC
      LIMIT 50
    `).catch(err => {
      console.error('❌ Erreur requête comportementale:', err);
      return { rows: [] };
    });

    res.status(200).json({
      success: true,
      data: result.rows,
      analyse: {
        patterns_dominants: analyzePatterns(result.rows),
        recommandations: generateBehavioralRecommendations(result.rows)
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse comportementale:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 💰 ANALYSE DE L'IMPACT FINANCIER PAR CLIENT
router.get('/impact-financier-clients', async (req, res) => {
  try {
    const result = await db.query(`
      WITH financier AS (
        SELECT 
          nomclient,
          email,
          COUNT(*) as total_resa,
          SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END) as ca_genere,
          SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) as pertes_causees,
          AVG(CASE WHEN statut = 'confirmée' THEN tarif END) as panier_moyen_confirme,
          AVG(CASE WHEN statut = 'annulée' THEN tarif END) as panier_moyen_annule,
          ROUND(
            (SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) * 100.0 / 
            NULLIF(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0)
            ), 2
          ) as ratio_impact
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY nomclient, email
        HAVING SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END) > 0
      )
      SELECT 
        *,
        CASE 
          WHEN ratio_impact > 50 THEN '🔴 Impact majeur'
          WHEN ratio_impact BETWEEN 20 AND 50 THEN '🟠 Impact significatif'
          WHEN ratio_impact BETWEEN 5 AND 19.99 THEN '🟡 Impact modéré'
          ELSE '🟢 Impact mineur'
        END as niveau_impact,
        ca_genere - pertes_causees as marge_nette
      FROM financier
      ORDER BY ratio_impact DESC, pertes_causees DESC
    `).catch(err => {
      console.error('❌ Erreur requête impact financier:', err);
      return { rows: [] };
    });

    res.status(200).json({
      success: true,
      data: result.rows,
      metriques: {
        pertes_totales: result.rows.reduce((acc, r) => acc + parseFloat(r.pertes_causees || 0), 0),
        clients_impact_majeur: result.rows.filter(r => r.niveau_impact && r.niveau_impact.includes('majeur')).length,
        perte_moyenne_par_client: result.rows.length > 0 ? result.rows.reduce((acc, r) => acc + parseFloat(r.pertes_causees || 0), 0) / result.rows.length : 0
      }
    });
  } catch (error) {
    console.error('❌ Erreur impact financier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🚨 ALERTES AUTOMATIQUES SUR COMPORTEMENTS SUSPECTS
router.get('/alertes-comportement', async (req, res) => {
  try {
    const alertes = await db.query(`
      WITH dernieres_activites AS (
        SELECT 
          nomclient,
          email,
          telephone,
          datereservation,
          statut,
          tarif,
          numeroterrain,
          CASE 
            WHEN COUNT(*) OVER (PARTITION BY nomclient, DATE(datereservation)) >= 3 
            AND statut = 'annulée' THEN 'Multi-annulations journalières'
            
            WHEN COUNT(DISTINCT numeroterrain) OVER (PARTITION BY nomclient, DATE(datereservation)) >= 2 
            AND statut = 'annulée' THEN 'Annulations sur multiples terrains'
            
            WHEN (
              SELECT COUNT(*) 
              FROM reservation r2 
              WHERE r2.nomclient = reservation.nomclient 
              AND r2.statut = 'annulée'
              AND r2.datereservation >= CURRENT_DATE - INTERVAL '30 days'
            ) >= 4 THEN 'Pattern récurrent détecté'
            
            WHEN statut = 'annulée' 
            AND datereservation = CURRENT_DATE
            AND (
              SELECT COUNT(*) 
              FROM reservation r3 
              WHERE r3.nomclient = reservation.nomclient 
              AND r3.statut = 'confirmée'
              AND r3.datereservation = CURRENT_DATE
            ) = 0 THEN 'Annulation immédiate'
            
            ELSE NULL
          END as type_alerte
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '7 days'
          AND statut = 'annulée'
      )
      SELECT DISTINCT
        nomclient,
        email,
        telephone,
        type_alerte,
        COUNT(*) as nombre_incidents,
        MAX(datereservation) as dernier_incident,
        SUM(tarif) as impact_financier
      FROM dernieres_activites
      WHERE type_alerte IS NOT NULL
      GROUP BY nomclient, email, telephone, type_alerte
      ORDER BY dernier_incident DESC, impact_financier DESC
    `).catch(err => {
      console.error('❌ Erreur requête alertes:', err);
      return { rows: [] };
    });

    res.status(200).json({
      success: true,
      alertes: alertes.rows,
      resume: {
        total_alertes: alertes.rows.length,
        types_alertes: alertes.rows.reduce((acc, a) => {
          acc[a.type_alerte] = (acc[a.type_alerte] || 0) + 1;
          return acc;
        }, {}),
        impact_total: alertes.rows.reduce((acc, a) => acc + parseFloat(a.impact_financier || 0), 0)
      },
      recommandations: generateAlertsRecommendations(alertes.rows)
    });
  } catch (error) {
    console.error('❌ Erreur alertes comportement:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 PRÉDICTION DES RISQUES D'ANNULATION PAR CLIENT
router.get('/prediction-risques-clients', async (req, res) => {
  try {
    const result = await db.query(`
      WITH historique_client AS (
        SELECT 
          nomclient,
          email,
          COUNT(*) as total_resa,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          AVG(CASE 
            WHEN statut = 'annulée' AND datereservation > CURRENT_DATE 
            THEN EXTRACT(DAY FROM (datereservation - CURRENT_DATE))
            ELSE NULL 
          END) as delai_moyen_annulation,
          MAX(CASE WHEN statut = 'annulée' THEN datereservation END) as derniere_annulation,
          CASE 
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) >= 3 
            AND (
              COUNT(CASE WHEN statut = 'annulée' AND datereservation > CURRENT_DATE THEN 1 END) >= 1
              OR AVG(CASE WHEN statut = 'annulée' THEN tarif END) > 100
            ) THEN 'Élevé'
            
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) = 2
            OR (
              COUNT(CASE WHEN statut = 'annulée' THEN 1 END) >= 1
              AND AVG(CASE WHEN statut = 'annulée' THEN tarif END) > 150
            ) THEN 'Moyen'
            
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) = 1
            AND AVG(CASE WHEN statut = 'annulée' THEN tarif END) < 100 THEN 'Faible'
            
            ELSE 'Très faible'
          END as risque_futur
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY nomclient, email
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
      )
      SELECT 
        *,
        CASE risque_futur
          WHEN 'Élevé' THEN ROUND(70 + (RANDOM() * 20), 2)
          WHEN 'Moyen' THEN ROUND(40 + (RANDOM() * 20), 2)
          WHEN 'Faible' THEN ROUND(15 + (RANDOM() * 15), 2)
          ELSE ROUND(RANDOM() * 10, 2)
        END as probabilite_annulation,
        CASE risque_futur
          WHEN 'Élevé' THEN 'Caution obligatoire + confirmation téléphonique'
          WHEN 'Moyen' THEN 'Rappel SMS 24h avant'
          WHEN 'Faible' THEN 'Relance email standard'
          ELSE 'Aucune action particulière'
        END as action_preventive
      FROM historique_client
      ORDER BY 
        CASE risque_futur
          WHEN 'Élevé' THEN 1
          WHEN 'Moyen' THEN 2
          WHEN 'Faible' THEN 3
          ELSE 4
        END,
        total_annulations DESC
    `).catch(err => {
      console.error('❌ Erreur requête prédiction:', err);
      return { rows: [] };
    });

    res.status(200).json({
      success: true,
      predictions: result.rows,
      statistiques_risques: {
        eleve: result.rows.filter(r => r.risque_futur === 'Élevé').length,
        moyen: result.rows.filter(r => r.risque_futur === 'Moyen').length,
        faible: result.rows.filter(r => r.risque_futur === 'Faible').length,
        tres_faible: result.rows.filter(r => r.risque_futur === 'Très faible').length
      }
    });
  } catch (error) {
    console.error('❌ Erreur prédiction risques:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📊 ANALYSE CORRÉLATION ANNULATIONS - PROFIL CLIENT
router.get('/correlation-profil-clients', async (req, res) => {
  try {
    const result = await db.query(`
      WITH profils AS (
        SELECT 
          CASE 
            WHEN AVG(tarif) < 50 THEN 'Petit budget'
            WHEN AVG(tarif) BETWEEN 50 AND 150 THEN 'Budget moyen'
            ELSE 'Gros budget'
          END as categorie_budget,
          
          CASE 
            WHEN COUNT(*) / 6 > 4 THEN 'Très fréquent'
            WHEN COUNT(*) / 6 BETWEEN 2 AND 4 THEN 'Fréquent'
            ELSE 'Occasionnel'
          END as frequence_reservation,
          
          MODE() WITHIN GROUP (ORDER BY typeterrain) as terrain_prefere,
          
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          COUNT(*) as total_reservations,
          ROUND(
            (COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*)
            ), 2
          ) as taux_annulation
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY nomclient
      )
      SELECT 
        categorie_budget,
        frequence_reservation,
        terrain_prefere,
        COUNT(*) as nombre_clients,
        SUM(total_annulations) as annulations_total,
        SUM(total_reservations) as reservations_total,
        ROUND(AVG(taux_annulation), 2) as taux_annulation_moyen,
        ROUND(SUM(total_annulations) * 100.0 / NULLIF(SUM(total_reservations), 0), 2) as taux_global
      FROM profils
      GROUP BY categorie_budget, frequence_reservation, terrain_prefere
      ORDER BY taux_annulation_moyen DESC
    `).catch(err => {
      console.error('❌ Erreur requête corrélation:', err);
      return { rows: [] };
    });

    res.status(200).json({
      success: true,
      correlations: result.rows,
      insights: generateCorrelationInsights(result.rows)
    });
  } catch (error) {
    console.error('❌ Erreur corrélation profils:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Route de test pour vérifier que l'API fonctionne
router.get('/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API stats fonctionne correctement',
    timestamp: new Date().toISOString(),
    routes: [
      '/dashboard-annulations',
      '/terrains-annulations',
      '/stats-periodes-annulations',
      '/evolution-annulations',
      '/annulations-recentes',
      '/analyse-temporelle-annulations',
      '/previsions-annulations',
      '/dates-annulation-terrain/:terrainId',
      '/synthese-annulations',
      '/classification-clients',
      '/analyse-comportementale',
      '/impact-financier-clients',
      '/alertes-comportement',
      '/prediction-risques-clients',
      '/correlation-profil-clients',
      '/test'
    ]
  });
});

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

async function calculateAnnulationTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_mois_dernier,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus_mois_dernier
      FROM reservation 
      WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `).catch(err => {
      console.error('❌ Erreur calcul trends:', err);
      return { rows: [{ annulations_mois_dernier: 0, revenus_perdus_mois_dernier: 0 }] };
    });

    const lastMonth = lastMonthStats.rows[0] || { annulations_mois_dernier: 0, revenus_perdus_mois_dernier: 0 };
    
    const trends = {
      annulations: {
        value: calculatePercentageChange(currentStats.annulations_mois, lastMonth.annulations_mois_dernier),
        isPositive: currentStats.annulations_mois < lastMonth.annulations_mois_dernier
      },
      revenus_perdus: {
        value: calculatePercentageChange(currentStats.revenus_perdus_mois, lastMonth.revenus_perdus_mois_dernier),
        isPositive: currentStats.revenus_perdus_mois < lastMonth.revenus_perdus_mois_dernier
      },
      taux_annulation: {
        value: calculatePercentageChange(currentStats.taux_annulation, 
          (lastMonth.annulations_mois_dernier * 100.0 / Math.max(lastMonth.annulations_mois_dernier + currentStats.confirmes_aujourdhui, 1)) || 0),
        isPositive: currentStats.taux_annulation < ((lastMonth.annulations_mois_dernier * 100.0 / Math.max(lastMonth.annulations_mois_dernier + currentStats.confirmes_aujourdhui, 1)) || 0)
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends annulations:', error);
    return {
      annulations: { value: 0, isPositive: true },
      revenus_perdus: { value: 0, isPositive: true },
      taux_annulation: { value: 0, isPositive: true }
    };
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0 || previous === null || previous === undefined) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 100);
}

function getNiveauRisque(tauxAnnulation) {
  if (tauxAnnulation > 20) return 'Élevé';
  if (tauxAnnulation > 10) return 'Modéré';
  return 'Faible';
}

function calculerResumeHebdomadaire(previsionsParJour) {
  const resume = {};
  
  previsionsParJour.forEach(jour => {
    if (!resume[jour.jour_semaine]) {
      resume[jour.jour_semaine] = {
        reservations_prevues: 0,
        annulations_prevues: 0,
        revenus_risque_perte: 0,
        nombre_jours: 0
      };
    }
    
    resume[jour.jour_semaine].reservations_prevues += jour.reservations_prevues;
    resume[jour.jour_semaine].annulations_prevues += jour.annulations_prevues;
    resume[jour.jour_semaine].revenus_risque_perte += jour.revenus_risque_perte;
    resume[jour.jour_semaine].nombre_jours += 1;
  });
  
  return Object.entries(resume).map(([jour, stats]) => ({
    jour_semaine: jour,
    reservations_prevues_moyennes: Math.round(stats.reservations_prevues / stats.nombre_jours),
    annulations_prevues_moyennes: Math.round(stats.annulations_prevues / stats.nombre_jours),
    revenus_risque_moyens: Math.round(stats.revenus_risque_perte / stats.nombre_jours),
    taux_annulation_moyen: stats.reservations_prevues > 0 ? Math.round((stats.annulations_prevues / stats.reservations_prevues) * 100 * 100) / 100 : 0
  })).sort((a, b) => b.taux_annulation_moyen - a.taux_annulation_moyen);
}

function analyzePatterns(rows) {
  const patterns = {};
  rows.forEach(r => {
    if (r.pattern_comportemental) {
      patterns[r.pattern_comportemental] = (patterns[r.pattern_comportemental] || 0) + 1;
    }
  });
  return patterns;
}

function generateBehavioralRecommendations(rows) {
  const recommendations = [];
  
  const patternCounts = analyzePatterns(rows);
  
  if (patternCounts['Pattern soir/weekend'] > 5) {
    recommendations.push("Augmenter les cautions pour les réservations en soirée/weekend");
  }
  
  if (patternCounts['Annulations impulsives'] > 3) {
    recommendations.push("Mettre en place un délai de rétractation de 24h avant annulation sans frais");
  }
  
  if (patternCounts['Récidiviste chronique'] > 2) {
    recommendations.push("Créer une liste noire pour les clients avec annulations répétées");
  }
  
  return recommendations;
}

function generateAlertsRecommendations(alertes) {
  const reco = [];
  const types = alertes.reduce((acc, a) => {
    if (a.type_alerte) {
      acc[a.type_alerte] = (acc[a.type_alerte] || 0) + 1;
    }
    return acc;
  }, {});
  
  if (types['Multi-annulations journalières'] > 2) {
    reco.push("Limiter le nombre de réservations par client et par jour");
  }
  
  if (types['Annulations sur multiples terrains'] > 2) {
    reco.push("Surveiller les réservations groupées sur plusieurs terrains");
  }
  
  return reco;
}

function generateCorrelationInsights(correlations) {
  const insights = [];
  
  if (correlations.length > 0) {
    const plusRisque = correlations.reduce((max, c) => 
      parseFloat(c.taux_annulation_moyen || 0) > parseFloat(max.taux_annulation_moyen || 0) ? c : max
    , correlations[0]);
    
    if (plusRisque && plusRisque.taux_annulation_moyen) {
      insights.push(`⚠️ Profil le plus risqué: ${plusRisque.categorie_budget || 'N/A'}, ${plusRisque.frequence_reservation || 'N/A'}, terrain ${plusRisque.terrain_prefere || 'N/A'} (${plusRisque.taux_annulation_moyen}% annulations)`);
    }
    
    const budgetRisque = correlations
      .filter(c => c.categorie_budget === 'Gros budget')
      .reduce((acc, c) => acc + parseFloat(c.taux_annulation_moyen || 0), 0);
      
    if (budgetRisque / 3 > 20) {
      insights.push("💰 Les clients gros budget ont tendance à plus annuler - prévoir des conditions spéciales");
    }
  }
  
  return insights;
}

export default router;