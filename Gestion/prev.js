// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// Fonction utilitaire pour parser les valeurs en toute sécurité
const safeParse = (value, defaultValue = 0) => {
  if (value === null || value === undefined || value === '') return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    // Récupérer les statistiques en parallèle pour plus de performance
    const [
      revenusMois,
      reservationsMois,
      clientsActifs,
      tauxRemplissage,
      statsTempsReel,
      revenusAnnee
    ] = await Promise.all([
      // Revenus du mois actuel
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Réservations du mois
      db.query(`
        SELECT COUNT(*) as reservations_mois
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Clients actifs ce mois-ci
      db.query(`
        SELECT COUNT(DISTINCT idclient) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Taux de remplissage moyen du mois
      db.query(`
        SELECT 
          COALESCE(ROUND(
            (COUNT(*) * 100.0 / NULLIF(
              (SELECT COUNT(DISTINCT numeroterrain) * 30 
               FROM reservation 
               WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
              ), 0)
            ), 2
          ), 0) as taux_remplissage
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel
      db.query(`
        SELECT 
          COALESCE(COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END), 0) as reservations_aujourdhui,
          COALESCE(COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END), 0) as confirmes_aujourdhui,
          COALESCE(COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END), 0) as annules_aujourdhui
        FROM reservation
        WHERE datereservation = CURRENT_DATE
      `),
      
      // Revenus de l'année pour le trend
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_annee
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `)
    ]);

    // Extraction sécurisée des données avec valeurs par défaut
    const stats = {
      revenus_mois: safeParse(revenusMois.rows[0]?.revenus_mois),
      reservations_mois: safeParse(reservationsMois.rows[0]?.reservations_mois),
      clients_actifs: safeParse(clientsActifs.rows[0]?.clients_actifs),
      taux_remplissage: safeParse(tauxRemplissage.rows[0]?.taux_remplissage),
      reservations_aujourdhui: safeParse(statsTempsReel.rows[0]?.reservations_aujourdhui),
      confirmes_aujourdhui: safeParse(statsTempsReel.rows[0]?.confirmes_aujourdhui),
      annules_aujourdhui: safeParse(statsTempsReel.rows[0]?.annules_aujourdhui),
      revenus_annee: safeParse(revenusAnnee.rows[0]?.revenus_annee)
    };

    // Calcul des trends uniquement si des données existent
    const trends = await calculateTrends(stats);

    res.json({
      success: true,
      data: {
        ...stats,
        trends
      },
      last_updated: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur statistiques dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 📈 Évolution des revenus sur 12 mois
router.get('/evolution-revenus', async (req, res) => {
  try {
    const result = await db.query(`
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
        COALESCE(SUM(r.tarif), 0) as revenus,
        COALESCE(COUNT(r.numeroreservations), 0) as reservations,
        COALESCE(COUNT(DISTINCT r.idclient), 0) as clients_uniques
      FROM mois_series ms
      LEFT JOIN reservation r ON 
        EXTRACT(YEAR FROM r.datereservation) = EXTRACT(YEAR FROM ms.mois)
        AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM ms.mois)
        AND r.statut = 'confirmée'
      GROUP BY ms.mois
      ORDER BY ms.mois ASC
    `);

    // S'assurer que toutes les valeurs sont correctement formatées
    const safeData = result.rows.map(row => ({
      periode: row.periode || '',
      periode_affichage: row.periode_affichage || '',
      revenus: safeParse(row.revenus),
      reservations: safeParse(row.reservations),
      clients_uniques: safeParse(row.clients_uniques)
    }));

    res.json({
      success: true,
      data: safeData
    });
  } catch (error) {
    console.error('❌ Erreur évolution revenus:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🎯 Performance des terrains
router.get('/performance-terrains', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COALESCE(COUNT(*), 0) as total_reservations,
        COALESCE(SUM(tarif), 0) as revenus_generes,
        COALESCE(ROUND(AVG(tarif), 2), 0) as revenu_moyen,
        COALESCE(COUNT(DISTINCT idclient), 0) as clients_uniques,
        COALESCE(ROUND(
          (COUNT(*) * 100.0 / NULLIF(
            (SELECT COUNT(*) FROM reservation WHERE statut = 'confirmée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days')
            , 0)
          ), 2
        ), 0) as part_marche
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY revenus_generes DESC
    `);

    const safeData = result.rows.map(row => ({
      numeroterrain: row.numeroterrain || '',
      nomterrain: row.nomterrain || '',
      typeterrain: row.typeterrain || '',
      total_reservations: safeParse(row.total_reservations),
      revenus_generes: safeParse(row.revenus_generes),
      revenu_moyen: safeParse(row.revenu_moyen),
      clients_uniques: safeParse(row.clients_uniques),
      part_marche: safeParse(row.part_marche)
    }));

    res.json({
      success: true,
      data: safeData
    });
  } catch (error) {
    console.error('❌ Erreur performance terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 👥 Statistiques clients
router.get('/statistiques-clients', async (req, res) => {
  try {
    const [
      clientsFideles,
      nouveauxClients,
      statsReservations
    ] = await Promise.all([
      // Clients les plus fidèles
      db.query(`
        SELECT 
          c.idclient,
          COALESCE(c.nom, '') as nom,
          COALESCE(c.prenom, '') as prenom,
          COALESCE(c.email, '') as email,
          COALESCE(COUNT(r.numeroreservations), 0) as total_reservations,
          COALESCE(SUM(r.tarif), 0) as total_depense,
          MAX(r.datereservation) as derniere_reservation
        FROM clients c
        JOIN reservation r ON c.idclient = r.idclient
        WHERE r.statut = 'confirmée'
        GROUP BY c.idclient, c.nom, c.prenom, c.email
        ORDER BY total_reservations DESC
        LIMIT 10
      `),
      
      // Nouveaux clients du mois
      db.query(`
        SELECT 
          c.idclient,
          COALESCE(c.nom, '') as nom,
          COALESCE(c.prenom, '') as prenom,
          COALESCE(c.email, '') as email,
          COALESCE(c.telephone, '') as telephone,
          COALESCE(c.statut, '') as statut,
          COALESCE(COUNT(r.numeroreservations), 0) as reservations_mois
        FROM clients c
        LEFT JOIN reservation r ON c.idclient = r.idclient 
          AND EXTRACT(MONTH FROM r.datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND r.statut = 'confirmée'
        WHERE c.idclient IN (
          SELECT DISTINCT idclient 
          FROM reservation 
          WHERE EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        )
        GROUP BY c.idclient, c.nom, c.prenom, c.email, c.telephone, c.statut
        ORDER BY reservations_mois DESC
      `),
      
      // Stats générales clients
      db.query(`
        SELECT 
          COALESCE(COUNT(DISTINCT idclient), 0) as total_clients,
          COALESCE(COUNT(DISTINCT CASE WHEN statut = 'actif' THEN idclient END), 0) as clients_actifs,
          COALESCE(COUNT(DISTINCT CASE WHEN statut = 'inactif' THEN idclient END), 0) as clients_inactifs,
          COALESCE(ROUND(AVG(reservations_par_client), 2), 0) as reservations_moyennes
        FROM (
          SELECT 
            idclient,
            statut,
            COUNT(*) as reservations_par_client
          FROM reservation 
          WHERE statut = 'confirmée'
          GROUP BY idclient, statut
        ) stats_clients
      `)
    ]);

    // Sécurisation des données clients
    const safeClientsFideles = clientsFideles.rows.map(client => ({
      idclient: client.idclient || '',
      nom: client.nom || '',
      prenom: client.prenom || '',
      email: client.email || '',
      total_reservations: safeParse(client.total_reservations),
      total_depense: safeParse(client.total_depense),
      derniere_reservation: client.derniere_reservation || null
    }));

    const safeNouveauxClients = nouveauxClients.rows.map(client => ({
      idclient: client.idclient || '',
      nom: client.nom || '',
      prenom: client.prenom || '',
      email: client.email || '',
      telephone: client.telephone || '',
      statut: client.statut || '',
      reservations_mois: safeParse(client.reservations_mois)
    }));

    const safeStats = statsReservations.rows[0] ? {
      total_clients: safeParse(statsReservations.rows[0].total_clients),
      clients_actifs: safeParse(statsReservations.rows[0].clients_actifs),
      clients_inactifs: safeParse(statsReservations.rows[0].clients_inactifs),
      reservations_moyennes: safeParse(statsReservations.rows[0].reservations_moyennes)
    } : {
      total_clients: 0,
      clients_actifs: 0,
      clients_inactifs: 0,
      reservations_moyennes: 0
    };

    res.json({
      success: true,
      data: {
        clients_fideles: safeClientsFideles,
        nouveaux_clients: safeNouveauxClients,
        statistiques: safeStats
      }
    });
  } catch (error) {
    console.error('❌ Erreur statistiques clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions et tendances
router.get('/previsions-tendances', async (req, res) => {
  try {
    const { periode = '30' } = req.query;
    
    const result = await db.query(`
      WITH reservations_futures AS (
        SELECT 
          datereservation,
          COALESCE(COUNT(*), 0) as reservations_prevues,
          COALESCE(SUM(tarif), 0) as revenus_prevus,
          COALESCE(COUNT(DISTINCT numeroterrain), 0) as terrains_occupes
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${periode} days'
        GROUP BY datereservation
      ),
      stats_historiques AS (
        SELECT 
          COALESCE(ROUND(AVG(reservations_jour), 2), 0) as reservations_moyennes,
          COALESCE(ROUND(AVG(revenus_jour), 2), 0) as revenus_moyens
        FROM (
          SELECT 
            datereservation,
            COALESCE(COUNT(*), 0) as reservations_jour,
            COALESCE(SUM(tarif), 0) as revenus_jour
          FROM reservation 
          WHERE statut = 'confirmée'
            AND datereservation BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE - INTERVAL '1 day'
          GROUP BY datereservation
        ) historique
      )
      SELECT 
        rf.datereservation,
        TO_CHAR(rf.datereservation, 'DD/MM') as date_formattee,
        rf.reservations_prevues,
        rf.revenus_prevus,
        rf.terrains_occupes,
        sh.reservations_moyennes,
        sh.revenus_moyens,
        CASE 
          WHEN rf.reservations_prevues > sh.reservations_moyennes THEN 'supérieur'
          WHEN rf.reservations_prevues < sh.reservations_moyennes THEN 'inférieur'
          ELSE 'identique'
        END as tendance_reservations,
        CASE 
          WHEN rf.revenus_prevus > sh.revenus_moyens THEN 'supérieur'
          WHEN rf.revenus_prevus < sh.revenus_moyens THEN 'inférieur'
          ELSE 'identique'
        END as tendance_revenus
      FROM reservations_futures rf
      CROSS JOIN stats_historiques sh
      ORDER BY rf.datereservation ASC
    `);

    // Sécurisation des données de prévisions
    const safeData = result.rows.map(row => ({
      datereservation: row.datereservation || null,
      date_formattee: row.date_formattee || '',
      reservations_prevues: safeParse(row.reservations_prevues),
      revenus_prevus: safeParse(row.revenus_prevus),
      terrains_occupes: safeParse(row.terrains_occupes),
      reservations_moyennes: safeParse(row.reservations_moyennes),
      revenus_moyens: safeParse(row.revenus_moyens),
      tendance_reservations: row.tendance_reservations || 'identique',
      tendance_revenus: row.tendance_revenus || 'identique'
    }));

    // Calcul des totaux et moyennes sécurisé
    const stats = {
      reservations_total: safeData.reduce((sum, row) => sum + row.reservations_prevues, 0),
      revenus_total: safeData.reduce((sum, row) => sum + row.revenus_prevus, 0),
      jours_avec_reservations: safeData.length,
      revenu_moyen_par_jour: safeData.length > 0 ? 
        Math.round(safeData.reduce((sum, row) => sum + row.revenus_prevus, 0) / safeData.length) : 0,
      jours_superieurs_moyenne: safeData.filter(row => row.tendance_revenus === 'supérieur').length
    };

    res.json({
      success: true,
      data: safeData,
      statistiques: stats,
      periode_analyse: parseInt(periode)
    });
  } catch (error) {
    console.error('❌ Erreur prévisions:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// Fonction utilitaire pour calculer les trends de manière sécurisée
async function calculateTrends(currentStats) {
  try {
    const lastMonthStats = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as revenus_mois_dernier,
        COALESCE(COUNT(*), 0) as reservations_mois_dernier
      FROM reservation 
      WHERE statut = 'confirmée'
      AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
      AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
    `);

    const lastMonth = lastMonthStats.rows[0];
    
    // Calcul sécurisé des pourcentages
    const revenusLastMonth = safeParse(lastMonth?.revenus_mois_dernier);
    const reservationsLastMonth = safeParse(lastMonth?.reservations_mois_dernier);

    const trends = {
      revenus: {
        value: calculatePercentageChange(currentStats.revenus_mois, revenusLastMonth),
        isPositive: currentStats.revenus_mois > revenusLastMonth
      },
      reservations: {
        value: calculatePercentageChange(currentStats.reservations_mois, reservationsLastMonth),
        isPositive: currentStats.reservations_mois > reservationsLastMonth
      },
      clients: {
        value: 0, // Valeur par défaut à 0 si pas de calcul spécifique
        isPositive: false
      },
      remplissage: {
        value: 0, // Valeur par défaut à 0
        isPositive: currentStats.taux_remplissage > 0
      }
    };

    return trends;
  } catch (error) {
    console.error('Erreur calcul trends:', error);
    // Retourner des trends neutres en cas d'erreur
    return {
      revenus: { value: 0, isPositive: false },
      reservations: { value: 0, isPositive: false },
      clients: { value: 0, isPositive: false },
      remplissage: { value: 0, isPositive: false }
    };
  }
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  const change = ((current - previous) / previous) * 100;
  return Math.round(change);
}

export default router;