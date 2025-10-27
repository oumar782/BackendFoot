// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 Statistiques globales pour le dashboard
router.get('/dashboard', async (req, res) => {
  try {
    // Récupérer les statistiques en parallèle pour plus de performance
    const [
      revenusMois,
      reservationsMois,
      clientsActifs,
      statsTempsReel,
      revenusAnnee,
      statsMoisPrecedent
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
        SELECT COUNT(DISTINCT email) as clients_actifs
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Statistiques temps réel
      db.query(`
        SELECT 
          COUNT(CASE WHEN datereservation = CURRENT_DATE THEN 1 END) as reservations_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'confirmée' THEN 1 END) as confirmes_aujourdhui,
          COUNT(CASE WHEN datereservation = CURRENT_DATE AND statut = 'annulée' THEN 1 END) as annules_aujourdhui
        FROM reservation
      `),
      
      // Revenus de l'année
      db.query(`
        SELECT COALESCE(SUM(tarif), 0) as revenus_annee
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE)
      `),
      
      // Stats du mois précédent pour les trends
      db.query(`
        SELECT 
          COALESCE(SUM(tarif), 0) as revenus_mois_precedent,
          COUNT(*) as reservations_mois_precedent,
          COUNT(DISTINCT email) as clients_mois_precedent
        FROM reservation 
        WHERE statut = 'confirmée'
        AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE - INTERVAL '1 month')
        AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE - INTERVAL '1 month')
      `)
    ]);

    const stats = {
      revenus_mois: parseFloat(revenusMois.rows[0]?.revenus_mois || 0),
      reservations_mois: parseInt(reservationsMois.rows[0]?.reservations_mois || 0),
      clients_actifs: parseInt(clientsActifs.rows[0]?.clients_actifs || 0),
      reservations_aujourdhui: parseInt(statsTempsReel.rows[0]?.reservations_aujourdhui || 0),
      confirmes_aujourdhui: parseInt(statsTempsReel.rows[0]?.confirmes_aujourdhui || 0),
      annules_aujourdhui: parseInt(statsTempsReel.rows[0]?.annules_aujourdhui || 0),
      revenus_annee: parseFloat(revenusAnnee.rows[0]?.revenus_annee || 0)
    };

    // Calcul des trends réels
    const trends = calculateRealTrends(stats, statsMoisPrecedent.rows[0]);

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
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months',
          DATE_TRUNC('month', CURRENT_DATE),
          '1 month'::interval
        )::date as mois
      )
      SELECT 
        TO_CHAR(ms.mois, 'YYYY-MM') as periode,
        TO_CHAR(ms.mois, 'Mon YYYY') as periode_affichage,
        COALESCE(SUM(r.tarif), 0) as revenus,
        COUNT(r.id) as reservations,
        COUNT(DISTINCT r.email) as clients_uniques
      FROM mois_series ms
      LEFT JOIN reservation r ON 
        DATE_TRUNC('month', r.datereservation) = ms.mois
        AND r.statut = 'confirmée'
      GROUP BY ms.mois
      ORDER BY ms.mois ASC
    `);

    // Filtrer pour ne renvoyer que les données réelles
    const dataReelle = result.rows.filter(row => 
      parseFloat(row.revenus) > 0 || parseInt(row.reservations) > 0
    );

    res.json({
      success: true,
      data: dataReelle,
      note: "Seules les périodes avec des données réelles sont affichées"
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
        typeterrain,
        COUNT(*) as total_reservations,
        COALESCE(SUM(tarif), 0) as revenus_generes,
        ROUND(AVG(tarif), 2) as revenu_moyen,
        COUNT(DISTINCT email) as clients_uniques,
        ROUND(
          (COUNT(*) * 100.0 / NULLIF(
            (SELECT COUNT(*) FROM reservation WHERE statut = 'confirmée' AND datereservation >= CURRENT_DATE - INTERVAL '30 days'),
            0
          )), 2
        ) as part_marche
      FROM reservation 
      WHERE statut = 'confirmée'
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY typeterrain
      ORDER BY revenus_generes DESC
    `);

    // Ne renvoyer que les terrains avec des réservations réelles
    const terrainsAvecDonnees = result.rows.filter(row => row.total_reservations > 0);

    res.json({
      success: true,
      data: terrainsAvecDonnees,
      note: terrainsAvecDonnees.length === 0 ? "Aucune donnée de performance disponible pour les 30 derniers jours" : null
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
      // Clients les plus fidèles (basé sur le nombre de réservations)
      db.query(`
        SELECT 
          email,
          nomclient,
          prenom,
          COUNT(id) as total_reservations,
          COALESCE(SUM(tarif), 0) as total_depense,
          MAX(datereservation) as derniere_reservation
        FROM reservation 
        WHERE statut = 'confirmée'
        GROUP BY email, nomclient, prenom
        HAVING COUNT(id) > 0
        ORDER BY total_reservations DESC
        LIMIT 10
      `),
      
      // Nouveaux clients du mois (première réservation ce mois-ci)
      db.query(`
        WITH premiers_achats AS (
          SELECT 
            email,
            nomclient,
            prenom,
            MIN(datereservation) as premiere_reservation
          FROM reservation 
          WHERE statut = 'confirmée'
          GROUP BY email, nomclient, prenom
        )
        SELECT 
          pa.email,
          pa.nomclient,
          pa.prenom,
          COUNT(r.id) as reservations_mois,
          COALESCE(SUM(r.tarif), 0) as total_depense_mois
        FROM premiers_achats pa
        JOIN reservation r ON pa.email = r.email
        WHERE EXTRACT(MONTH FROM pa.premiere_reservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM pa.premiere_reservation) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND r.statut = 'confirmée'
        GROUP BY pa.email, pa.nomclient, pa.prenom
        ORDER BY reservations_mois DESC
      `),
      
      // Stats générales clients
      db.query(`
        WITH stats_clients AS (
          SELECT 
            email,
            COUNT(*) as reservations_par_client,
            COALESCE(SUM(tarif), 0) as depense_totale
          FROM reservation 
          WHERE statut = 'confirmée'
          GROUP BY email
        )
        SELECT 
          COUNT(*) as total_clients,
          ROUND(AVG(reservations_par_client), 2) as reservations_moyennes,
          ROUND(AVG(depense_totale), 2) as depense_moyenne,
          MAX(reservations_par_client) as reservations_max,
          MIN(reservations_par_client) as reservations_min
        FROM stats_clients
      `)
    ]);

    const data = {
      clients_fideles: clientsFideles.rows,
      nouveaux_clients: nouveauxClients.rows,
      statistiques: statsReservations.rows[0] || {
        total_clients: 0,
        reservations_moyennes: 0,
        depense_moyenne: 0,
        reservations_max: 0,
        reservations_min: 0
      }
    };

    res.json({
      success: true,
      data,
      note: data.clients_fideles.length === 0 ? "Aucun client avec des réservations confirmées" : null
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

// 📅 Réservations par jour (pour les graphiques)
router.get('/reservations-par-jour', async (req, res) => {
  try {
    const { jours = 30 } = req.query;
    
    const result = await db.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '${parseInt(jours) - 1} days',
          CURRENT_DATE,
          '1 day'::interval
        )::date as date_jour
      )
      SELECT 
        ds.date_jour,
        TO_CHAR(ds.date_jour, 'DD/MM') as date_formattee,
        COUNT(r.id) as reservations_total,
        COUNT(CASE WHEN r.statut = 'confirmée' THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN r.statut = 'annulée' THEN 1 END) as reservations_annulees,
        COALESCE(SUM(CASE WHEN r.statut = 'confirmée' THEN r.tarif ELSE 0 END), 0) as revenus_jour
      FROM date_series ds
      LEFT JOIN reservation r ON ds.date_jour = r.datereservation
      GROUP BY ds.date_jour
      ORDER BY ds.date_jour ASC
    `);

    res.json({
      success: true,
      data: result.rows,
      periode: parseInt(jours)
    });
  } catch (error) {
    console.error('❌ Erreur reservations par jour:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});

// 🔮 Prévisions basées sur les données historiques réelles
router.get('/previsions', async (req, res) => {
  try {
    const { jours = 7 } = req.query;
    
    // Analyser les données historiques réelles
    const [historique, reservationsFutures] = await Promise.all([
      // Données historiques des 60 derniers jours
      db.query(`
        SELECT 
          datereservation,
          COUNT(*) as reservations_jour,
          COALESCE(SUM(tarif), 0) as revenus_jour
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE - INTERVAL '1 day'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `),
      
      // Réservations déjà confirmées pour les jours futurs
      db.query(`
        SELECT 
          datereservation,
          COUNT(*) as reservations_prevues,
          COALESCE(SUM(tarif), 0) as revenus_prevus
        FROM reservation 
        WHERE statut = 'confirmée'
          AND datereservation BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '${jours} days'
        GROUP BY datereservation
        ORDER BY datereservation ASC
      `)
    ]);

    // Calcul des moyennes basées sur l'historique réel
    const statsHistoriques = {
      reservations_moyennes: historique.rows.length > 0 ? 
        Math.round(historique.rows.reduce((sum, row) => sum + parseInt(row.reservations_jour), 0) / historique.rows.length) : 0,
      revenus_moyens: historique.rows.length > 0 ? 
        Math.round(historique.rows.reduce((sum, row) => sum + parseFloat(row.revenus_jour), 0) / historique.rows.length) : 0
    };

    const previsions = reservationsFutures.rows.map(row => ({
      date: row.datereservation,
      date_formattee: new Date(row.datereservation).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      reservations_prevues: parseInt(row.reservations_prevues),
      revenus_prevus: parseFloat(row.revenus_prevus),
      type: 'confirmee' // Réellement confirmée
    }));

    // Ajouter des prévisions basées sur la moyenne pour les jours sans réservations
    const aujourdhui = new Date();
    for (let i = 0; i < parseInt(jours); i++) {
      const date = new Date(aujourdhui);
      date.setDate(aujourdhui.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      const existeDeja = previsions.some(p => p.date.toISOString().split('T')[0] === dateStr);
      
      if (!existeDeja && statsHistoriques.reservations_moyennes > 0) {
        previsions.push({
          date: dateStr,
          date_formattee: date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
          reservations_prevues: Math.round(statsHistoriques.reservations_moyennes * 0.7), // Prévision prudente (70% de la moyenne)
          revenus_prevus: Math.round(statsHistoriques.revenus_moyens * 0.7),
          type: 'estimee' // Estimation basée sur l'historique
        });
      }
    }

    // Trier par date
    previsions.sort((a, b) => new Date(a.date) - new Date(b.date));

    const stats = {
      reservations_total_confirmees: previsions
        .filter(p => p.type === 'confirmee')
        .reduce((sum, p) => sum + p.reservations_prevues, 0),
      revenus_total_confirmees: previsions
        .filter(p => p.type === 'confirmee')
        .reduce((sum, p) => sum + p.revenus_prevus, 0),
      reservations_total_estimees: previsions
        .filter(p => p.type === 'estimee')
        .reduce((sum, p) => sum + p.reservations_prevues, 0),
      note: "Les prévisions incluent les réservations confirmées et des estimations basées sur l'historique réel"
    };

    res.json({
      success: true,
      data: previsions,
      statistiques: stats,
      historique: statsHistoriques,
      periode: parseInt(jours)
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

// Fonction utilitaire pour calculer les trends réels
function calculateRealTrends(currentStats, lastMonthStats) {
  if (!lastMonthStats) {
    return {
      revenus: { value: 0, isPositive: true, note: "Pas de données du mois précédent" },
      reservations: { value: 0, isPositive: true, note: "Pas de données du mois précédent" },
      clients: { value: 0, isPositive: true, note: "Pas de données du mois précédent" }
    };
  }

  const revenusMoisPrecedent = parseFloat(lastMonthStats.revenus_mois_precedent) || 0;
  const reservationsMoisPrecedent = parseInt(lastMonthStats.reservations_mois_precedent) || 0;
  const clientsMoisPrecedent = parseInt(lastMonthStats.clients_mois_precedent) || 0;

  return {
    revenus: {
      value: calculatePercentageChange(currentStats.revenus_mois, revenusMoisPrecedent),
      isPositive: currentStats.revenus_mois > revenusMoisPrecedent,
      note: revenusMoisPrecedent === 0 ? "Premier mois avec des revenus" : null
    },
    reservations: {
      value: calculatePercentageChange(currentStats.reservations_mois, reservationsMoisPrecedent),
      isPositive: currentStats.reservations_mois > reservationsMoisPrecedent,
      note: reservationsMoisPrecedent === 0 ? "Premier mois avec des réservations" : null
    },
    clients: {
      value: calculatePercentageChange(currentStats.clients_actifs, clientsMoisPrecedent),
      isPositive: currentStats.clients_actifs > clientsMoisPrecedent,
      note: clientsMoisPrecedent === 0 ? "Premier mois avec des clients" : null
    }
  };
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  const change = ((current - previous) / previous) * 100;
  return Math.round(change * 10) / 10; // Arrondir à 1 décimale
}

export default router;