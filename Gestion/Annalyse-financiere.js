import express from 'express';
import db from '../db.js';
import moment from 'moment';

const router = express.Router();

// 🔥 ROUTE DE TEST DE CONNEXION
router.get('/test', async (req, res) => {
  try {
    console.log('📡 Test API appelé');
    
    const result = await db.query(`
      SELECT 
        'API Financial Analysis' as service,
        CURRENT_TIMESTAMP as timestamp,
        (SELECT COUNT(*) FROM reservation) as total_reservations,
        (SELECT COUNT(DISTINCT email) FROM reservation) as total_clients,
        (SELECT COUNT(DISTINCT typeterrain) FROM reservation) as types_terrains,
        (SELECT COALESCE(SUM(tarif), 0) FROM reservation WHERE statut IN ('confirmée', 'payé', 'terminée')) as ca_total
    `);

    res.json({
      success: true,
      message: '✅ API Financial Analysis fonctionnelle',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      database: {
        reservations: result.rows[0]?.total_reservations || 0,
        clients: result.rows[0]?.total_clients || 0,
        terrains: result.rows[0]?.types_terrains || 0,
        ca_total: result.rows[0]?.ca_total || 0
      },
      endpoints_disponibles: [
        'GET /test',
        'GET /stats-globales',
        'GET /dashboard-complet',
        'GET /analyse-mensuelle?annee=2024',
        'GET /analyse-hebdomadaire',
        'GET /analyse-journaliere',
        'GET /analyse-par-type',
        'GET /top-clients',
        'GET /performance-terrains',
        'GET /tendances',
        'GET /export?format=json|csv'
      ]
    });
  } catch (error) {
    console.error('❌ Erreur test API:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur de connexion à la base de données',
      error: error.message,
      conseil: 'Vérifiez la connexion à PostgreSQL et les permissions de la table reservation'
    });
  }
});

// 🔥 STATISTIQUES GLOBALES
router.get('/stats-globales', async (req, res) => {
  try {
    console.log('📊 Stats globales appelées');
    
    const result = await db.query(`
      SELECT 
        -- CA Total
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as ca_total,
        
        -- Réservations
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as reservations_annulees,
        
        -- Clients
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_actifs,
        
        -- Taux de confirmation (calcul sécurisé)
        (
          CASE 
            WHEN COUNT(*) > 0 
            THEN (
              COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) * 100.0 / 
              COUNT(*)
            )
            ELSE 0 
          END
        )::NUMERIC(10,2) as taux_confirmation,
        
        -- Valeur moyenne par client
        (
          CASE 
            WHEN COUNT(DISTINCT email) > 0 
            THEN (
              COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 / 
              COUNT(DISTINCT email)
            )
            ELSE 0 
          END
        )::NUMERIC(10,2) as valeur_client_moyenne,
        
        -- Fréquence moyenne
        (
          CASE 
            WHEN COUNT(DISTINCT email) > 0 
            THEN (
              COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) * 1.0 / 
              COUNT(DISTINCT email)
            )
            ELSE 0 
          END
        )::NUMERIC(10,2) as frequence_moyenne,
        
        -- Tarif moyen
        (
          CASE 
            WHEN COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) > 0 
            THEN (
              COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 / 
              COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END)
            )
            ELSE 0 
          END
        )::NUMERIC(10,2) as tarif_moyen
        
      FROM reservation
    `);

    // Statistiques additionnelles
    const statsAdditionnelles = await db.query(`
      SELECT 
        -- Aujourd'hui
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') AND datereservation = CURRENT_DATE THEN tarif ELSE 0 END), 0) as ca_aujourdhui,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') AND datereservation = CURRENT_DATE THEN 1 END) as reservations_aujourdhui,
        
        -- Cette semaine
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') AND datereservation >= DATE_TRUNC('week', CURRENT_DATE) THEN tarif ELSE 0 END), 0) as ca_semaine,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') AND datereservation >= DATE_TRUNC('week', CURRENT_DATE) THEN 1 END) as reservations_semaine,
        
        -- Ce mois
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
          AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE) 
          THEN tarif ELSE 0 END), 0) as ca_mois,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
          AND EXTRACT(MONTH FROM datereservation) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM datereservation) = EXTRACT(YEAR FROM CURRENT_DATE) 
          THEN 1 END) as reservations_mois
      FROM reservation
    `);

    // Meilleur terrain
    const meilleurTerrain = await db.query(`
      SELECT 
        nomterrain,
        typeterrain,
        COUNT(*) as reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY nomterrain, typeterrain
      ORDER BY chiffre_affaires DESC
      LIMIT 1
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      statistiques: {
        globales: result.rows[0] || {},
        periodes_courantes: statsAdditionnelles.rows[0] || {},
        meilleur_terrain: meilleurTerrain.rows[0] || null,
        resume: {
          ca_total_formate: `MAD ${(result.rows[0]?.ca_total || 0).toLocaleString('fr-MA')}`,
          clients_actifs_formate: (result.rows[0]?.clients_actifs || 0).toLocaleString('fr-MA'),
          taux_confirmation_formate: `${(result.rows[0]?.taux_confirmation || 0).toFixed(1)}%`
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur stats globales:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du calcul des statistiques',
      error: error.message
    });
  }
});

// 🔥 DASHBOARD COMPLET
router.get('/dashboard-complet', async (req, res) => {
  try {
    const {
      date_debut = moment().subtract(30, 'days').format('YYYY-MM-DD'),
      date_fin = moment().format('YYYY-MM-DD')
    } = req.query;

    console.log(`📊 Dashboard complet: ${date_debut} à ${date_fin}`);

    // 1. KPI Principaux
    const kpi = await db.query(`
      SELECT 
        -- CA
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as ca_periode,
        
        -- Réservations
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as reservations_annulees,
        
        -- Clients
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_uniques,
        
        -- Performance
        (
          CASE 
            WHEN COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) > 0 
            THEN (
              COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 / 
              COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END)
            )
            ELSE 0 
          END
        )::NUMERIC(10,2) as tarif_moyen,
        
        -- Taux d'occupation estimé
        (
          CASE 
            WHEN SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) > 0 
            THEN (
              (COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) * 
               AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
                    THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 ELSE 0 END)) * 
              100.0 / 
              (8 * 30) -- 8h par jour, 30 jours
            )
            ELSE 0 
          END
        )::NUMERIC(10,2) as taux_occupation_estime
        
      FROM reservation
      WHERE datereservation BETWEEN $1 AND $2
    `, [date_debut, date_fin]);

    // 2. Tendances des 7 derniers jours
    const tendances = await db.query(`
      SELECT 
        datereservation::date as date,
        TO_CHAR(datereservation, 'DD/MM') as date_format,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as ca
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '7 days'
        AND datereservation <= CURRENT_DATE
      GROUP BY datereservation::date
      ORDER BY date
    `);

    // 3. Top 5 Terrains
    const topTerrains = await db.query(`
      SELECT 
        nomterrain,
        typeterrain,
        COUNT(*) as reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        (
          COALESCE(SUM(tarif), 0) * 1.0 / 
          NULLIF(SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600), 0)
        )::NUMERIC(10,2) as revenu_horaire_moyen
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation BETWEEN $1 AND $2
      GROUP BY nomterrain, typeterrain
      ORDER BY chiffre_affaires DESC
      LIMIT 5
    `, [date_debut, date_fin]);

    // 4. Top 5 Clients
    const topClients = await db.query(`
      SELECT 
        email,
        COALESCE(nomclient, 'Client') as nom,
        COALESCE(prenom, '') as prenom,
        COUNT(*) as reservations,
        COALESCE(SUM(tarif), 0) as total_depense,
        (
          COALESCE(SUM(tarif), 0) * 1.0 / 
          COUNT(*)
        )::NUMERIC(10,2) as depense_moyenne,
        MAX(datereservation) as derniere_reservation
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation BETWEEN $1 AND $2
      GROUP BY email, nomclient, prenom
      ORDER BY total_depense DESC
      LIMIT 5
    `, [date_debut, date_fin]);

    // 5. Distribution par heure
    const distributionHeures = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation BETWEEN $1 AND $2
        AND EXTRACT(HOUR FROM heurereservation) BETWEEN 8 AND 22
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `, [date_debut, date_fin]);

    res.json({
      success: true,
      periode: { date_debut, date_fin },
      timestamp: new Date().toISOString(),
      kpi: kpi.rows[0] || {},
      tendances_7j: tendances.rows || [],
      top_terrains: topTerrains.rows || [],
      top_clients: topClients.rows || [],
      distribution_heures: distributionHeures.rows || [],
      resume: {
        ca_total: kpi.rows[0]?.ca_periode || 0,
        reservations_total: kpi.rows[0]?.reservations_confirmees || 0,
        clients_total: kpi.rows[0]?.clients_uniques || 0,
        meilleur_jour: tendances.rows.reduce((max, day) => 
          day.ca > max.ca ? day : max, tendances.rows[0] || { ca: 0 }
        ),
        heure_plus_occupee: distributionHeures.rows.reduce((max, hour) => 
          hour.reservations > max.reservations ? hour : max, distributionHeures.rows[0] || { reservations: 0 }
        )
      }
    });

  } catch (error) {
    console.error('❌ Erreur dashboard complet:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement du dashboard',
      error: error.message
    });
  }
});

// 🔥 ANALYSE MENSUELLE AVEC COMPARAISON
router.get('/analyse-mensuelle', async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const anneePrecedente = annee - 1;

    console.log(`📅 Analyse mensuelle pour ${annee}`);

    const result = await db.query(`
      WITH tous_mois AS (
        SELECT generate_series(1, 12) as mois_num
      ),
      donnees_annee AS (
        SELECT 
          EXTRACT(MONTH FROM datereservation) as mois,
          EXTRACT(YEAR FROM datereservation) as annee,
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations,
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as ca,
          COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_uniques,
          (
            COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 /
            NULLIF(COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END), 0)
          )::NUMERIC(10,2) as tarif_moyen
        FROM reservation
        WHERE EXTRACT(YEAR FROM datereservation) IN ($1, $2)
        GROUP BY EXTRACT(MONTH FROM datereservation), EXTRACT(YEAR FROM datereservation)
      )
      SELECT 
        tm.mois_num as mois,
        TO_CHAR(TO_DATE(tm.mois_num::text, 'MM'), 'Month') as nom_mois,
        da_ca.annee as annee_courante,
        da_ca.reservations as reservations_courantes,
        da_ca.ca as ca_courant,
        da_ca.clients_uniques as clients_courants,
        da_ca.tarif_moyen as tarif_moyen_courant,
        da_pa.annee as annee_precedente,
        da_pa.reservations as reservations_precedentes,
        da_pa.ca as ca_precedent,
        da_pa.clients_uniques as clients_precedents,
        da_pa.tarif_moyen as tarif_moyen_precedent,
        CASE 
          WHEN da_pa.ca > 0 THEN 
            ((da_ca.ca - da_pa.ca) * 100.0 / da_pa.ca)::NUMERIC(10,2)
          ELSE 0 
        END as evolution_ca_pourcentage,
        CASE 
          WHEN da_pa.reservations > 0 THEN 
            ((da_ca.reservations - da_pa.reservations) * 100.0 / da_pa.reservations)::NUMERIC(10,2)
          ELSE 0 
        END as evolution_reservations_pourcentage
      FROM tous_mois tm
      LEFT JOIN donnees_annee da_ca ON tm.mois_num = da_ca.mois AND da_ca.annee = $1
      LEFT JOIN donnees_annee da_pa ON tm.mois_num = da_pa.mois AND da_pa.annee = $2
      ORDER BY tm.mois_num
    `, [annee, anneePrecedente]);

    // Calculer les totaux
    const totaux = result.rows.reduce((acc, mois) => ({
      ca_courant_total: acc.ca_courant_total + (mois.ca_courant || 0),
      ca_precedent_total: acc.ca_precedent_total + (mois.ca_precedent || 0),
      reservations_courantes_total: acc.reservations_courantes_total + (mois.reservations_courantes || 0),
      reservations_precedentes_total: acc.reservations_precedentes_total + (mois.reservations_precedentes || 0)
    }), {
      ca_courant_total: 0,
      ca_precedent_total: 0,
      reservations_courantes_total: 0,
      reservations_precedentes_total: 0
    });

    // Calculer l'évolution globale
    const evolutionGlobaleCA = totaux.ca_precedent_total > 0 
      ? ((totaux.ca_courant_total - totaux.ca_precedent_total) * 100.0 / totaux.ca_precedent_total)
      : 0;

    res.json({
      success: true,
      annees: { annee_courante: annee, annee_precedente: anneePrecedente },
      donnees_mensuelles: result.rows.map(mois => ({
        ...mois,
        nom_mois: mois.nom_mois.trim(),
        tendance_ca: (mois.evolution_ca_pourcentage || 0) > 0 ? 'hausse' : 
                    (mois.evolution_ca_pourcentage || 0) < 0 ? 'baisse' : 'stable',
        tendance_reservations: (mois.evolution_reservations_pourcentage || 0) > 0 ? 'hausse' : 
                              (mois.evolution_reservations_pourcentage || 0) < 0 ? 'baisse' : 'stable'
      })),
      totaux: {
        ...totaux,
        evolution_ca_globale: evolutionGlobaleCA.toFixed(2),
        tendance_globale: evolutionGlobaleCA > 0 ? 'hausse' : evolutionGlobaleCA < 0 ? 'baisse' : 'stable'
      },
      meilleur_mois: result.rows.reduce((max, mois) => 
        (mois.ca_courant || 0) > (max.ca_courant || 0) ? mois : max, result.rows[0] || {}
      ),
      mois_plus_croissance: result.rows
        .filter(m => m.evolution_ca_pourcentage > 0)
        .sort((a, b) => b.evolution_ca_pourcentage - a.evolution_ca_pourcentage)
        .slice(0, 3)
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

// 🔥 ANALYSE HEBDOMADAIRE
router.get('/analyse-hebdomadaire', async (req, res) => {
  try {
    const { mois, annee } = req.query;
    let whereClause = "WHERE statut IN ('confirmée', 'payé', 'terminée')";
    const params = [];

    if (mois && annee) {
      whereClause += " AND EXTRACT(MONTH FROM datereservation) = $1 AND EXTRACT(YEAR FROM datereservation) = $2";
      params.push(mois, annee);
    } else {
      whereClause += " AND datereservation >= CURRENT_DATE - INTERVAL '8 weeks'";
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
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        (
          COALESCE(SUM(tarif), 0) * 1.0 / 
          NULLIF(COUNT(*), 0)
        )::NUMERIC(10,2) as tarif_moyen,
        COUNT(DISTINCT numeroterrain) as terrains_utilises,
        COUNT(DISTINCT email) as clients_uniques
      FROM reservation
      ${whereClause}
      GROUP BY 
        DATE_TRUNC('week', datereservation),
        EXTRACT(WEEK FROM datereservation),
        EXTRACT(YEAR FROM datereservation)
      ORDER BY semaine_debut DESC
      LIMIT 8
    `, params);

    // Analyse par jour de semaine
    const joursSemaine = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_numero,
        TO_CHAR(datereservation, 'Day') as jour_nom,
        COUNT(*) as nombre_reservations,
        COALESCE(SUM(tarif), 0) as chiffre_affaires,
        (
          COALESCE(SUM(tarif), 0) * 1.0 / 
          NULLIF(COUNT(*), 0)
        )::NUMERIC(10,2) as tarif_moyen
      FROM reservation
      ${whereClause}
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_numero
    `, params);

    res.json({
      success: true,
      periode: mois && annee ? `Mois ${mois}/${annee}` : '8 dernières semaines',
      semaines: result.rows.map(semaine => ({
        ...semaine,
        chiffre_affaires: parseFloat(semaine.chiffre_affaires),
        tarif_moyen: parseFloat(semaine.tarif_moyen)
      })),
      jours_semaine: joursSemaine.rows.map(jour => ({
        ...jour,
        jour_nom: jour.jour_nom.trim(),
        chiffre_affaires: parseFloat(jour.chiffre_affaires),
        tarif_moyen: parseFloat(jour.tarif_moyen)
      })),
      statistiques: {
        meilleure_semaine: result.rows.reduce((max, semaine) => 
          semaine.chiffre_affaires > max.chiffre_affaires ? semaine : max, 
          result.rows[0] || { chiffre_affaires: 0 }
        ),
        semaine_plus_occupee: result.rows.reduce((max, semaine) => 
          semaine.nombre_reservations > max.nombre_reservations ? semaine : max, 
          result.rows[0] || { nombre_reservations: 0 }
        ),
        meilleur_jour: joursSemaine.rows.reduce((max, jour) => 
          jour.chiffre_affaires > max.chiffre_affaires ? jour : max, 
          joursSemaine.rows[0] || { chiffre_affaires: 0 }
        )
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse hebdomadaire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse hebdomadaire',
      error: error.message
    });
  }
});

// 🔥 ANALYSE JOURNALIÈRE
router.get('/analyse-journaliere', async (req, res) => {
  try {
    const { 
      date_debut = moment().subtract(7, 'days').format('YYYY-MM-DD'),
      date_fin = moment().format('YYYY-MM-DD')
    } = req.query;

    console.log(`📅 Analyse journalière: ${date_debut} à ${date_fin}`);

    const result = await db.query(`
      SELECT 
        datereservation::date as date,
        TO_CHAR(datereservation, 'DD/MM/YYYY') as date_formattee,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as jour_numero,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_confirmees,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as reservations_annulees,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as chiffre_affaires,
        (
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 /
          NULLIF(COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END), 0)
        )::NUMERIC(10,2) as tarif_moyen,
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_uniques,
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN numeroterrain END) as terrains_utilises
      FROM reservation
      WHERE datereservation::date BETWEEN $1 AND $2
      GROUP BY datereservation::date
      ORDER BY datereservation::date DESC
    `, [date_debut, date_fin]);

    // Analyse par heure pour la période
    const analyseHeures = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as chiffre_affaires,
        (
          COALESCE(AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
            THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
            ELSE NULL END), 0
          )
        )::NUMERIC(10,2) as duree_moyenne
      FROM reservation
      WHERE datereservation::date BETWEEN $1 AND $2
        AND EXTRACT(HOUR FROM heurereservation) BETWEEN 6 AND 23
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `, [date_debut, date_fin]);

    // Calculer les statistiques globales
    const statsGlobales = result.rows.reduce((acc, jour) => ({
      ca_total: acc.ca_total + (jour.chiffre_affaires || 0),
      reservations_total: acc.reservations_total + (jour.reservations_confirmees || 0),
      jours_total: acc.jours_total + 1,
      jours_avec_activite: acc.jours_avec_activite + ((jour.reservations_confirmees || 0) > 0 ? 1 : 0)
    }), {
      ca_total: 0,
      reservations_total: 0,
      jours_total: 0,
      jours_avec_activite: 0
    });

    statsGlobales.ca_moyen_journalier = statsGlobales.jours_avec_activite > 0 
      ? statsGlobales.ca_total / statsGlobales.jours_avec_activite 
      : 0;
    
    statsGlobales.reservations_moyennes_journalieres = statsGlobales.jours_avec_activite > 0 
      ? statsGlobales.reservations_total / statsGlobales.jours_avec_activite 
      : 0;

    res.json({
      success: true,
      periode: { date_debut, date_fin },
      jours: result.rows.map(jour => ({
        ...jour,
        jour_semaine: jour.jour_semaine.trim(),
        chiffre_affaires: parseFloat(jour.chiffre_affaires),
        tarif_moyen: parseFloat(jour.tarif_moyen)
      })),
      analyse_heures: analyseHeures.rows.map(heure => ({
        ...heure,
        chiffre_affaires: parseFloat(heure.chiffre_affaires),
        duree_moyenne: parseFloat(heure.duree_moyenne)
      })),
      statistiques: {
        globales: statsGlobales,
        meilleur_jour: result.rows.reduce((max, jour) => 
          jour.chiffre_affaires > max.chiffre_affaires ? jour : max, 
          result.rows[0] || { chiffre_affaires: 0 }
        ),
        jour_plus_occupe: result.rows.reduce((max, jour) => 
          jour.reservations_confirmees > max.reservations_confirmees ? jour : max, 
          result.rows[0] || { reservations_confirmees: 0 }
        ),
        heure_plus_rentable: analyseHeures.rows.reduce((max, heure) => 
          heure.chiffre_affaires > max.chiffre_affaires ? heure : max, 
          analyseHeures.rows[0] || { chiffre_affaires: 0 }
        )
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse journalière:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse journalière',
      error: error.message
    });
  }
});

// 🔥 ANALYSE PAR TYPE DE TERRAIN
router.get('/analyse-par-type', async (req, res) => {
  try {
    const { periode = '30' } = req.query;

    console.log(`🎾 Analyse par type de terrain: ${periode} jours`);

    const result = await db.query(`
      SELECT 
        typeterrain,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as nombre_reservations,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as chiffre_affaires,
        (
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 /
          NULLIF(COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END), 0)
        )::NUMERIC(10,2) as tarif_moyen,
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_uniques,
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN numeroterrain END) as terrains_utilises,
        COALESCE(
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
            THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
            ELSE 0 END
          ), 0
        )::NUMERIC(10,2) as heures_totales,
        (
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 /
          NULLIF(
            SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
              THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
              ELSE 0 END
            ), 0
          )
        )::NUMERIC(10,2) as revenu_horaire_moyen
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      GROUP BY typeterrain
      ORDER BY chiffre_affaires DESC
    `);

    // Calculer les pourcentages
    const caTotal = result.rows.reduce((sum, type) => sum + (type.chiffre_affaires || 0), 0);
    const reservationsTotal = result.rows.reduce((sum, type) => sum + (type.nombre_reservations || 0), 0);

    const donneesAvecPourcentages = result.rows.map(type => ({
      ...type,
      pourcentage_ca: caTotal > 0 ? ((type.chiffre_affaires || 0) * 100.0 / caTotal).toFixed(1) : '0.0',
      pourcentage_reservations: reservationsTotal > 0 ? ((type.nombre_reservations || 0) * 100.0 / reservationsTotal).toFixed(1) : '0.0',
      chiffre_affaires: parseFloat(type.chiffre_affaires),
      tarif_moyen: parseFloat(type.tarif_moyen),
      revenu_horaire_moyen: parseFloat(type.revenu_horaire_moyen)
    }));

    res.json({
      success: true,
      periode: `${periode} derniers jours`,
      types_terrains: donneesAvecPourcentages,
      statistiques: {
        ca_total: caTotal,
        reservations_total: reservationsTotal,
        type_le_plus_rentable: donneesAvecPourcentages[0] || null,
        type_le_plus_utilise: donneesAvecPourcentages.reduce((max, type) => 
          type.nombre_reservations > max.nombre_reservations ? type : max, 
          donneesAvecPourcentages[0] || { nombre_reservations: 0 }
        ),
        type_meilleur_revenu_horaire: donneesAvecPourcentages.reduce((max, type) => 
          type.revenu_horaire_moyen > max.revenu_horaire_moyen ? type : max, 
          donneesAvecPourcentages[0] || { revenu_horaire_moyen: 0 }
        )
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse par type:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse par type de terrain',
      error: error.message
    });
  }
});

// 🔥 TOP CLIENTS
router.get('/top-clients', async (req, res) => {
  try {
    const { limite = '20', periode = '90' } = req.query;

    console.log(`👥 Top clients: ${limite} clients, ${periode} jours`);

    const result = await db.query(`
      SELECT 
        email,
        COALESCE(nomclient, 'Client') as nom,
        COALESCE(prenom, '') as prenom,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as total_reservations,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as total_depense,
        MIN(datereservation) as premiere_reservation,
        MAX(datereservation) as derniere_reservation,
        (
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 /
          NULLIF(COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END), 0)
        )::NUMERIC(10,2) as depense_moyenne,
        COUNT(DISTINCT typeterrain) as types_terrains_utilises,
        COUNT(DISTINCT numeroterrain) as terrains_utilises,
        (
          COALESCE(AVG(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
            THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
            ELSE NULL END), 0
          )
        )::NUMERIC(10,2) as duree_moyenne_heures
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      GROUP BY email, nomclient, prenom
      HAVING COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) > 0
      ORDER BY total_depense DESC, total_reservations DESC
      LIMIT $1
    `, [limite]);

    // Calculer les statistiques globales clients
    const statsGlobales = await db.query(`
      SELECT 
        COUNT(DISTINCT email) as clients_uniques,
        (
          AVG(reservations_par_client)
        )::NUMERIC(10,2) as reservations_moyennes_par_client,
        (
          AVG(depense_par_client)
        )::NUMERIC(10,2) as depense_moyenne_par_client
      FROM (
        SELECT 
          email,
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_par_client,
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as depense_par_client
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
        GROUP BY email
      ) client_stats
    `);

    // Segmenter les clients
    const clientsSegments = result.rows.map(client => {
      const score = (client.total_depense / 1000) + (client.total_reservations * 0.5);
      let segment = 'Occasionnel';
      
      if (score > 15) segment = 'VIP';
      else if (score > 8) segment = 'Régulier';
      else if (score > 3) segment = 'Actif';
      
      return {
        ...client,
        total_depense: parseFloat(client.total_depense),
        depense_moyenne: parseFloat(client.depense_moyenne),
        duree_moyenne_heures: parseFloat(client.duree_moyenne_heures),
        segment_client: segment,
        score_client: score.toFixed(1)
      };
    });

    res.json({
      success: true,
      periode: `${periode} derniers jours`,
      clients: clientsSegments,
      statistiques: {
        globales: statsGlobales.rows[0] || {},
        segmentation: {
          vip: clientsSegments.filter(c => c.segment_client === 'VIP').length,
          regulier: clientsSegments.filter(c => c.segment_client === 'Régulier').length,
          actif: clientsSegments.filter(c => c.segment_client === 'Actif').length,
          occasionnel: clientsSegments.filter(c => c.segment_client === 'Occasionnel').length
        },
        meilleur_client: clientsSegments[0] || null,
        client_plus_fidele: clientsSegments.reduce((max, client) => 
          client.total_reservations > max.total_reservations ? client : max, 
          clientsSegments[0] || { total_reservations: 0 }
        )
      }
    });

  } catch (error) {
    console.error('❌ Erreur top clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des clients',
      error: error.message
    });
  }
});

// 🔥 PERFORMANCE DES TERRAINS
router.get('/performance-terrains', async (req, res) => {
  try {
    const { periode = '30' } = req.query;

    console.log(`🏟️ Performance terrains: ${periode} jours`);

    const result = await db.query(`
      SELECT 
        numeroterrain,
        nomterrain,
        typeterrain,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as nombre_reservations,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as chiffre_affaires,
        (
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 /
          NULLIF(COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END), 0)
        )::NUMERIC(10,2) as tarif_moyen,
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients_uniques,
        COALESCE(
          SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
            THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
            ELSE 0 END
          ), 0
        )::NUMERIC(10,2) as heures_totales,
        (
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) * 1.0 /
          NULLIF(
            SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
              THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
              ELSE 0 END
            ), 0
          )
        )::NUMERIC(10,2) as revenu_horaire_moyen,
        -- Taux d'occupation estimé (heures utilisées / heures disponibles)
        (
          (
            COALESCE(
              SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') 
                THEN EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600 
                ELSE 0 END
              ), 0
            ) * 100.0
          ) / 
          (8 * ${parseInt(periode)}) -- 8h par jour sur la période
        )::NUMERIC(10,2) as taux_occupation_estime
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      GROUP BY numeroterrain, nomterrain, typeterrain
      ORDER BY chiffre_affaires DESC
    `);

    // Calculer les totaux et pourcentages
    const caTotal = result.rows.reduce((sum, terrain) => sum + (terrain.chiffre_affaires || 0), 0);
    const reservationsTotal = result.rows.reduce((sum, terrain) => sum + (terrain.nombre_reservations || 0), 0);

    const terrainsAvecStats = result.rows.map(terrain => ({
      ...terrain,
      chiffre_affaires: parseFloat(terrain.chiffre_affaires),
      tarif_moyen: parseFloat(terrain.tarif_moyen),
      revenu_horaire_moyen: parseFloat(terrain.revenu_horaire_moyen),
      taux_occupation_estime: parseFloat(terrain.taux_occupation_estime),
      part_ca: caTotal > 0 ? ((terrain.chiffre_affaires || 0) * 100.0 / caTotal).toFixed(1) : '0.0',
      part_reservations: reservationsTotal > 0 ? ((terrain.nombre_reservations || 0) * 100.0 / reservationsTotal).toFixed(1) : '0.0'
    }));

    res.json({
      success: true,
      periode: `${periode} derniers jours`,
      terrains: terrainsAvecStats,
      statistiques: {
        total_terrains: terrainsAvecStats.length,
        ca_total: caTotal,
        reservations_total: reservationsTotal,
        terrain_plus_rentable: terrainsAvecStats[0] || null,
        terrain_plus_occupe: terrainsAvecStats.reduce((max, terrain) => 
          terrain.taux_occupation_estime > max.taux_occupation_estime ? terrain : max, 
          terrainsAvecStats[0] || { taux_occupation_estime: 0 }
        ),
        terrain_meilleur_revenu_horaire: terrainsAvecStats.reduce((max, terrain) => 
          terrain.revenu_horaire_moyen > max.revenu_horaire_moyen ? terrain : max, 
          terrainsAvecStats[0] || { revenu_horaire_moyen: 0 }
        )
      }
    });

  } catch (error) {
    console.error('❌ Erreur performance terrains:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des terrains',
      error: error.message
    });
  }
});

// 🔥 TENDANCES ET PRÉVISIONS
router.get('/tendances', async (req, res) => {
  try {
    console.log('📈 Analyse des tendances');

    // Historique des 90 derniers jours
    const historique = await db.query(`
      SELECT 
        datereservation::date as date,
        TO_CHAR(datereservation, 'Day') as jour_semaine,
        EXTRACT(DOW FROM datereservation) as jour_numero,
        COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as ca,
        COUNT(DISTINCT CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN email END) as clients
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
        AND statut IN ('confirmée', 'payé', 'terminée')
      GROUP BY datereservation::date
      ORDER BY date
    `);

    // Moyennes par jour de semaine
    const moyennesParJour = await db.query(`
      SELECT 
        EXTRACT(DOW FROM datereservation) as jour_numero,
        TO_CHAR(datereservation, 'Day') as jour_nom,
        AVG(reservations_daily)::NUMERIC(10,2) as reservations_moyennes,
        AVG(ca_daily)::NUMERIC(10,2) as ca_moyen,
        STDDEV(reservations_daily)::NUMERIC(10,2) as reservations_ecart_type,
        STDDEV(ca_daily)::NUMERIC(10,2) as ca_ecart_type,
        COUNT(*) as jours_analyse
      FROM (
        SELECT 
          datereservation::date,
          TO_CHAR(datereservation, 'Day') as jour,
          EXTRACT(DOW FROM datereservation) as jour_num,
          COUNT(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN 1 END) as reservations_daily,
          COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as ca_daily
        FROM reservation
        WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
          AND statut IN ('confirmée', 'payé', 'terminée')
        GROUP BY datereservation::date
      ) daily_stats
      GROUP BY EXTRACT(DOW FROM datereservation), TO_CHAR(datereservation, 'Day')
      ORDER BY jour_numero
    `);

    // Générer des prévisions pour les 14 prochains jours
    const aujourdhui = new Date();
    const previsions = [];
    
    for (let i = 1; i <= 14; i++) {
      const datePrevision = new Date(aujourdhui);
      datePrevision.setDate(aujourdhui.getDate() + i);
      
      const jourNumero = datePrevision.getDay();
      const statsJour = moyennesParJour.rows.find(row => row.jour_numero === jourNumero);
      
      if (statsJour) {
        // Calculer les prévisions avec variation
        const reservationsPrevues = Math.max(0, 
          parseFloat(statsJour.reservations_moyennes || 0) + 
          (Math.random() - 0.5) * parseFloat(statsJour.reservations_ecart_type || 0)
        );
        
        const caPrevu = Math.max(0, 
          parseFloat(statsJour.ca_moyen || 0) + 
          (Math.random() - 0.5) * parseFloat(statsJour.ca_ecart_type || 0)
        );

        // Niveau de confiance basé sur l'écart-type
        let niveauConfiance = 'Moyen';
        const cvReservations = parseFloat(statsJour.reservations_ecart_type || 0) / 
                              parseFloat(statsJour.reservations_moyennes || 1);
        
        if (cvReservations < 0.3) niveauConfiance = 'Élevé';
        else if (cvReservations > 0.7) niveauConfiance = 'Faible';

        previsions.push({
          date: datePrevision.toISOString().split('T')[0],
          date_format: datePrevision.toLocaleDateString('fr-FR'),
          jour_semaine: statsJour.jour_nom.trim(),
          reservations_prevues: Math.round(reservationsPrevues * 10) / 10,
          ca_prevu: Math.round(caPrevu),
          tarif_moyen_prevu: reservationsPrevues > 0 
            ? Math.round((caPrevu / reservationsPrevues) * 10) / 10 
            : 0,
          niveau_confiance: niveauConfiance,
          jours_analyse: statsJour.jours_analyse
        });
      }
    }

    // Calculer les tendances
    const derniersJours = historique.rows.slice(-7);
    const tendanceCA = derniersJours.length > 1 
      ? ((derniersJours[derniersJours.length - 1]?.ca || 0) - (derniersJours[0]?.ca || 0)) / (derniersJours[0]?.ca || 1) * 100
      : 0;

    const tendanceReservations = derniersJours.length > 1
      ? ((derniersJours[derniersJours.length - 1]?.reservations || 0) - (derniersJours[0]?.reservations || 0)) / (derniersJours[0]?.reservations || 1) * 100
      : 0;

    res.json({
      success: true,
      historique: {
        periode: '90 derniers jours',
        jours_analyse: historique.rows.length,
        ca_total: historique.rows.reduce((sum, jour) => sum + (jour.ca || 0), 0),
        reservations_total: historique.rows.reduce((sum, jour) => sum + (jour.reservations || 0), 0)
      },
      moyennes_reference: moyennesParJour.rows.map(row => ({
        ...row,
        jour_nom: row.jour_nom.trim(),
        reservations_moyennes: parseFloat(row.reservations_moyennes),
        ca_moyen: parseFloat(row.ca_moyen),
        reservations_ecart_type: parseFloat(row.reservations_ecart_type),
        ca_ecart_type: parseFloat(row.ca_ecart_type)
      })),
      previsions: previsions,
      tendances: {
        ca_7j: tendanceCA.toFixed(1),
        reservations_7j: tendanceReservations.toFixed(1),
        direction_ca: tendanceCA > 0 ? '📈 Hausse' : tendanceCA < 0 ? '📉 Baisse' : '➡️ Stable',
        direction_reservations: tendanceReservations > 0 ? '📈 Hausse' : tendanceReservations < 0 ? '📉 Baisse' : '➡️ Stable'
      },
      recommendations: genererRecommandations(historique.rows, moyennesParJour.rows)
    });

  } catch (error) {
    console.error('❌ Erreur tendances:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des tendances',
      error: error.message
    });
  }
});

// 🔥 EXPORT DES DONNÉES
router.get('/export', async (req, res) => {
  try {
    const { format = 'json', periode = '30' } = req.query;

    console.log(`💾 Export données: format ${format}, ${periode} jours`);

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
        statut,
        created_at
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '${periode} days'
      ORDER BY datereservation DESC, heurereservation DESC
    `);

    const metadata = {
      date_export: new Date().toISOString(),
      periode: `${periode} jours`,
      nombre_lignes: result.rows.length,
      format: format,
      generated_by: 'API Financial Analysis v2.0'
    };

    if (format.toLowerCase() === 'csv') {
      // Convertir en CSV
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Aucune donnée à exporter'
        });
      }

      const headers = Object.keys(result.rows[0]).join(',');
      const csvData = result.rows.map(row => 
        Object.values(row).map(value => {
          if (value === null || value === undefined) return '';
          const stringValue = String(value);
          return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
        }).join(',')
      ).join('\n');
      
      const csv = `${headers}\n${csvData}`;
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=export-financier-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        metadata: metadata,
        data: result.rows
      });
    }

  } catch (error) {
    console.error('❌ Erreur export:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'export des données',
      error: error.message
    });
  }
});

// 🔥 ROUTE RACINE - INFORMATIONS API
router.get('/', async (req, res) => {
  try {
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_reservations,
        COALESCE(SUM(CASE WHEN statut IN ('confirmée', 'payé', 'terminée') THEN tarif ELSE 0 END), 0) as ca_total
      FROM reservation
      LIMIT 1
    `);

    res.json({
      success: true,
      message: '🚀 API Financial Analysis - Version 2.0',
      description: 'API complète d\'analyse financière pour les réservations',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      database: {
        reservations_total: stats.rows[0]?.total_reservations || 0,
        ca_total: stats.rows[0]?.ca_total || 0,
        status: '✅ Connecté'
      },
      documentation: {
        base_url: req.protocol + '://' + req.get('host') + req.baseUrl,
        endpoints: [
          { method: 'GET', path: '/', description: 'Informations API' },
          { method: 'GET', path: '/test', description: 'Test de connexion' },
          { method: 'GET', path: '/stats-globales', description: 'Statistiques globales' },
          { method: 'GET', path: '/dashboard-complet', description: 'Dashboard complet', query: 'date_debut, date_fin' },
          { method: 'GET', path: '/analyse-mensuelle', description: 'Analyse mensuelle', query: 'annee' },
          { method: 'GET', path: '/analyse-hebdomadaire', description: 'Analyse hebdomadaire', query: 'mois, annee' },
          { method: 'GET', path: '/analyse-journaliere', description: 'Analyse journalière', query: 'date_debut, date_fin' },
          { method: 'GET', path: '/analyse-par-type', description: 'Analyse par type terrain', query: 'periode' },
          { method: 'GET', path: '/top-clients', description: 'Top clients', query: 'limite, periode' },
          { method: 'GET', path: '/performance-terrains', description: 'Performance terrains', query: 'periode' },
          { method: 'GET', path: '/tendances', description: 'Tendances et prévisions' },
          { method: 'GET', path: '/export', description: 'Export données', query: 'format=json|csv, periode' }
        ]
      }
    });
  } catch (error) {
    console.error('❌ Erreur route racine:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur de connexion à la base de données',
      error: error.message,
      help: 'Vérifiez que la table "reservation" existe et est accessible'
    });
  }
});

// === FONCTIONS UTILITAIRES ===

function genererRecommandations(historique, moyennes) {
  const recommendations = [];
  
  // Analyser les jours avec faible activité
  const joursFaibleActivite = moyennes
    .filter(jour => jour.reservations_moyennes < 5)
    .sort((a, b) => a.reservations_moyennes - b.reservations_moyennes);
  
  if (joursFaibleActivite.length > 0) {
    recommendations.push({
      type: 'OPTIMISATION',
      titre: 'Jours à faible activité détectés',
      description: `${joursFaibleActivite.length} jours ont une moyenne inférieure à 5 réservations`,
      action: `Créer des promotions pour les jours: ${joursFaibleActivite.map(j => j.jour_nom.trim()).join(', ')}`,
      impact: 'Potentiel: +20-30% de réservations'
    });
  }
  
  // Analyser la volatilité
  const volatilite = moyennes.reduce((sum, jour) => sum + jour.ca_ecart_type, 0) / moyennes.length;
  if (volatilite > 500) {
    recommendations.push({
      type: 'STABILISATION',
      titre: 'Volatilité élevée du CA',
      description: `Le CA présente une forte volatilité (écart-type moyen: ${volatilite.toFixed(0)} MAD)`,
      action: 'Diversifier les créneaux et proposer des forfaits',
      impact: 'Réduction du risque de revenus'
    });
  }
  
  // Identifier les opportunités
  const meilleurJour = moyennes.reduce((max, jour) => 
    jour.ca_moyen > max.ca_moyen ? jour : max, moyennes[0] || { ca_moyen: 0 });
  
  if (meilleurJour) {
    recommendations.push({
      type: 'CAPITALISATION',
      titre: 'Capitaliser sur les bons jours',
      description: `${meilleurJour.jour_nom.trim()} est le jour le plus performant (moyenne: ${meilleurJour.ca_moyen.toFixed(0)} MAD)`,
      action: 'Augmenter la capacité ou les tarifs ce jour-là',
      impact: 'Potentiel: +10-15% de CA supplémentaire'
    });
  }
  
  return recommendations;
}

// 🔥 MIDDLEWARE DE GESTION DES ERREURS
router.use((err, req, res, next) => {
  console.error('🔥 Erreur globale:', err);
  
  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Une erreur est survenue',
    timestamp: new Date().toISOString()
  });
});

// 🔥 ROUTE 404
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route non trouvée',
    requested_url: req.originalUrl,
    available_endpoints: [
      '/',
      '/test', 
      '/stats-globales',
      '/dashboard-complet',
      '/analyse-mensuelle',
      '/analyse-hebdomadaire',
      '/analyse-journaliere',
      '/analyse-par-type',
      '/top-clients',
      '/performance-terrains',
      '/tendances',
      '/export'
    ]
  });
});

export default router;