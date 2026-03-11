// routes/stats.js
import express from 'express';
import db from '../db.js';

const router = express.Router();

// ============================================
// MIDDLEWARE DE VÉRIFICATION BDD
// ============================================
const checkDatabase = async (req, res, next) => {
  try {
    if (!db || typeof db.query !== 'function') {
      console.error('❌ Connexion BDD non disponible');
      return res.status(503).json({
        success: false,
        message: 'Service de base de données indisponible',
        error: 'Database connection failed'
      });
    }
    
    // Test simple de connexion
    await db.query('SELECT 1');
    console.log('✅ Connexion BDD OK');
    next();
  } catch (error) {
    console.error('❌ Erreur de connexion BDD:', error);
    return res.status(503).json({
      success: false,
      message: 'Service de base de données indisponible',
      error: error.message
    });
  }
};

router.use(checkDatabase);

// ============================================
// ROUTE 1: STATISTIQUES GLOBALES (Votre première requête)
// ============================================
router.get('/stats-globales', async (req, res) => {
  try {
    console.log('📡 Récupération des statistiques globales...');
    
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
        COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as total_attente,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as pourcentage_annulations,
        ROUND(COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as pourcentage_confirmations
      FROM reservation
    `);

    res.status(200).json({
      success: true,
      data: result.rows[0] || {
        total_reservations: 0,
        total_annulations: 0,
        total_confirmations: 0,
        total_attente: 0,
        pourcentage_annulations: 0,
        pourcentage_confirmations: 0
      },
      message: 'Statistiques globales récupérées avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur stats globales:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des stats globales',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 2: RÉPARTITION PAR STATUT (Votre deuxième requête)
// ============================================
router.get('/repartition-statuts', async (req, res) => {
  try {
    console.log('📡 Récupération de la répartition par statut...');
    
    const result = await db.query(`
      SELECT 
        statut, 
        COUNT(*) as nombre,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM reservation), 2) as pourcentage
      FROM reservation 
      GROUP BY statut
      ORDER BY nombre DESC
    `);

    // Statistiques supplémentaires
    const total = result.rows.reduce((acc, row) => acc + parseInt(row.nombre), 0);

    res.status(200).json({
      success: true,
      data: {
        repartition: result.rows,
        total_reservations: total,
        statuts_uniques: result.rows.length
      },
      message: 'Répartition par statut récupérée avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur répartition statuts:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la répartition',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 3: CLIENTS AVEC LE PLUS D'ANNULATIONS (Votre troisième requête)
// ============================================
router.get('/top-clients-nuisibles', async (req, res) => {
  try {
    console.log('📡 Recherche des clients nuisibles...');
    
    const result = await db.query(`
      SELECT 
        COALESCE(nomclient, 'Client inconnu') as nomclient,
        COALESCE(prenom, '') as prenom,
        COALESCE(email, 'Non renseigné') as email,
        COALESCE(telephone, 'Non renseigné') as telephone,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes,
        COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as montant_generes
      FROM reservation
      GROUP BY nomclient, prenom, email, telephone
      HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
      ORDER BY annulations DESC, taux_annulation DESC
      LIMIT 50
    `);

    // Statistiques supplémentaires
    const stats = {
      total_clients_analyses: result.rows.length,
      total_annulations: result.rows.reduce((acc, r) => acc + parseInt(r.annulations), 0),
      pertes_totales: result.rows.reduce((acc, r) => acc + parseFloat(r.montant_pertes), 0),
      clients_tres_risques: result.rows.filter(r => r.taux_annulation >= 50).length,
      clients_moyennement_risques: result.rows.filter(r => r.taux_annulation >= 25 && r.taux_annulation < 50).length
    };

    res.status(200).json({
      success: true,
      data: result.rows,
      statistiques: stats,
      message: 'Top clients nuisibles récupéré avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur top clients nuisibles:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la recherche des clients nuisibles',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 4: TERRAINS LES PLUS AFFECTÉS (Votre quatrième requête)
// ============================================
router.get('/top-terrains-affectes', async (req, res) => {
  try {
    console.log('📡 Analyse des terrains affectés...');
    
    const result = await db.query(`
      SELECT 
        numeroterrain,
        COALESCE(nomterrain, 'Terrain inconnu') as nomterrain,
        COALESCE(typeterrain, 'Non spécifié') as typeterrain,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus,
        COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as revenus_generes,
        ROUND(
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) * 100.0 / 
          NULLIF(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0), 2
        ) as ratio_pertes
      FROM reservation
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY annulations DESC, taux_annulation DESC
    `);

    // Calcul des totaux
    const totalAnnulations = result.rows.reduce((acc, r) => acc + parseInt(r.annulations), 0);
    const totalPertes = result.rows.reduce((acc, r) => acc + parseFloat(r.revenus_perdus), 0);

    res.status(200).json({
      success: true,
      data: result.rows,
      statistiques: {
        total_terrains_analyses: result.rows.length,
        total_annulations_terrains: totalAnnulations,
        pertes_financieres_totales: totalPertes,
        terrain_plus_risque: result.rows[0] || null,
        terrains_critiques: result.rows.filter(r => r.taux_annulation > 30).length,
        perte_moyenne_par_terrain: result.rows.length ? Math.round(totalPertes / result.rows.length) : 0
      },
      message: 'Analyse des terrains terminée avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur analyse terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des terrains',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 5: ANNULATIONS PAR MOIS (Votre cinquième requête)
// ============================================
router.get('/annulations-par-mois', async (req, res) => {
  try {
    console.log('📡 Analyse des annulations par mois...');
    
    const result = await db.query(`
      SELECT 
        EXTRACT(YEAR FROM datereservation) as annee,
        EXTRACT(MONTH FROM datereservation) as mois,
        TO_CHAR(datereservation, 'Month YYYY') as mois_nom,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes_mensuelles
      FROM reservation
      GROUP BY EXTRACT(YEAR FROM datereservation), EXTRACT(MONTH FROM datereservation), TO_CHAR(datereservation, 'Month YYYY')
      ORDER BY annee DESC, mois DESC
    `);

    // Calcul des tendances
    const tendances = calculerTendancesMensuelles(result.rows);

    res.status(200).json({
      success: true,
      data: result.rows,
      tendances: tendances,
      resume: {
        total_mois_analyses: result.rows.length,
        mois_plus_annulations: result.rows[0] || null,
        moyenne_annulations_mensuelles: result.rows.length ? 
          Math.round(result.rows.reduce((acc, r) => acc + parseInt(r.annulations), 0) / result.rows.length) : 0
      },
      message: 'Analyse mensuelle terminée avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur analyse mensuelle:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse mensuelle',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 6: ANNULATIONS PAR JOUR DE SEMAINE (Votre sixième requête)
// ============================================
router.get('/annulations-par-jour', async (req, res) => {
  try {
    console.log('📡 Analyse des annulations par jour...');
    
    const result = await db.query(`
      SELECT 
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as numero_jour,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        COUNT(*) as total_reservations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes
      FROM reservation
      GROUP BY TO_CHAR(datereservation, 'Day'), EXTRACT(DOW FROM datereservation)
      ORDER BY numero_jour
    `);

    // Analyse weekend vs semaine
    const weekend = result.rows.filter(j => [0, 6].includes(parseInt(j.numero_jour)));
    const semaine = result.rows.filter(j => ![0, 6].includes(parseInt(j.numero_jour)));

    const statsWeekend = {
      annulations: weekend.reduce((acc, j) => acc + parseInt(j.annulations), 0),
      total: weekend.reduce((acc, j) => acc + parseInt(j.total_reservations), 0),
      pertes: weekend.reduce((acc, j) => acc + parseFloat(j.pertes), 0)
    };

    const statsSemaine = {
      annulations: semaine.reduce((acc, j) => acc + parseInt(j.annulations), 0),
      total: semaine.reduce((acc, j) => acc + parseInt(j.total_reservations), 0),
      pertes: semaine.reduce((acc, j) => acc + parseFloat(j.pertes), 0)
    };

    res.status(200).json({
      success: true,
      data: result.rows,
      analyse: {
        weekend: {
          ...statsWeekend,
          taux_moyen: statsWeekend.total ? (statsWeekend.annulations / statsWeekend.total * 100).toFixed(2) : 0
        },
        semaine: {
          ...statsSemaine,
          taux_moyen: statsSemaine.total ? (statsSemaine.annulations / statsSemaine.total * 100).toFixed(2) : 0
        },
        comparaison: {
          weekend_plus_risque: statsWeekend.taux_moyen > statsSemaine.taux_moyen,
          difference: (Math.abs(statsWeekend.taux_moyen - statsSemaine.taux_moyen)).toFixed(2) + '%'
        }
      },
      message: 'Analyse par jour terminée avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur analyse par jour:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse par jour',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 7: ANNULATIONS FUTURES (Votre septième requête)
// ============================================
router.get('/annulations-futures', async (req, res) => {
  try {
    console.log('📡 Récupération des annulations futures...');
    
    const result = await db.query(`
      SELECT 
        datereservation,
        TO_CHAR(datereservation, 'DD/MM/YYYY HH24:MI') as date_formattee,
        TO_CHAR(datereservation, 'Day DD/MM') as jour_formatte,
        COALESCE(nomclient, 'Client inconnu') as nomclient,
        COALESCE(prenom, '') as prenom,
        tarif,
        numeroterrain,
        COALESCE(nomterrain, 'Terrain inconnu') as nomterrain,
        email,
        telephone,
        EXTRACT(DAY FROM (datereservation - CURRENT_DATE)) as jours_restants
      FROM reservation
      WHERE statut = 'confirmée' 
        AND datereservation > CURRENT_DATE
      ORDER BY datereservation ASC
    `);

    // Statistiques
    const totalRevenusPrevus = result.rows.reduce((acc, r) => acc + parseFloat(r.tarif || 0), 0);
    const parJours = result.rows.reduce((acc, r) => {
      const date = r.date_formattee.split(' ')[0];
      if (!acc[date]) acc[date] = { count: 0, montant: 0 };
      acc[date].count++;
      acc[date].montant += parseFloat(r.tarif || 0);
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        reservations_futures: result.rows,
        statistiques: {
          total: result.rows.length,
          revenus_prevus: totalRevenusPrevus,
          jours_distincts: Object.keys(parJours).length,
          moyenne_par_jour: Object.keys(parJours).length ? Math.round(totalRevenusPrevus / Object.keys(parJours).length) : 0,
          jours_plus_charges: Object.entries(parJours)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 3)
            .map(([date, stats]) => ({ date, ...stats }))
        }
      },
      message: 'Réservations futures récupérées avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur annulations futures:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des annulations futures',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 8: PERTES FINANCIÈRES TOTALES (Votre huitième requête)
// ============================================
router.get('/pertes-financieres', async (req, res) => {
  try {
    console.log('📡 Calcul des pertes financières...');
    
    const result = await db.query(`
      SELECT 
        COALESCE(SUM(tarif), 0) as pertes_totales,
        COUNT(*) as nombre_annulations,
        ROUND(AVG(tarif), 2) as perte_moyenne,
        MIN(tarif) as perte_minimum,
        MAX(tarif) as perte_maximum,
        SUM(CASE WHEN tarif > 100 THEN 1 ELSE 0 END) as annulations_cout_eleve,
        SUM(CASE WHEN tarif < 50 THEN 1 ELSE 0 END) as annulations_cout_faible
      FROM reservation
      WHERE statut = 'annulée'
    `);

    // Analyse par période
    const parPeriode = await db.query(`
      SELECT 
        CASE 
          WHEN datereservation >= CURRENT_DATE - INTERVAL '7 days' THEN '7_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '30 days' THEN '30_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '90 days' THEN '90_derniers_jours'
          ELSE 'plus_ancien'
        END as periode,
        COALESCE(SUM(tarif), 0) as pertes,
        COUNT(*) as nombre
      FROM reservation
      WHERE statut = 'annulée'
      GROUP BY 
        CASE 
          WHEN datereservation >= CURRENT_DATE - INTERVAL '7 days' THEN '7_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '30 days' THEN '30_derniers_jours'
          WHEN datereservation >= CURRENT_DATE - INTERVAL '90 days' THEN '90_derniers_jours'
          ELSE 'plus_ancien'
        END
    `);

    res.status(200).json({
      success: true,
      data: {
        global: result.rows[0] || {
          pertes_totales: 0,
          nombre_annulations: 0,
          perte_moyenne: 0
        },
        analyse_periode: parPeriode.rows,
        projections: {
          pertes_annuelles_projetees: (result.rows[0]?.pertes_totales / 365 * 365).toFixed(2),
          economie_potentielle_10pc: (result.rows[0]?.pertes_totales * 0.1).toFixed(2)
        }
      },
      message: 'Analyse financière terminée avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur pertes financières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des pertes financières',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 9: IDENTIFICATION CLIENTS À RISQUE (Votre neuvième requête)
// ============================================
router.get('/clients-risque', async (req, res) => {
  try {
    console.log('📡 Identification des clients à risque...');
    
    const result = await db.query(`
      SELECT 
        COALESCE(nomclient, 'Client inconnu') as nomclient,
        COALESCE(prenom, '') as prenom,
        COALESCE(email, 'Non renseigné') as email,
        COALESCE(telephone, 'Non renseigné') as telephone,
        COUNT(*) as total_reservations,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
        ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
        COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes,
        COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as montant_generes,
        CASE 
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 50 THEN 'CRITIQUE'
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) BETWEEN 25 AND 49.99 THEN 'MODÉRÉ'
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) BETWEEN 10 AND 24.99 THEN 'FAIBLE'
          ELSE 'FIABLE' 
        END as niveau_risque,
        CASE 
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 50 THEN '🔴 ACTION URGENTE'
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 25 THEN '🟠 SURVEILLANCE'
          WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 10 THEN '🟡 ATTENTION'
          ELSE '🟢 OK'
        END as indicateur
      FROM reservation
      GROUP BY nomclient, prenom, email, telephone
      HAVING COUNT(*) >= 2
      ORDER BY taux_annulation DESC, total_annulations DESC
    `);

    // Statistiques par niveau de risque
    const statsRisque = {
      critique: result.rows.filter(r => r.niveau_risque === 'CRITIQUE').length,
      modere: result.rows.filter(r => r.niveau_risque === 'MODÉRÉ').length,
      faible: result.rows.filter(r => r.niveau_risque === 'FAIBLE').length,
      fiable: result.rows.filter(r => r.niveau_risque === 'FIABLE').length
    };

    // Impact financier par catégorie
    const impactFinancier = {
      critique: result.rows
        .filter(r => r.niveau_risque === 'CRITIQUE')
        .reduce((acc, r) => acc + parseFloat(r.montant_pertes), 0),
      modere: result.rows
        .filter(r => r.niveau_risque === 'MODÉRÉ')
        .reduce((acc, r) => acc + parseFloat(r.montant_pertes), 0),
      faible: result.rows
        .filter(r => r.niveau_risque === 'FAIBLE')
        .reduce((acc, r) => acc + parseFloat(r.montant_pertes), 0)
    };

    res.status(200).json({
      success: true,
      data: result.rows,
      analyse_risque: {
        repartition: statsRisque,
        impact_financier: impactFinancier,
        total_analyses: result.rows.length,
        pourcentage_critique: result.rows.length ? (statsRisque.critique / result.rows.length * 100).toFixed(2) : 0
      },
      actions_recommandees: genererActionsRecommandees(statsRisque, impactFinancier),
      message: 'Analyse des risques clients terminée'
    });

  } catch (error) {
    console.error('❌ Erreur identification risques:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'identification des risques',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 10: DASHBOARD COMPLET (Toutes les stats ensemble)
// ============================================
router.get('/dashboard-complet', async (req, res) => {
  try {
    console.log('📡 Génération du dashboard complet...');
    
    // Exécuter toutes les requêtes en parallèle
    const [
      statsGlobales,
      repartitionStatuts,
      topClients,
      topTerrains,
      annulationsMensuelles,
      annulationsJournalieres,
      pertesFinancieres,
      clientsRisque
    ] = await Promise.all([
      // 1. Stats globales
      db.query(`
        SELECT 
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as total_confirmations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_annulation_global
        FROM reservation
      `),

      // 2. Répartition par statut
      db.query(`
        SELECT 
          statut, 
          COUNT(*) as nombre,
          ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM reservation), 2) as pourcentage
        FROM reservation 
        GROUP BY statut
        ORDER BY nombre DESC
      `),

      // 3. Top 5 clients nuisibles
      db.query(`
        SELECT 
          nomclient,
          prenom,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation
        FROM reservation
        GROUP BY nomclient, prenom
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY annulations DESC
        LIMIT 5
      `),

      // 4. Top 5 terrains affectés
      db.query(`
        SELECT 
          nomterrain,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation
        FROM reservation
        GROUP BY nomterrain
        ORDER BY annulations DESC
        LIMIT 5
      `),

      // 5. Évolution mensuelle (6 derniers mois)
      db.query(`
        SELECT 
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Mon YYYY') as mois,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', datereservation)
        ORDER BY DATE_TRUNC('month', datereservation) DESC
      `),

      // 6. Annulations aujourd'hui
      db.query(`
        SELECT 
          COUNT(CASE WHEN statut = 'annulée' AND DATE(datereservation) = CURRENT_DATE THEN 1 END) as annulations_aujourdhui,
          COUNT(CASE WHEN statut = 'confirmée' AND DATE(datereservation) = CURRENT_DATE THEN 1 END) as confirmations_aujourdhui
        FROM reservation
        WHERE DATE(datereservation) = CURRENT_DATE
      `),

      // 7. Pertes financières
      db.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes_totales,
          AVG(CASE WHEN statut = 'annulée' THEN tarif END) as perte_moyenne
        FROM reservation
      `),

      // 8. Clients à risque (limité)
      db.query(`
        SELECT 
          nomclient,
          prenom,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
          CASE 
            WHEN COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 50 THEN 'CRITIQUE'
            ELSE 'À SURVEILLER'
          END as niveau
        FROM reservation
        GROUP BY nomclient, prenom
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*) >= 30
        ORDER BY taux_annulation DESC
        LIMIT 5
      `)
    ]);

    // Construction de la réponse
    const dashboard = {
      resume: statsGlobales.rows[0] || {},
      repartition: repartitionStatuts.rows,
      aujourd_hui: annulationsJournalieres.rows[0] || { annulations_aujourdhui: 0, confirmations_aujourdhui: 0 },
      top_clients: topClients.rows,
      top_terrains: topTerrains.rows,
      evolution: annulationsMensuelles.rows,
      financier: pertesFinancieres.rows[0] || { pertes_totales: 0, perte_moyenne: 0 },
      clients_risque: clientsRisque.rows,
      alertes: genererAlertes({
        stats: statsGlobales.rows[0],
        aujourdhui: annulationsJournalieres.rows[0],
        clients: clientsRisque.rows
      })
    };

    res.status(200).json({
      success: true,
      data: dashboard,
      generated_at: new Date().toISOString(),
      message: 'Dashboard complet généré avec succès'
    });

  } catch (error) {
    console.error('❌ Erreur dashboard complet:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du dashboard',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 11: STATISTIQUES AVANCÉES (Analyse approfondie)
// ============================================
router.get('/statistiques-avancees', async (req, res) => {
  try {
    console.log('📡 Calcul des statistiques avancées...');
    
    const result = await db.query(`
      WITH stats_globales AS (
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          COUNT(CASE WHEN statut = 'confirmée' THEN 1 END) as confirmations,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as pertes,
          COALESCE(SUM(CASE WHEN statut = 'confirmée' THEN tarif ELSE 0 END), 0) as revenus
        FROM reservation
      ),
      stats_clients AS (
        SELECT 
          COUNT(DISTINCT nomclient || COALESCE(prenom, '')) as clients_actifs,
          COUNT(DISTINCT CASE WHEN statut = 'annulée' THEN nomclient || COALESCE(prenom, '') END) as clients_annulateurs
        FROM reservation
      ),
      stats_quotidiennes AS (
        SELECT 
          AVG(annulations_par_jour) as moy_annulations_quotidiennes
        FROM (
          SELECT 
            DATE(datereservation) as jour,
            COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations_par_jour
          FROM reservation
          GROUP BY DATE(datereservation)
        ) subq
      )
      SELECT 
        sg.*,
        sc.*,
        sq.moy_annulations_quotidiennes,
        ROUND(sg.annulations * 100.0 / NULLIF(sg.total, 0), 2) as taux_annulation,
        ROUND(sg.pertes * 100.0 / NULLIF(sg.revenus + sg.pertes, 0), 2) as impact_financier,
        ROUND(sg.pertes * 1.0 / NULLIF(sg.annulations, 0), 2) as cout_moyen_annulation
      FROM stats_globales sg
      CROSS JOIN stats_clients sc
      CROSS JOIN stats_quotidiennes sq
    `);

    res.status(200).json({
      success: true,
      data: result.rows[0] || {},
      analyses_complementaires: {
        efficacite: calculerEfficacite(result.rows[0]),
        recommandations: genererRecommandationsAvancees(result.rows[0])
      },
      message: 'Statistiques avancées calculées'
    });

  } catch (error) {
    console.error('❌ Erreur stats avancées:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des stats avancées',
      error: error.message
    });
  }
});

// ============================================
// ROUTE 12: EXPORT DES DONNÉES (Format CSV/JSON)
// ============================================
router.get('/export-donnees', async (req, res) => {
  try {
    const { format = 'json', type = 'complet' } = req.query;

    let donnees = {};

    if (type === 'complet' || type === 'annulations') {
      const annulations = await db.query(`
        SELECT 
          numeroreservations,
          nomclient,
          prenom,
          email,
          telephone,
          datereservation,
          tarif,
          numeroterrain,
          nomterrain,
          typeterrain,
          statut
        FROM reservation
        WHERE statut = 'annulée'
        ORDER BY datereservation DESC
      `);
      donnees.annulations = annulations.rows;
    }

    if (type === 'complet' || type === 'clients') {
      const clients = await db.query(`
        SELECT 
          nomclient,
          prenom,
          email,
          telephone,
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as total_annulations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as montant_pertes
        FROM reservation
        GROUP BY nomclient, prenom, email, telephone
        HAVING COUNT(CASE WHEN statut = 'annulée' THEN 1 END) > 0
        ORDER BY total_annulations DESC
      `);
      donnees.clients = clients.rows;
    }

    if (type === 'complet' || type === 'terrains') {
      const terrains = await db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          typeterrain,
          COUNT(*) as total_reservations,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
          ROUND(COUNT(CASE WHEN statut = 'annulée' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_annulation,
          COALESCE(SUM(CASE WHEN statut = 'annulée' THEN tarif ELSE 0 END), 0) as revenus_perdus
        FROM reservation
        GROUP BY numeroterrain, nomterrain, typeterrain
        ORDER BY annulations DESC
      `);
      donnees.terrains = terrains.rows;
    }

    if (format === 'json') {
      res.status(200).json({
        success: true,
        data: donnees,
        export_date: new Date().toISOString(),
        type_export: type,
        nombre_enregistrements: Object.keys(donnees).reduce((acc, key) => acc + donnees[key].length, 0)
      });
    } else {
      // Pour format CSV, on pourrait générer un CSV ici
      res.status(200).json({
        success: true,
        message: 'Format CSV bientôt disponible',
        data: donnees
      });
    }

  } catch (error) {
    console.error('❌ Erreur export données:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'export',
      error: error.message
    });
  }
});

// ============================================
// ROUTE DE TEST (Vérification API)
// ============================================
router.get('/test', async (req, res) => {
  try {
    // Test de connexion
    const testQuery = await db.query('SELECT COUNT(*) as total FROM reservation');
    
    // Liste de toutes les routes disponibles
    const routes = [
      { path: '/stats-globales', description: 'Statistiques globales' },
      { path: '/repartition-statuts', description: 'Répartition par statut' },
      { path: '/top-clients-nuisibles', description: 'Top clients nuisibles' },
      { path: '/top-terrains-affectes', description: 'Top terrains affectés' },
      { path: '/annulations-par-mois', description: 'Annulations par mois' },
      { path: '/annulations-par-jour', description: 'Annulations par jour de semaine' },
      { path: '/annulations-futures', description: 'Réservations futures' },
      { path: '/pertes-financieres', description: 'Pertes financières' },
      { path: '/clients-risque', description: 'Clients à risque' },
      { path: '/dashboard-complet', description: 'Dashboard complet' },
      { path: '/statistiques-avancees', description: 'Statistiques avancées' },
      { path: '/export-donnees', description: 'Export des données' },
      { path: '/test', description: 'Test API' }
    ];

    res.status(200).json({
      success: true,
      message: '✅ API STATS fonctionne parfaitement !',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        total_reservations: testQuery.rows[0]?.total || 0,
        status: 'OK'
      },
      routes_disponibles: routes,
      documentation: 'Utilisez les endpoints ci-dessus pour récupérer vos données'
    });

  } catch (error) {
    res.status(200).json({
      success: true,
      message: '⚠️ API STATS fonctionne (problème BDD)',
      timestamp: new Date().toISOString(),
      database: {
        connected: false,
        error: error.message,
        status: 'ERREUR'
      },
      routes_disponibles: 'Toutes les routes sont disponibles mais la BDD est inaccessible'
    });
  }
});

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

function calculerTendancesMensuelles(donneesMensuelles) {
  if (!donneesMensuelles || donneesMensuelles.length < 2) {
    return { message: "Pas assez de données pour calculer les tendances" };
  }

  const dernierMois = donneesMensuelles[0];
  const moisPrecedent = donneesMensuelles[1];
  
  const evolution = dernierMois.annulations - moisPrecedent.annulations;
  const pourcentageEvolution = moisPrecedent.annulations > 0 
    ? Math.round((evolution / moisPrecedent.annulations) * 100) 
    : 0;

  return {
    dernier_mois: dernierMois.mois_nom,
    annulations_dernier_mois: dernierMois.annulations,
    mois_precedent: moisPrecedent.mois_nom,
    annulations_mois_precedent: moisPrecedent.annulations,
    evolution: evolution,
    pourcentage: Math.abs(pourcentageEvolution),
    direction: evolution > 0 ? 'hausse' : evolution < 0 ? 'baisse' : 'stable',
    interpretation: evolution > 0 
      ? `🔴 Augmentation de ${pourcentageEvolution}% par rapport au mois précédent`
      : evolution < 0 
        ? `🟢 Diminution de ${Math.abs(pourcentageEvolution)}% par rapport au mois précédent`
        : '⚪ Stabilité par rapport au mois précédent'
  };
}

function genererActionsRecommandees(statsRisque, impactFinancier) {
  const actions = [];

  if (statsRisque.critique > 0) {
    actions.push({
      priorite: 'URGENTE',
      action: `Contacter les ${statsRisque.critique} clients critiques (taux > 50%)`,
      delai: 'Immédiat'
    });
  }

  if (impactFinancier.critique > 1000) {
    actions.push({
      priorite: 'HAUTE',
      action: `Mettre en place une caution pour les clients à risque (pertes: ${impactFinancier.critique}€)`,
      delai: 'Cette semaine'
    });
  }

  if (statsRisque.modere > 5) {
    actions.push({
      priorite: 'MOYENNE',
      action: `Envoyer des rappels automatiques aux ${statsRisque.modere} clients modérés`,
      delai: 'Cette semaine'
    });
  }

  if (actions.length === 0) {
    actions.push({
      priorite: 'INFO',
      action: 'Aucune action urgente requise',
      delai: 'Surveillance normale'
    });
  }

  return actions;
}

function genererAlertes(donnees) {
  const alertes = [];

  // Alerte si taux d'annulation > 20%
  if (donnees.stats?.taux_annulation_global > 20) {
    alertes.push({
      niveau: '🔴 CRITIQUE',
      message: `Taux d'annulation global élevé: ${donnees.stats.taux_annulation_global}%`,
      action: 'Revoir la politique d\'annulation'
    });
  } else if (donnees.stats?.taux_annulation_global > 15) {
    alertes.push({
      niveau: '🟠 ATTENTION',
      message: `Taux d'annulation préoccupant: ${donnees.stats.taux_annulation_global}%`,
      action: 'Surveiller les prochaines semaines'
    });
  }

  // Alerte si beaucoup d'annulations aujourd'hui
  if (donnees.aujourdhui?.annulations_aujourdhui > 5) {
    alertes.push({
      niveau: '🟡 INFORMATION',
      message: `${donnees.aujourdhui.annulations_aujourdhui} annulations aujourd'hui`,
      action: 'Vérifier si motif particulier'
    });
  }

  // Alerte clients à risque
  if (donnees.clients?.length > 0) {
    alertes.push({
      niveau: '⚠️ SURVEILLANCE',
      message: `${donnees.clients.length} clients à risque identifiés`,
      action: 'Contacter les clients critiques'
    });
  }

  return alertes;
}

function calculerEfficacite(stats) {
  if (!stats) return { note: 'N/A', commentaire: 'Données insuffisantes' };

  const tauxAnnulation = stats.taux_annulation || 0;
  const impactFinancier = stats.impact_financier || 0;

  let note = 'A';
  if (tauxAnnulation > 20 || impactFinancier > 30) note = 'C';
  else if (tauxAnnulation > 10 || impactFinancier > 15) note = 'B';

  return {
    note,
    taux_annulation: tauxAnnulation,
    impact_financier: impactFinancier,
    commentaire: note === 'A' 
      ? 'Bonne gestion des annulations' 
      : note === 'B'
        ? 'Gestion moyenne à améliorer'
        : 'Gestion critique à revoir'
  };
}

function genererRecommandationsAvancees(stats) {
  const reco = [];

  if (!stats) return reco;

  if (stats.taux_annulation > 15) {
    reco.push("📉 Mettre en place un système de pénalité pour les annulations tardives");
  }

  if (stats.cout_moyen_annulation > 80) {
    reco.push("💰 Réviser la politique de remboursement pour réduire l'impact financier");
  }

  if (stats.clients_annulateurs > stats.clients_actifs * 0.3) {
    reco.push("👥 Cibler les clients fidèles avec des offres exclusives pour fidéliser");
  }

  if (reco.length === 0) {
    reco.push("✅ Continuer la surveillance et optimiser les processus existants");
  }

  return reco;
}

export default router;