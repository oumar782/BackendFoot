// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { periode = 'mois' } = req.query;

    // Requêtes parallèles pour meilleures performances
    const [
      revenusResult,
      reservationsResult,
      clientsResult,
      terrainsResult,
      tempsReelResult,
      tendancesResult
    ] = await Promise.all([
      // Revenus totaux
      db.query(`
        SELECT 
          COALESCE(SUM(tarif), 0) as revenu_total,
          COUNT(*) as nb_reservations,
          ROUND(AVG(tarif), 2) as revenu_moyen,
          MAX(tarif) as revenu_max,
          MIN(tarif) as revenu_min
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
      `),

      // Réservations par statut
      db.query(`
        SELECT 
          statut,
          COUNT(*) as count,
          ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM reservation WHERE datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)), 2) as percentage
        FROM reservation 
        WHERE datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
        GROUP BY statut
      `),

      // Clients actifs
      db.query(`
        SELECT 
          COUNT(*) as total_clients,
          COUNT(CASE WHEN statut = 'actif' THEN 1 END) as clients_actifs,
          COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as clients_inactifs
        FROM clients
      `),

      // Occupation des terrains
      db.query(`
        WITH occupation AS (
          SELECT 
            numeroterrain,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_occupees
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
          GROUP BY numeroterrain
        )
        SELECT 
          COUNT(*) as terrains_utilises,
          ROUND(AVG(nb_reservations), 2) as reservations_moyennes,
          ROUND(AVG(heures_occupees), 2) as heures_moyennes,
          SUM(heures_occupees) as total_heures
        FROM occupation
      `),

      // Données temps réel
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as reservations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annulations_aujourdhui,
          COALESCE(SUM(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN tarif ELSE 0 END), 0) as revenu_aujourdhui,
          COUNT(DISTINCT CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN numeroterrain END) as terrains_occupes_aujourdhui
        FROM reservation
      `),

      // Tendances vs période précédente
      db.query(`
        WITH current_period AS (
          SELECT 
            COUNT(*) as reservations_courantes,
            COALESCE(SUM(tarif), 0) as revenu_courant
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE)
        ),
        previous_period AS (
          SELECT 
            COUNT(*) as reservations_precedentes,
            COALESCE(SUM(tarif), 0) as revenu_precedent
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= DATE_TRUNC('${periode}', CURRENT_DATE - INTERVAL '1 ${periode}')
            AND datereservation < DATE_TRUNC('${periode}', CURRENT_DATE)
        )
        SELECT 
          cp.reservations_courantes,
          cp.revenu_courant,
          pp.reservations_precedentes,
          pp.revenu_precedent,
          CASE 
            WHEN pp.reservations_precedentes > 0 THEN
              ROUND(((cp.reservations_courantes - pp.reservations_precedentes) / pp.reservations_precedentes * 100), 2)
            ELSE 100
          END as evolution_reservations,
          CASE 
            WHEN pp.revenu_precedent > 0 THEN
              ROUND(((cp.revenu_courant - pp.revenu_precedent) / pp.revenu_precedent * 100), 2)
            ELSE 100
          END as evolution_revenus
        FROM current_period cp, previous_period pp
      `)
    ]);

    const stats = {
      periode: periode,
      date_actualisation: new Date().toISOString(),
      
      // Métriques principales
      revenus: {
        total: parseFloat(revenusResult.rows[0].revenu_total),
        moyen: parseFloat(revenusResult.rows[0].revenu_moyen),
        max: parseFloat(revenusResult.rows[0].revenu_max),
        min: parseFloat(revenusResult.rows[0].revenu_min),
        reservations: parseInt(revenusResult.rows[0].nb_reservations)
      },

      reservations: {
        par_statut: reservationsResult.rows,
        total: reservationsResult.rows.reduce((sum, row) => sum + parseInt(row.count), 0)
      },

      clients: {
        total: parseInt(clientsResult.rows[0].total_clients),
        actifs: parseInt(clientsResult.rows[0].clients_actifs),
        inactifs: parseInt(clientsResult.rows[0].clients_inactifs),
        taux_activation: Math.round((parseInt(clientsResult.rows[0].clients_actifs) / parseInt(clientsResult.rows[0].total_clients)) * 100)
      },

      terrains: {
        utilises: parseInt(terrainsResult.rows[0].terrains_utilises),
        reservations_moyennes: parseFloat(terrainsResult.rows[0].reservations_moyennes),
        heures_moyennes: parseFloat(terrainsResult.rows[0].heures_moyennes),
        total_heures: parseFloat(terrainsResult.rows[0].total_heures)
      },

      temps_reel: {
        reservations_aujourdhui: parseInt(tempsReelResult.rows[0].reservations_aujourdhui),
        annulations_aujourdhui: parseInt(tempsReelResult.rows[0].annulations_aujourdhui),
        revenu_aujourdhui: parseFloat(tempsReelResult.rows[0].revenu_aujourdhui),
        terrains_occupes_aujourdhui: parseInt(tempsReelResult.rows[0].terrains_occupes_aujourdhui)
      },

      tendances: {
        evolution_reservations: parseFloat(tendancesResult.rows[0].evolution_reservations),
        evolution_revenus: parseFloat(tendancesResult.rows[0].evolution_revenus),
        reservations_courantes: parseInt(tendancesResult.rows[0].reservations_courantes),
        reservations_precedentes: parseInt(tendancesResult.rows[0].reservations_precedentes)
      }
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('❌ Erreur dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Statistiques détaillées par période
router.get('/periodiques', async (req, res) => {
  try {
    const { type = 'journalier', limite = 30 } = req.query;

    let sql = '';
    
    switch (type) {
      case 'journalier':
        sql = `
          SELECT 
            datereservation as date,
            TO_CHAR(datereservation, 'DD/MM') as date_formattee,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as revenu,
            COUNT(DISTINCT numeroterrain) as terrains_utilises,
            COUNT(DISTINCT idclient) as clients_uniques,
            ROUND(AVG(tarif), 2) as revenu_moyen
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '${limite} days'
          GROUP BY datereservation
          ORDER BY datereservation DESC
          LIMIT ${limite}
        `;
        break;

      case 'hebdomadaire':
        sql = `
          SELECT 
            DATE_TRUNC('week', datereservation) as date_debut_semaine,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as revenu,
            COUNT(DISTINCT numeroterrain) as terrains_utilises,
            COUNT(DISTINCT idclient) as clients_uniques,
            ROUND(AVG(tarif), 2) as revenu_moyen
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '${limite * 7} days'
          GROUP BY DATE_TRUNC('week', datereservation)
          ORDER BY date_debut_semaine DESC
          LIMIT ${limite}
        `;
        break;

      case 'mensuel':
      default:
        sql = `
          SELECT 
            DATE_TRUNC('month', datereservation) as date_debut_mois,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as revenu,
            COUNT(DISTINCT numeroterrain) as terrains_utilises,
            COUNT(DISTINCT idclient) as clients_uniques,
            ROUND(AVG(tarif), 2) as revenu_moyen
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '${limite * 30} days'
          GROUP BY DATE_TRUNC('month', datereservation)
          ORDER BY date_debut_mois DESC
          LIMIT ${limite}
        `;
    }

    const result = await db.query(sql);

    res.json({
      success: true,
      type: type,
      limite: parseInt(limite),
      data: result.rows,
      statistiques: {
        total_revenu: result.rows.reduce((sum, row) => sum + parseFloat(row.revenu), 0),
        total_reservations: result.rows.reduce((sum, row) => sum + parseInt(row.nb_reservations), 0),
        moyenne_revenu: Math.round(result.rows.reduce((sum, row) => sum + parseFloat(row.revenu), 0) / result.rows.length)
      }
    });

  } catch (error) {
    console.error('❌ Erreur stats périodiques:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🎯 Statistiques avancées KPI
router.get('/kpi', async (req, res) => {
  try {
    const [
      tauxOccupationResult,
      fideliteClientResult,
      performanceTerrainsResult,
      revenusRecurrentsResult
    ] = await Promise.all([

      // Taux d'occupation détaillé
      db.query(`
        WITH heures_total AS (
          SELECT 
            numeroterrain,
            COUNT(DISTINCT datereservation) * 12 as heures_disponibles
          FROM reservation 
          WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY numeroterrain
        ),
        heures_occupees AS (
          SELECT 
            numeroterrain,
            COALESCE(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0) as heures_utilisees
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY numeroterrain
        )
        SELECT 
          ROUND(AVG((ho.heures_utilisees / ht.heures_disponibles) * 100), 2) as taux_occupation_moyen,
          MAX((ho.heures_utilisees / ht.heures_disponibles) * 100) as taux_occupation_max,
          MIN((ho.heures_utilisees / ht.heures_disponibles) * 100) as taux_occupation_min
        FROM heures_total ht
        JOIN heures_occupees ho ON ht.numeroterrain = ho.numeroterrain
      `),

      // Fidélité clients
      db.query(`
        WITH reservations_par_client AS (
          SELECT 
            idclient,
            COUNT(*) as nb_reservations,
            COALESCE(SUM(tarif), 0) as total_depense
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation >= CURRENT_DATE - INTERVAL '90 days'
          GROUP BY idclient
        )
        SELECT 
          COUNT(*) as clients_actifs,
          ROUND(AVG(nb_reservations), 2) as reservations_moyennes,
          ROUND(AVG(total_depense), 2) as depense_moyenne,
          COUNT(CASE WHEN nb_reservations >= 5 THEN 1 END) as clients_fideles,
          COUNT(CASE WHEN nb_reservations = 1 THEN 1 END) as nouveaux_clients
        FROM reservations_par_client
      `),

      // Performance par terrain
      db.query(`
        SELECT 
          numeroterrain,
          typeterrain,
          COUNT(*) as nb_reservations,
          COALESCE(SUM(tarif), 0) as revenu_total,
          ROUND(AVG(tarif), 2) as revenu_moyen,
          ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM reservation WHERE statut = 'confirmée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days')), 2) as part_marche
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain, typeterrain
        ORDER BY revenu_total DESC
      `),

      // Revenus récurrents vs nouveaux
      db.query(`
        WITH clients_categories AS (
          SELECT 
            r.idclient,
            CASE 
              WHEN COUNT(r.*) > 1 THEN 'recurrent'
              ELSE 'nouveau'
            END as categorie,
            COUNT(r.*) as nb_reservations,
            COALESCE(SUM(r.tarif), 0) as montant_total
          FROM reservation r
          WHERE r.statut = 'confirmée'
            AND r.datereservation >= CURRENT_DATE - INTERVAL '60 days'
          GROUP BY r.idclient
        )
        SELECT 
          categorie,
          COUNT(*) as nb_clients,
          SUM(nb_reservations) as total_reservations,
          SUM(montant_total) as revenu_total,
          ROUND(AVG(montant_total), 2) as revenu_moyen_par_client
        FROM clients_categories
        GROUP BY categorie
      `)
    ]);

    const kpis = {
      occupation: {
        moyen: parseFloat(tauxOccupationResult.rows[0].taux_occupation_moyen) || 0,
        max: parseFloat(tauxOccupationResult.rows[0].taux_occupation_max) || 0,
        min: parseFloat(tauxOccupationResult.rows[0].taux_occupation_min) || 0
      },
      clients: {
        actifs: parseInt(fideliteClientResult.rows[0].clients_actifs),
        reservations_moyennes: parseFloat(fideliteClientResult.rows[0].reservations_moyennes),
        depense_moyenne: parseFloat(fideliteClientResult.rows[0].depense_moyenne),
        fideles: parseInt(fideliteClientResult.rows[0].clients_fideles),
        nouveaux: parseInt(fideliteClientResult.rows[0].nouveaux_clients),
        taux_fidelisation: Math.round((parseInt(fideliteClientResult.rows[0].clients_fideles) / parseInt(fideliteClientResult.rows[0].clients_actifs)) * 100) || 0
      },
      terrains: performanceTerrainsResult.rows,
      revenus: revenusRecurrentsResult.rows.reduce((acc, row) => {
        acc[row.categorie] = {
          nb_clients: parseInt(row.nb_clients),
          total_reservations: parseInt(row.total_reservations),
          revenu_total: parseFloat(row.revenu_total),
          revenu_moyen: parseFloat(row.revenu_moyen_par_client)
        };
        return acc;
      }, {})
    };

    res.json({
      success: true,
      data: kpis
    });

  } catch (error) {
    console.error('❌ Erreur KPI stats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

export default router;