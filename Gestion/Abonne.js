import express from 'express';
const router = express.Router();
import db from '../db.js';

// Fonctions utilitaires pour les dates
const getDateInFuture = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
};

const getDateInPast = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
};

// ============================================
// 1. DASHBOARD EXÉCUTIF ULTIME
// ============================================

router.get('/dashboard-executif-ultime', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const debutAnnee = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        const datePast30 = getDateInPast(30);
        const datePast90 = getDateInPast(90);
        const datePast365 = getDateInPast(365);

        // 1. MÉTRIQUES FONDAMENTALES
        const [
            totalClients,
            actifsAujourdhui,
            nouveauxMois,
            revenuMois,
            revenuAnnee,
            panierMoyen,
            tauxRetention,
            mrr,
            arr,
            churnRate,
            cac
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as total FROM clients'),
            db.query(`SELECT COUNT(*) as actifs FROM clients WHERE statut = 'actif' AND date_fin >= $1`, [today]),
            db.query(`SELECT COUNT(*) as nouveaux FROM clients WHERE date_debut >= $1`, [debutMois]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as revenu FROM clients WHERE date_debut >= $1`, [debutMois]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as revenu FROM clients WHERE date_debut >= $1`, [debutAnnee]),
            db.query(`SELECT COALESCE(AVG(prix_total), 0) as moyen FROM clients WHERE prix_total > 0`),
            db.query(`
                SELECT COALESCE(
                    (SELECT COUNT(DISTINCT email) FROM clients WHERE date_debut > $1 AND statut = 'actif') * 100.0 /
                    NULLIF((SELECT COUNT(DISTINCT email) FROM clients WHERE date_debut > $2), 0), 0
                ) as taux
            `, [datePast30, datePast30]),
            db.query(`
                SELECT COALESCE(SUM(
                    CASE
                        WHEN type_abonnement = 'mensuel' THEN prix_total
                        WHEN type_abonnement = 'trimestriel' THEN prix_total / 3
                        WHEN type_abonnement = 'semestriel' THEN prix_total / 6
                        WHEN type_abonnement = 'annuel' THEN prix_total / 12
                        ELSE 0
                    END
                ), 0) as mrr FROM clients WHERE statut = 'actif' AND date_fin >= $1
            `, [today]),
            db.query(`SELECT $1 * 12 as arr`, [mrr]),
            db.query(`
                SELECT COALESCE(
                    (SELECT COUNT(*) FROM clients WHERE statut IN ('inactif', 'expire') AND date_fin > $1) * 100.0 /
                    NULLIF((SELECT COUNT(*) FROM clients WHERE statut = 'actif' AND date_debut > $1), 0), 0
                ) as churn
            `, [datePast30]),
            db.query(`SELECT COALESCE(AVG(prix_total), 0) as cac FROM clients WHERE date_debut > $1`, [datePast30])
        ]);

        // 2. ANALYSE DES TENDANCES
        const [
            evolutionHebdo,
            evolutionHoraire,
            meilleursClients,
            clientsRisques,
            predictionChurn
        ] = await Promise.all([
            db.query(`
                SELECT 
                    TO_CHAR(date_debut, 'IW') as semaine,
                    COUNT(*) as inscriptions,
                    SUM(prix_total) as revenus
                FROM clients
                WHERE date_debut > $1
                GROUP BY TO_CHAR(date_debut, 'IW')
                ORDER BY semaine DESC
                LIMIT 8
            `, [datePast90]),
            db.query(`
                SELECT 
                    EXTRACT(HOUR FROM heure_reservation) as heure,
                    COUNT(*) as reservations,
                    AVG(prix_total) as panier_moyen
                FROM clients
                WHERE heure_reservation IS NOT NULL
                GROUP BY EXTRACT(HOUR FROM heure_reservation)
                ORDER BY reservations DESC
            `),
            db.query(`
                SELECT 
                    nom, prenom, email,
                    COUNT(*) as nb_abonnements,
                    SUM(prix_total) as total_depense,
                    AVG(prix_total) as panier_moyen,
                    MAX(date_fin) as dernier_abo
                FROM clients
                GROUP BY nom, prenom, email
                ORDER BY total_depense DESC
                LIMIT 10
            `),
            db.query(`
                SELECT 
                    nom, prenom, email,
                    date_fin,
                    CASE 
                        WHEN date_fin - CURRENT_DATE <= 7 THEN 'CRITIQUE'
                        WHEN date_fin - CURRENT_DATE <= 15 THEN 'URGENT'
                        WHEN date_fin - CURRENT_DATE <= 30 THEN 'ATTENTION'
                        ELSE 'OK'
                    END as niveau_risque
                FROM clients
                WHERE statut = 'actif' 
                AND date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
                ORDER BY date_fin ASC
            `),
            db.query(`
                WITH prediction_data AS (
                    SELECT 
                        email,
                        COUNT(*) as frequence,
                        AVG(prix_total) as montant_moyen,
                        MAX(date_fin) as derniere_date,
                        CASE WHEN COUNT(*) > 1 THEN 1 ELSE 0 END as a_renouvele
                    FROM clients
                    GROUP BY email
                )
                SELECT 
                    COUNT(*) as total_clients,
                    AVG(CASE WHEN a_renouvele = 1 THEN 1 ELSE 0 END) as taux_renouvellement_moyen,
                    AVG(frequence) as frequence_moyenne,
                    STDDEV(frequence) as ecart_type_frequence
                FROM prediction_data
            `)
        ]);

        // 3. ANALYSE FINANCIÈRE AVANCÉE
        const [
            ltvParCohorte,
            mrrParSegment,
            arrParType,
            cashflowPrevisionnel
        ] = await Promise.all([
            db.query(`
                WITH cohortes AS (
                    SELECT 
                        DATE_TRUNC('month', date_debut) as cohorte,
                        email,
                        SUM(prix_total) as valeur_totale
                    FROM clients
                    GROUP BY DATE_TRUNC('month', date_debut), email
                )
                SELECT 
                    TO_CHAR(cohorte, 'YYYY-MM') as cohorte,
                    COUNT(*) as taille_cohorte,
                    AVG(valeur_totale) as ltv_moyenne,
                    SUM(valeur_totale) as revenu_total_cohorte
                FROM cohortes
                GROUP BY cohorte
                ORDER BY cohorte DESC
                LIMIT 12
            `),
            db.query(`
                SELECT 
                    CASE 
                        WHEN prix_total < 100 THEN 'Petit budget'
                        WHEN prix_total < 300 THEN 'Budget moyen'
                        WHEN prix_total < 500 THEN 'Budget élevé'
                        ELSE 'Premium'
                    END as segment,
                    COUNT(*) as clients,
                    SUM(prix_total) as mrr_segment,
                    AVG(prix_total) as panier_moyen
                FROM clients
                WHERE statut = 'actif'
                GROUP BY 
                    CASE 
                        WHEN prix_total < 100 THEN 'Petit budget'
                        WHEN prix_total < 300 THEN 'Budget moyen'
                        WHEN prix_total < 500 THEN 'Budget élevé'
                        ELSE 'Premium'
                    END
            `),
            db.query(`
                SELECT 
                    type_abonnement,
                    COUNT(*) as nb_abonnements,
                    SUM(prix_total) as arr_type,
                    AVG(prix_total) as prix_moyen,
                    COUNT(DISTINCT email) as clients_uniques
                FROM clients
                WHERE statut = 'actif'
                GROUP BY type_abonnement
                ORDER BY arr_type DESC
            `),
            db.query(`
                WITH prochains_mois AS (
                    SELECT 
                        DATE_TRUNC('month', date_fin) as mois_expiration,
                        SUM(prix_total) as montant_a_renouveler
                    FROM clients
                    WHERE statut = 'actif'
                    AND date_fin > CURRENT_DATE
                    GROUP BY DATE_TRUNC('month', date_fin)
                )
                SELECT 
                    TO_CHAR(mois_expiration, 'YYYY-MM') as mois,
                    montant_a_renouveler as revenu_potentiel
                FROM prochains_mois
                ORDER BY mois_expiration
                LIMIT 6
            `)
        ]);

        // 4. ANALYSE COMPORTEMENTALE
        const [
            heuresAffluence,
            dureeMoyenneSeance,
            tauxFidelisation,
            satisfactionClient
        ] = await Promise.all([
            db.query(`
                SELECT 
                    EXTRACT(HOUR FROM heure_reservation) as heure,
                    COUNT(*) as nb_reservations,
                    AVG(EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600) as duree_moyenne
                FROM clients
                WHERE heure_reservation IS NOT NULL
                GROUP BY EXTRACT(HOUR FROM heure_reservation)
                ORDER BY nb_reservations DESC
            `),
            db.query(`
                SELECT 
                    AVG(EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600) as duree_moyenne,
                    MAX(EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600) as duree_max,
                    MIN(EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600) as duree_min
                FROM clients
                WHERE heure_reservation IS NOT NULL
            `),
            db.query(`
                SELECT 
                    CASE 
                        WHEN COUNT(*) > 3 THEN 'Très fidèle'
                        WHEN COUNT(*) = 2 THEN 'Fidèle'
                        WHEN COUNT(*) = 1 THEN 'Nouveau'
                        ELSE 'Occasionnel'
                    END as niveau_fidelite,
                    COUNT(*) as nb_clients,
                    AVG(prix_total) as depense_moyenne
                FROM (
                    SELECT email, COUNT(*) as nb_achats
                    FROM clients
                    GROUP BY email
                ) as stats
                GROUP BY 
                    CASE 
                        WHEN nb_achats > 3 THEN 'Très fidèle'
                        WHEN nb_achats = 2 THEN 'Fidèle'
                        WHEN nb_achats = 1 THEN 'Nouveau'
                        ELSE 'Occasionnel'
                    END
            `),
            db.query(`
                SELECT 
                    ROUND(AVG(CASE 
                        WHEN heure_reservation IS NOT NULL AND prix_total > 0 THEN 4.5
                        WHEN heure_reservation IS NOT NULL THEN 4.0
                        WHEN prix_total > 100 THEN 3.5
                        ELSE 3.0
                    END), 1) as indice_satisfaction_estime
                FROM clients
            `)
        ]);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: {
                kpis_critiques: {
                    total_abonnes: parseInt(totalClients.rows[0].total),
                    actifs_ajd: parseInt(actifsAujourdhui.rows[0].actifs),
                    nouveaux_mois: parseInt(nouveauxMois.rows[0].nouveaux),
                    revenu_mois: parseFloat(revenuMois.rows[0].revenu),
                    revenu_annee: parseFloat(revenuAnnee.rows[0].revenu),
                    panier_moyen: parseFloat(panierMoyen.rows[0].moyen).toFixed(2),
                    taux_retention: parseFloat(tauxRetention.rows[0].taux).toFixed(2) + '%',
                    mrr: parseFloat(mrr.rows[0].mrr).toFixed(2),
                    arr: parseFloat(arr.rows[0].arr).toFixed(2),
                    churn_rate: parseFloat(churnRate.rows[0].churn).toFixed(2) + '%',
                    cac_estime: parseFloat(cac.rows[0].cac).toFixed(2)
                },
                tendances: {
                    hebdomadaires: evolutionHebdo.rows,
                    horaires: heuresAffluence.rows,
                    meilleurs_clients: meilleursClients.rows,
                    clients_a_risque: clientsRisques.rows
                },
                financier: {
                    ltv_par_cohorte: ltvParCohorte.rows,
                    mrr_par_segment: mrrParSegment.rows,
                    arr_par_type: arrParType.rows,
                    cashflow_previsionnel: cashflowPrevisionnel.rows
                },
                comportemental: {
                    heures_affluence: heuresAffluence.rows,
                    duree_moyenne_seance: dureeMoyenneSeance.rows[0],
                    taux_fidelisation: tauxFidelisation.rows,
                    satisfaction_client: satisfactionClient.rows[0].indice_satisfaction_estime
                },
                predictions: {
                    churn_prediction: predictionChurn.rows[0],
                    recommandations: genererRecommandations({
                        churn: parseFloat(churnRate.rows[0].churn),
                        retention: parseFloat(tauxRetention.rows[0].taux),
                        satisfaction: satisfactionClient.rows[0].indice_satisfaction_estime
                    })
                }
            }
        });
    } catch (err) {
        console.error('Erreur Dashboard Exécutif Ultime:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 2. ANALYSE PRÉDICTIVE AVANCÉE
// ============================================

router.get('/analyse-predictive', async (req, res) => {
    try {
        // 1. PRÉDICTION DE CHURN (modèle simplifié)
        const facteursChurn = await db.query(`
            WITH profils_clients AS (
                SELECT 
                    email,
                    COUNT(*) as nb_abonnements,
                    AVG(prix_total) as montant_moyen,
                    MAX(date_fin) as derniere_date,
                    CASE 
                        WHEN MAX(date_fin) < CURRENT_DATE - INTERVAL '90 days' THEN 1
                        ELSE 0
                    END as a_churn
                FROM clients
                GROUP BY email
            )
            SELECT 
                AVG(CASE WHEN a_churn = 1 THEN nb_abonnements ELSE NULL END) as nb_abonnements_churn,
                AVG(CASE WHEN a_churn = 0 THEN nb_abonnements ELSE NULL END) as nb_abonnements_fidele,
                AVG(CASE WHEN a_churn = 1 THEN montant_moyen ELSE NULL END) as montant_moyen_churn,
                AVG(CASE WHEN a_churn = 0 THEN montant_moyen ELSE NULL END) as montant_moyen_fidele,
                COUNT(CASE WHEN a_churn = 1 THEN 1 END) as total_churn,
                COUNT(CASE WHEN a_churn = 0 THEN 1 END) as total_fidele
            FROM profils_clients
        `);

        // 2. PRÉDICTION DE VALEUR À VIE (LTV)
        const predictionLTV = await db.query(`
            WITH historique_achats AS (
                SELECT 
                    email,
                    COUNT(*) as frequence,
                    AVG(prix_total) as ticket_moyen,
                    EXTRACT(DAY FROM (CURRENT_DATE - MIN(date_debut))) as anciennete_jours,
                    SUM(prix_total) as ltv_actuelle
                FROM clients
                GROUP BY email
            )
            SELECT 
                AVG(frequence) as frequence_moyenne,
                AVG(ticket_moyen) as ticket_moyen_global,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ltv_actuelle) as ltv_mediane,
                PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ltv_actuelle) as ltv_top_10,
                AVG(ltv_actuelle) as ltv_moyenne,
                CORR(anciennete_jours, ltv_actuelle) as correlation_anciennete_ltv
            FROM historique_achats
        `);

        // 3. PRÉDICTION DES TENDANCES SAISONNIÈRES
        const tendancesSaison = await db.query(`
            WITH saisons AS (
                SELECT 
                    EXTRACT(MONTH FROM date_debut) as mois,
                    EXTRACT(YEAR FROM date_debut) as annee,
                    COUNT(*) as inscriptions,
                    SUM(prix_total) as revenus
                FROM clients
                GROUP BY EXTRACT(MONTH FROM date_debut), EXTRACT(YEAR FROM date_debut)
            )
            SELECT 
                mois,
                AVG(inscriptions) as inscriptions_moyennes,
                AVG(revenus) as revenus_moyens,
                STDDEV(inscriptions) as variation_inscriptions,
                CASE 
                    WHEN AVG(inscriptions) > (SELECT AVG(inscriptions) * 1.2 FROM saisons) THEN 'HAUTE'
                    WHEN AVG(inscriptions) < (SELECT AVG(inscriptions) * 0.8 FROM saisons) THEN 'BASSE'
                    ELSE 'NORMALE'
                END as saisonnalite
            FROM saisons
            GROUP BY mois
            ORDER BY mois
        `);

        // 4. IDENTIFICATION DES OPPORTUNITÉS DE CROIX-VENTE
        const opportunitesCrossSell = await db.query(`
            SELECT 
                c1.type_abonnement as type_actuel,
                c2.type_abonnement as type_recommande,
                COUNT(*) as nombre_clients_potentiels,
                AVG(c2.prix_total) as prix_moyen_recommande
            FROM clients c1
            CROSS JOIN clients c2
            WHERE c1.type_abonnement != c2.type_abonnement
            AND c2.type_abonnement IS NOT NULL
            AND c1.statut = 'actif'
            AND c2.prix_total > c1.prix_total
            GROUP BY c1.type_abonnement, c2.type_abonnement
            HAVING COUNT(*) > 5
            ORDER BY nombre_clients_potentiels DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            data: {
                churn_prediction: {
                    facteurs_risque: facteursChurn.rows[0],
                    profil_churn: {
                        nb_abonnements_moyen: parseFloat(facteursChurn.rows[0]?.nb_abonnements_churn || 0).toFixed(2),
                        montant_moyen: parseFloat(facteursChurn.rows[0]?.montant_moyen_churn || 0).toFixed(2)
                    },
                    profil_fidele: {
                        nb_abonnements_moyen: parseFloat(facteursChurn.rows[0]?.nb_abonnements_fidele || 0).toFixed(2),
                        montant_moyen: parseFloat(facteursChurn.rows[0]?.montant_moyen_fidele || 0).toFixed(2)
                    }
                },
                ltv_prediction: {
                    moyenne: parseFloat(predictionLTV.rows[0]?.ltv_moyenne || 0).toFixed(2),
                    mediane: parseFloat(predictionLTV.rows[0]?.ltv_mediane || 0).toFixed(2),
                    top_10: parseFloat(predictionLTV.rows[0]?.ltv_top_10 || 0).toFixed(2),
                    correlation_anciennete: parseFloat(predictionLTV.rows[0]?.correlation_anciennete_ltv || 0).toFixed(3)
                },
                saisonnalite: tendancesSaison.rows,
                opportunites_cross_sell: opportunitesCrossSell.rows
            }
        });
    } catch (err) {
        console.error('Erreur Analyse Prédictive:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 3. ANALYSE DE LA SATISFACTION CLIENT
// ============================================

router.get('/analyse-satisfaction', async (req, res) => {
    try {
        // 1. INDICATEURS DE SATISFACTION
        const satisfaction = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as clients_actifs,
                COUNT(CASE WHEN heure_reservation IS NULL AND statut = 'actif' THEN 1 END) as clients_inactifs,
                AVG(CASE 
                    WHEN prix_total > 500 THEN 5
                    WHEN prix_total > 300 THEN 4
                    WHEN prix_total > 100 THEN 3
                    ELSE 2
                END) as note_moyenne_estimee
            FROM clients
        `);

        // 2. ANALYSE DES RÉCLAMATIONS POTENTIELLES
        const pointsDouleur = await db.query(`
            SELECT 
                CASE 
                    WHEN date_fin < CURRENT_DATE AND statut = 'actif' THEN 'INCOHERENCE_STATUT'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'DOSSIER_INCOMPLET'
                    WHEN prix_total <= 0 THEN 'PRIX_ANORMAL'
                    WHEN date_fin IS NULL THEN 'DATE_MANQUANTE'
                END as type_probleme,
                COUNT(*) as occurrences
            FROM clients
            WHERE 
                (date_fin < CURRENT_DATE AND statut = 'actif')
                OR (photo_abonne IS NULL OR photo_abonne = '')
                OR (prix_total <= 0)
                OR (date_fin IS NULL)
            GROUP BY 
                CASE 
                    WHEN date_fin < CURRENT_DATE AND statut = 'actif' THEN 'INCOHERENCE_STATUT'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'DOSSIER_INCOMPLET'
                    WHEN prix_total <= 0 THEN 'PRIX_ANORMAL'
                    WHEN date_fin IS NULL THEN 'DATE_MANQUANTE'
                END
        `);

        // 3. TAUX DE RECOMMANDATION ESTIMÉ (NPS)
        const npsEstime = await db.query(`
            WITH repartition AS (
                SELECT 
                    CASE 
                        WHEN COUNT(*) > 3 THEN 'Promoteur'
                        WHEN COUNT(*) = 1 THEN 'Détracteur'
                        ELSE 'Passif'
                    END as categorie
                FROM (
                    SELECT email, COUNT(*) as nb_achats
                    FROM clients
                    GROUP BY email
                ) as stats
            )
            SELECT 
                COUNT(CASE WHEN categorie = 'Promoteur' THEN 1 END) as promoteurs,
                COUNT(CASE WHEN categorie = 'Détracteur' THEN 1 END) as detracteurs,
                COUNT(*) as total_repondants,
                ROUND(
                    (COUNT(CASE WHEN categorie = 'Promoteur' THEN 1 END) - 
                     COUNT(CASE WHEN categorie = 'Détracteur' THEN 1 END)) * 100.0 / 
                    NULLIF(COUNT(*), 0), 1
                ) as nps_estime
            FROM repartition
        `);

        // 4. ANALYSE DES ABANDONS
        const analyseAbandons = await db.query(`
            SELECT 
                EXTRACT(MONTH FROM date_fin) as mois_abandon,
                type_abonnement,
                COUNT(*) as nb_abandons,
                AVG(prix_total) as montant_moyen_perdu
            FROM clients
            WHERE statut IN ('inactif', 'expire')
            AND date_fin > CURRENT_DATE - INTERVAL '6 months'
            GROUP BY EXTRACT(MONTH FROM date_fin), type_abonnement
            ORDER BY mois_abandon DESC, nb_abandons DESC
        `);

        res.json({
            success: true,
            data: {
                indicateurs_satisfaction: {
                    note_moyenne: parseFloat(satisfaction.rows[0]?.note_moyenne_estimee || 0).toFixed(1) + '/5',
                    clients_actifs: satisfaction.rows[0]?.clients_actifs,
                    taux_activite: ((satisfaction.rows[0]?.clients_actifs / satisfaction.rows[0]?.total_clients) * 100).toFixed(1) + '%'
                },
                points_douleur: pointsDouleur.rows,
                nps: {
                    score: parseFloat(npsEstime.rows[0]?.nps_estime || 0).toFixed(1),
                    promoteurs: npsEstime.rows[0]?.promoteurs,
                    detracteurs: npsEstime.rows[0]?.detracteurs,
                    interpretation: npsEstime.rows[0]?.nps_estime > 50 ? 'EXCELLENT' :
                                   npsEstime.rows[0]?.nps_estime > 30 ? 'BON' :
                                   npsEstime.rows[0]?.nps_estime > 0 ? 'MOYEN' : 'CRITIQUE'
                },
                analyse_abandons: analyseAbandons.rows,
                recommandations: genererRecommandationsSatisfaction(pointsDouleur.rows, analyseAbandons.rows)
            }
        });
    } catch (err) {
        console.error('Erreur Analyse Satisfaction:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 4. ANALYSE GÉOGRAPHIQUE ET DÉMOGRAPHIQUE
// ============================================

router.get('/analyse-demographique', async (req, res) => {
    try {
        // 1. RÉPARTITION GÉOGRAPHIQUE (basée sur les indicatifs téléphoniques)
        const repartitionGeo = await db.query(`
            SELECT 
                CASE 
                    WHEN telephone LIKE '+33%' THEN 'France'
                    WHEN telephone LIKE '+32%' THEN 'Belgique'
                    WHEN telephone LIKE '+41%' THEN 'Suisse'
                    WHEN telephone LIKE '+1%' THEN 'Amérique du Nord'
                    WHEN telephone LIKE '+44%' THEN 'Royaume-Uni'
                    WHEN telephone LIKE '+212%' OR telephone LIKE '+213%' OR telephone LIKE '+216%' THEN 'Afrique du Nord'
                    ELSE 'Autre'
                END as region,
                COUNT(*) as nb_clients,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as panier_moyen
            FROM clients
            WHERE telephone IS NOT NULL
            GROUP BY 
                CASE 
                    WHEN telephone LIKE '+33%' THEN 'France'
                    WHEN telephone LIKE '+32%' THEN 'Belgique'
                    WHEN telephone LIKE '+41%' THEN 'Suisse'
                    WHEN telephone LIKE '+1%' THEN 'Amérique du Nord'
                    WHEN telephone LIKE '+44%' THEN 'Royaume-Uni'
                    WHEN telephone LIKE '+212%' OR telephone LIKE '+213%' OR telephone LIKE '+216%' THEN 'Afrique du Nord'
                    ELSE 'Autre'
                END
            ORDER BY nb_clients DESC
        `);

        // 2. SEGMENTATION PAR ÂGE (basée sur les emails/domaines)
        const segmentationAge = await db.query(`
            SELECT 
                CASE 
                    WHEN email LIKE '%gmail%' OR email LIKE '%yahoo%' OR email LIKE '%hotmail%' THEN 'Grand Public'
                    WHEN email LIKE '%pro%' OR email LIKE '%entreprise%' OR email LIKE '%company%' THEN 'Professionnel'
                    WHEN email LIKE '%edu%' OR email LIKE '%universite%' OR email LIKE '%student%' THEN 'Étudiant'
                    ELSE 'Autre'
                END as segment,
                COUNT(*) as nb_clients,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as panier_moyen
            FROM clients
            GROUP BY 
                CASE 
                    WHEN email LIKE '%gmail%' OR email LIKE '%yahoo%' OR email LIKE '%hotmail%' THEN 'Grand Public'
                    WHEN email LIKE '%pro%' OR email LIKE '%entreprise%' OR email LIKE '%company%' THEN 'Professionnel'
                    WHEN email LIKE '%edu%' OR email LIKE '%universite%' OR email LIKE '%student%' THEN 'Étudiant'
                    ELSE 'Autre'
                END
            ORDER BY nb_clients DESC
        `);

        // 3. ANALYSE DES NOMS DE FAMILLE (tendances culturelles)
        const tendancesCulturelles = await db.query(`
            SELECT 
                SUBSTRING(nom FROM 1 FOR 1) as premiere_lettre,
                COUNT(*) as occurrences,
                AVG(prix_total) as depense_moyenne
            FROM clients
            GROUP BY SUBSTRING(nom FROM 1 FOR 1)
            ORDER BY occurrences DESC
            LIMIT 10
        `);

        // 4. SAISONNALITÉ DES INSCRIPTIONS PAR RÉGION
        const saisonnaliteRegion = await db.query(`
            SELECT 
                CASE 
                    WHEN telephone LIKE '+33%' THEN 'France'
                    WHEN telephone LIKE '+32%' THEN 'Belgique'
                    WHEN telephone LIKE '+41%' THEN 'Suisse'
                    ELSE 'International'
                END as region,
                EXTRACT(MONTH FROM date_debut) as mois,
                COUNT(*) as inscriptions
            FROM clients
            WHERE telephone IS NOT NULL
            GROUP BY region, EXTRACT(MONTH FROM date_debut)
            ORDER BY region, mois
        `);

        res.json({
            success: true,
            data: {
                repartition_geographique: repartitionGeo.rows,
                segmentation_professionnelle: segmentationAge.rows,
                tendances_culturelles: tendancesCulturelles.rows,
                saisonnalite_regionale: saisonnaliteRegion.rows,
                insights: {
                    region_plus_rentable: repartitionGeo.rows[0]?.region,
                    segment_plus_premium: segmentationAge.rows.sort((a,b) => b.panier_moyen - a.panier_moyen)[0]?.segment,
                    lettre_dominante: tendancesCulturelles.rows[0]?.premiere_lettre
                }
            }
        });
    } catch (err) {
        console.error('Erreur Analyse Démographique:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 5. ANALYSE DE LA PERFORMANCE COMMERCIALE
// ============================================

router.get('/performance-commerciale', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const debutMoisPrecedent = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().split('T')[0];
        const finMoisPrecedent = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0];

        // 1. PERFORMANCE COMMERCIALE DU MOIS
        const performanceMois = await db.query(`
            SELECT 
                COUNT(*) as nb_ventes,
                SUM(prix_total) as ca_total,
                AVG(prix_total) as panier_moyen,
                COUNT(DISTINCT email) as nouveaux_clients,
                COUNT(CASE WHEN email IN (
                    SELECT email FROM clients GROUP BY email HAVING COUNT(*) = 1
                ) THEN 1 END) as primo_accédants
            FROM clients
            WHERE date_debut >= $1
        `, [debutMois]);

        // 2. COMPARAISON MOIS PRÉCÉDENT
        const comparaisonMoisPrec = await db.query(`
            SELECT 
                COUNT(*) as nb_ventes,
                SUM(prix_total) as ca_total,
                AVG(prix_total) as panier_moyen
            FROM clients
            WHERE date_debut BETWEEN $1 AND $2
        `, [debutMoisPrecedent, finMoisPrecedent]);

        // 3. TAUX DE CONVERSION ESTIMÉ
        const tauxConversion = await db.query(`
            SELECT 
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as convertis,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente,
                ROUND(
                    COUNT(CASE WHEN statut = 'actif' THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 1
                ) as taux_conversion
            FROM clients
            WHERE date_debut >= $1
        `, [debutMois]);

        // 4. TOP PRODUITS/VENTES
        const topVentes = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nb_ventes,
                SUM(prix_total) as ca_genere,
                ROUND(AVG(prix_total), 2) as prix_moyen,
                COUNT(DISTINCT email) as clients_distincts
            FROM clients
            WHERE date_debut >= $1
            GROUP BY type_abonnement
            ORDER BY ca_genere DESC
        `, [debutMois]);

        // 5. VITESSE DE VENTE
        const vitesseVente = await db.query(`
            SELECT 
                EXTRACT(DOW FROM date_debut) as jour_semaine,
                COUNT(*) as ventes,
                AVG(prix_total) as panier_moyen
            FROM clients
            WHERE date_debut >= $1
            GROUP BY EXTRACT(DOW FROM date_debut)
            ORDER BY ventes DESC
        `, [debutMois]);

        // 6. PANIER MOYEN PAR TYPE DE CLIENT
        const panierParType = await db.query(`
            SELECT 
                CASE 
                    WHEN COUNT(*) OVER (PARTITION BY email) > 1 THEN 'Récurrent'
                    ELSE 'Nouveau'
                END as type_client,
                AVG(prix_total) as panier_moyen,
                COUNT(*) as nb_transactions
            FROM clients
            WHERE date_debut >= $1
            GROUP BY email, prix_total
        `, [debutMois]);

        res.json({
            success: true,
            data: {
                performance_mois: {
                    nb_ventes: parseInt(performanceMois.rows[0]?.nb_ventes || 0),
                    ca_total: parseFloat(performanceMois.rows[0]?.ca_total || 0),
                    panier_moyen: parseFloat(performanceMois.rows[0]?.panier_moyen || 0).toFixed(2),
                    nouveaux_clients: parseInt(performanceMois.rows[0]?.nouveaux_clients || 0),
                    primo_accedants: parseInt(performanceMois.rows[0]?.primo_accédants || 0)
                },
                comparaison_mois_precedent: {
                    evolution_ventes: ((performanceMois.rows[0]?.nb_ventes - comparaisonMoisPrec.rows[0]?.nb_ventes) / comparaisonMoisPrec.rows[0]?.nb_ventes * 100).toFixed(1) + '%',
                    evolution_ca: ((performanceMois.rows[0]?.ca_total - comparaisonMoisPrec.rows[0]?.ca_total) / comparaisonMoisPrec.rows[0]?.ca_total * 100).toFixed(1) + '%',
                    evolution_panier: ((performanceMois.rows[0]?.panier_moyen - comparaisonMoisPrec.rows[0]?.panier_moyen) / comparaisonMoisPrec.rows[0]?.panier_moyen * 100).toFixed(1) + '%'
                },
                taux_conversion: parseFloat(tauxConversion.rows[0]?.taux_conversion || 0).toFixed(1) + '%',
                top_ventes: topVentes.rows,
                vitesse_vente: vitesseVente.rows.map(v => ({
                    jour: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][v.jour_semaine],
                    ventes: v.ventes,
                    panier_moyen: v.panier_moyen
                })),
                panier_par_type: panierParType.rows,
                objectifs: {
                    objectif_mensuel: parseFloat(performanceMois.rows[0]?.ca_total || 0) * 1.2, // Objectif +20%
                    progression: ((performanceMois.rows[0]?.ca_total || 0) / (performanceMois.rows[0]?.ca_total * 1.2) * 100).toFixed(1) + '%'
                }
            }
        });
    } catch (err) {
        console.error('Erreur Performance Commerciale:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

function genererRecommandations(metrics) {
    const recommandations = [];
    
    if (metrics.churn > 10) {
        recommandations.push({
            priorite: 'HAUTE',
            action: 'Mettre en place un programme de fidélisation urgent',
            impact: 'Réduction du churn de 10-15%'
        });
    }
    
    if (metrics.retention < 70) {
        recommandations.push({
            priorite: 'MOYENNE',
            action: 'Améliorer l\'onboarding des nouveaux clients',
            impact: 'Augmentation de la rétention de 5-10%'
        });
    }
    
    if (metrics.satisfaction < 3.5) {
        recommandations.push({
            priorite: 'CRITIQUE',
            action: 'Lancer une enquête de satisfaction',
            impact: 'Identifier les points de friction'
        });
    }
    
    return recommandations;
}

function genererRecommandationsSatisfaction(pointsDouleur, abandons) {
    const recommandations = [];
    
    pointsDouleur.forEach(point => {
        if (point.type_probleme === 'INCOHERENCE_STATUT') {
            recommandations.push({
                probleme: 'Incohérence de statut',
                solution: 'Audit manuel des comptes concernés',
                urgence: 'IMMÉDIATE'
            });
        }
        if (point.type_probleme === 'DOSSIER_INCOMPLET') {
            recommandations.push({
                probleme: 'Dossiers incomplets',
                solution: 'Campagne de relance pour photos manquantes',
                urgence: 'MOYENNE'
            });
        }
    });
    
    return recommandations;
}

export default router;