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
// API ULTIME - TOUTES LES ÉTUDES COMBINÉES
// ============================================

router.get('/ultime-complete', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const debutAnnee = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
        const dateFuture3 = getDateInFuture(3);
        const dateFuture7 = getDateInFuture(7);
        const dateFuture15 = getDateInFuture(15);
        const dateFuture30 = getDateInFuture(30);
        const dateFuture90 = getDateInFuture(90);
        const dateFuture365 = getDateInFuture(365);
        const datePast30 = getDateInPast(30);
        const datePast60 = getDateInPast(60);
        const datePast90 = getDateInPast(90);
        const datePast180 = getDateInPast(180);
        const datePast365 = getDateInPast(365);

        // ============================================
        // 1. MÉTRIQUES FONDAMENTALES (KPIs de base)
        // ============================================
        const [
            totalClients,
            actifsAujourdhui,
            inactifs,
            enAttente,
            expires,
            nouveauxMois,
            revenuMois,
            revenuAnnee,
            panierMoyen,
            clientsUniques
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as total FROM clients'),
            db.query(`SELECT COUNT(*) as actifs FROM clients WHERE statut = 'actif' AND date_fin >= $1`, [today]),
            db.query(`SELECT COUNT(*) as inactifs FROM clients WHERE statut = 'inactif'`),
            db.query(`SELECT COUNT(*) as en_attente FROM clients WHERE statut = 'en attente'`),
            db.query(`SELECT COUNT(*) as expires FROM clients WHERE statut = 'expire'`),
            db.query(`SELECT COUNT(*) as nouveaux FROM clients WHERE date_debut >= $1`, [debutMois]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as revenu FROM clients WHERE date_debut >= $1`, [debutMois]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as revenu FROM clients WHERE date_debut >= $1`, [debutAnnee]),
            db.query(`SELECT COALESCE(AVG(prix_total), 0) as moyen FROM clients WHERE prix_total > 0`),
            db.query(`SELECT COUNT(DISTINCT email) as uniques FROM clients`)
        ]);

        // ============================================
        // 2. ANALYSE COMPLÈTE DU CHURN (Désabonnement)
        // ============================================
        const churnGlobal = await db.query(`
            WITH churn_data AS (
                SELECT 
                    COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $1 THEN 1 END) as churn_periode,
                    COUNT(CASE WHEN statut = 'actif' AND date_debut > $1 THEN 1 END) as actifs_debut_periode
                FROM clients
            )
            SELECT 
                churn_periode,
                actifs_debut_periode,
                ROUND(churn_periode * 100.0 / NULLIF(actifs_debut_periode, 0), 2) as taux_churn_periode
            FROM churn_data
        `, [datePast30]);

        const churnParPeriode = await db.query(`
            SELECT 
                'Mensuel' as periode,
                COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $1 THEN 1 END) as perdus,
                COUNT(CASE WHEN statut = 'actif' AND date_debut > $1 THEN 1 END) as actifs,
                ROUND(COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $1 THEN 1 END) * 100.0 / 
                      NULLIF(COUNT(CASE WHEN statut = 'actif' AND date_debut > $1 THEN 1 END), 0), 2) as taux
            FROM clients
            UNION ALL
            SELECT 
                'Trimestriel' as periode,
                COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $2 THEN 1 END),
                COUNT(CASE WHEN statut = 'actif' AND date_debut > $2 THEN 1 END),
                ROUND(COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $2 THEN 1 END) * 100.0 / 
                      NULLIF(COUNT(CASE WHEN statut = 'actif' AND date_debut > $2 THEN 1 END), 0), 2)
            FROM clients
            UNION ALL
            SELECT 
                'Annuel' as periode,
                COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $3 THEN 1 END),
                COUNT(CASE WHEN statut = 'actif' AND date_debut > $3 THEN 1 END),
                ROUND(COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $3 THEN 1 END) * 100.0 / 
                      NULLIF(COUNT(CASE WHEN statut = 'actif' AND date_debut > $3 THEN 1 END), 0), 2)
            FROM clients
        `, [datePast30, datePast90, datePast365]);

        const churnParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(CASE WHEN statut IN ('inactif', 'expire') THEN 1 END) as perdus,
                ROUND(COUNT(CASE WHEN statut IN ('inactif', 'expire') THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_churn,
                AVG(CASE WHEN statut IN ('inactif', 'expire') THEN prix_total ELSE NULL END) as prix_moyen_perdus,
                AVG(CASE WHEN statut = 'actif' THEN prix_total ELSE NULL END) as prix_moyen_actifs
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement
            ORDER BY taux_churn DESC
        `);

        const evolutionChurn = await db.query(`
            WITH monthly_churn AS (
                SELECT 
                    TO_CHAR(date_fin, 'YYYY-MM') as mois,
                    COUNT(*) as churn_count
                FROM clients
                WHERE statut IN ('inactif', 'expire')
                AND date_fin > CURRENT_DATE - INTERVAL '12 months'
                GROUP BY TO_CHAR(date_fin, 'YYYY-MM')
            ),
            monthly_actifs AS (
                SELECT 
                    TO_CHAR(date_debut, 'YYYY-MM') as mois,
                    COUNT(*) as actifs_count
                FROM clients
                WHERE statut = 'actif'
                AND date_debut > CURRENT_DATE - INTERVAL '12 months'
                GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            )
            SELECT 
                COALESCE(c.mois, a.mois) as mois,
                COALESCE(c.churn_count, 0) as desabonnes,
                COALESCE(a.actifs_count, 0) as nouveaux_actifs,
                ROUND(COALESCE(c.churn_count, 0) * 100.0 / NULLIF(COALESCE(a.actifs_count, 0) + COALESCE(c.churn_count, 0), 0), 2) as taux_churn_mensuel
            FROM monthly_churn c
            FULL OUTER JOIN monthly_actifs a ON c.mois = a.mois
            ORDER BY mois DESC
        `);

        const raisonsChurn = await db.query(`
            SELECT 
                CASE 
                    WHEN prix_total < (SELECT AVG(prix_total) * 0.5 FROM clients) THEN 'Prix trop bas (clients peu engagés)'
                    WHEN date_fin - date_debut < 30 THEN 'Abonnement trop court'
                    WHEN heure_reservation IS NULL THEN 'Jamais utilisé le service'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'Profil incomplet'
                    ELSE 'Autre raison'
                END as raison_estimee,
                COUNT(*) as nombre,
                ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM clients WHERE statut IN ('inactif', 'expire')), 0), 2) as pourcentage
            FROM clients
            WHERE statut IN ('inactif', 'expire')
            GROUP BY 
                CASE 
                    WHEN prix_total < (SELECT AVG(prix_total) * 0.5 FROM clients) THEN 'Prix trop bas (clients peu engagés)'
                    WHEN date_fin - date_debut < 30 THEN 'Abonnement trop court'
                    WHEN heure_reservation IS NULL THEN 'Jamais utilisé le service'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'Profil incomplet'
                    ELSE 'Autre raison'
                END
            ORDER BY nombre DESC
        `);

        const coutChurn = await db.query(`
            SELECT 
                SUM(prix_total) as revenu_total_perdu,
                AVG(prix_total) as revenu_moyen_perdu,
                COUNT(*) as nombre_churn,
                SUM(prix_total) * 12 as projection_annuelle_perte
            FROM clients
            WHERE statut IN ('inactif', 'expire')
            AND date_fin > $1
        `, [datePast30]);

        // ============================================
        // 3. SANTÉ FINANCIÈRE COMPLÈTE
        // ============================================
        const revenusRecurrents = await db.query(`
            SELECT 
                SUM(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN
                    CASE 
                        WHEN type_abonnement = 'mensuel' THEN prix_total
                        WHEN type_abonnement = 'trimestriel' THEN prix_total / 3
                        WHEN type_abonnement = 'semestriel' THEN prix_total / 6
                        WHEN type_abonnement = 'annuel' THEN prix_total / 12
                        ELSE 0
                    END
                ELSE 0 END) as mrr,
                SUM(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN prix_total ELSE 0 END) as revenu_actifs_total,
                COUNT(DISTINCT CASE WHEN statut = 'actif' AND date_fin >= $1 THEN email END) as nb_actifs
            FROM clients
        `, [today]);

        const revenusParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as revenu_moyen,
                SUM(CASE WHEN statut = 'actif' THEN prix_total ELSE 0 END) as revenu_actifs,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                ROUND(AVG(CASE WHEN statut = 'actif' THEN prix_total ELSE NULL END), 2) as panier_moyen_actifs
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `);

        const revenusParStatut = await db.query(`
            SELECT 
                statut,
                COUNT(*) as nombre,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as revenu_moyen,
                ROUND(SUM(prix_total) * 100.0 / NULLIF((SELECT SUM(prix_total) FROM clients), 0), 2) as pourcentage_revenu
            FROM clients
            GROUP BY statut
            ORDER BY revenu_total DESC
        `);

        const previsionRevenus = await db.query(`
            WITH renouvellements AS (
                SELECT 
                    DATE_TRUNC('month', date_fin) as mois_renouvellement,
                    SUM(prix_total) as montant_renouvellement
                FROM clients
                WHERE statut = 'actif'
                AND date_fin BETWEEN $1 AND $2
                GROUP BY DATE_TRUNC('month', date_fin)
            ),
            nouveaux_abonnements AS (
                SELECT 
                    DATE_TRUNC('month', date_debut) as mois_inscription,
                    SUM(prix_total) as montant_nouveaux
                FROM clients
                WHERE date_debut BETWEEN $1 AND $2
                GROUP BY DATE_TRUNC('month', date_debut)
            )
            SELECT 
                COALESCE(TO_CHAR(r.mois_renouvellement, 'YYYY-MM'), TO_CHAR(n.mois_inscription, 'YYYY-MM')) as mois,
                COALESCE(r.montant_renouvellement, 0) as renouvellements,
                COALESCE(n.montant_nouveaux, 0) as nouveaux_abonnements,
                COALESCE(r.montant_renouvellement, 0) + COALESCE(n.montant_nouveaux, 0) as revenu_prevu
            FROM renouvellements r
            FULL OUTER JOIN nouveaux_abonnements n ON r.mois_renouvellement = n.mois_inscription
            ORDER BY mois
        `, [today, dateFuture365]);

        const tauxRenouvellement = await db.query(`
            WITH renouvellements AS (
                SELECT 
                    c1.email,
                    COUNT(c2.idclient) as a_renouvele
                FROM clients c1
                LEFT JOIN clients c2 ON c1.email = c2.email AND c2.date_debut > c1.date_fin
                WHERE c1.date_fin BETWEEN $1 AND $2
                GROUP BY c1.email
            )
            SELECT 
                COUNT(*) as total_expires,
                COUNT(CASE WHEN a_renouvele > 0 THEN 1 END) as ont_renouvele,
                ROUND(COUNT(CASE WHEN a_renouvele > 0 THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_renouvellement
            FROM renouvellements
        `, [datePast90, today]);

        // ============================================
        // 4. CLIENTS À CONTACTER (Expirations prochaines)
        // ============================================
        const urgent3Jours = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                TO_CHAR(date_fin, 'DD/MM/YYYY') as date_expiration,
                prix_total,
                EXTRACT(DAY FROM date_fin - CURRENT_DATE) as jours_restants,
                CASE 
                    WHEN prix_total > 500 THEN 'Très important'
                    WHEN prix_total > 200 THEN 'Important'
                    ELSE 'Standard'
                END as priorite_client,
                'Urgent - Expire dans 3 jours' as motif_contact,
                'Appel téléphonique recommandé' as mode_contact_recommande
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            ORDER BY prix_total DESC, date_fin ASC
        `, [today, dateFuture3]);

        const hautePriorite7Jours = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                TO_CHAR(date_fin, 'DD/MM/YYYY') as date_expiration,
                prix_total,
                EXTRACT(DAY FROM date_fin - CURRENT_DATE) as jours_restants,
                CASE 
                    WHEN prix_total > 500 THEN 'Appel prioritaire'
                    ELSE 'Courrier électronique et SMS'
                END as mode_contact,
                'Haute priorité - Expire dans 7 jours' as motif_contact
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            ORDER BY prix_total DESC, date_fin ASC
        `, [dateFuture3, dateFuture7]);

        const prioriteMoyenne15Jours = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                TO_CHAR(date_fin, 'DD/MM/YYYY') as date_expiration,
                prix_total,
                EXTRACT(DAY FROM date_fin - CURRENT_DATE) as jours_restants,
                'Courrier électronique automatique' as mode_contact,
                'Priorité moyenne - Expire dans 15 jours' as motif_contact
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            ORDER BY date_fin ASC
        `, [dateFuture7, dateFuture15]);

        const prioriteFaible30Jours = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                TO_CHAR(date_fin, 'DD/MM/YYYY') as date_expiration,
                prix_total,
                EXTRACT(DAY FROM date_fin - CURRENT_DATE) as jours_restants,
                'Courrier électronique informatif' as mode_contact,
                'Information - Expire dans 30 jours' as motif_contact
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            ORDER BY date_fin ASC
        `, [dateFuture15, dateFuture30]);

        const clientsExpires = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                TO_CHAR(date_fin, 'DD/MM/YYYY') as date_expiration,
                prix_total,
                EXTRACT(DAY FROM CURRENT_DATE - date_fin) as jours_depuis_expiration,
                'Urgence absolue' as priorite,
                'Offre de retour spéciale' as action_recommandee
            FROM clients
            WHERE statut = 'actif'
            AND date_fin < $1
            ORDER BY date_fin DESC
        `, [today]);

        // ============================================
        // 5. ANALYSE DE COHORTE COMPLÈTE
        // ============================================
        const matriceRetention = await db.query(`
            WITH cohortes AS (
                SELECT 
                    DATE_TRUNC('month', date_debut) as cohorte_mois,
                    email
                FROM clients
                GROUP BY DATE_TRUNC('month', date_debut), email
            ),
            activite_mensuelle AS (
                SELECT 
                    c.cohorte_mois,
                    c.email,
                    DATE_TRUNC('month', cl.date_debut) as mois_activite,
                    COUNT(*) as nb_activites
                FROM cohortes c
                JOIN clients cl ON cl.email = c.email
                GROUP BY c.cohorte_mois, c.email, DATE_TRUNC('month', cl.date_debut)
            )
            SELECT 
                TO_CHAR(cohorte_mois, 'YYYY-MM') as cohorte,
                COUNT(DISTINCT email) as taille_cohorte,
                COUNT(DISTINCT CASE WHEN mois_activite = cohorte_mois THEN email END) as mois_0,
                COUNT(DISTINCT CASE WHEN mois_activite = cohorte_mois + INTERVAL '1 month' THEN email END) as mois_1,
                COUNT(DISTINCT CASE WHEN mois_activite = cohorte_mois + INTERVAL '2 months' THEN email END) as mois_2,
                COUNT(DISTINCT CASE WHEN mois_activite = cohorte_mois + INTERVAL '3 months' THEN email END) as mois_3,
                COUNT(DISTINCT CASE WHEN mois_activite = cohorte_mois + INTERVAL '4 months' THEN email END) as mois_4,
                COUNT(DISTINCT CASE WHEN mois_activite = cohorte_mois + INTERVAL '5 months' THEN email END) as mois_5,
                COUNT(DISTINCT CASE WHEN mois_activite = cohorte_mois + INTERVAL '6 months' THEN email END) as mois_6
            FROM activite_mensuelle
            GROUP BY cohorte_mois
            ORDER BY cohorte_mois DESC
            LIMIT 12
        `);

        const cohorteParType = await db.query(`
            SELECT 
                type_abonnement,
                DATE_TRUNC('month', date_debut) as mois,
                COUNT(*) as inscriptions,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as toujours_actifs,
                ROUND(COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_retention
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement, DATE_TRUNC('month', date_debut)
            ORDER BY mois DESC, type_abonnement
        `, [today]);

        const dureeVieCohorte = await db.query(`
            SELECT 
                DATE_TRUNC('month', date_debut) as cohorte,
                AVG(EXTRACT(DAY FROM (date_fin - date_debut))) as duree_moyenne_jours,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(DAY FROM (date_fin - date_debut))) as duree_mediane_jours
            FROM clients
            WHERE date_fin IS NOT NULL
            GROUP BY DATE_TRUNC('month', date_debut)
            ORDER BY cohorte DESC
            LIMIT 12
        `);

        // ============================================
        // 6. ANALYSE PRÉDICTIVE
        // ============================================
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
                    WHEN AVG(inscriptions) > (SELECT AVG(inscriptions) * 1.2 FROM saisons) THEN 'Élevée'
                    WHEN AVG(inscriptions) < (SELECT AVG(inscriptions) * 0.8 FROM saisons) THEN 'Basse'
                    ELSE 'Normale'
                END as saisonnalite
            FROM saisons
            GROUP BY mois
            ORDER BY mois
        `);

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

        // ============================================
        // 7. ANALYSE DE LA SATISFACTION CLIENT
        // ============================================
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

        const pointsDouleur = await db.query(`
            SELECT 
                CASE 
                    WHEN date_fin < CURRENT_DATE AND statut = 'actif' THEN 'Incohérence de statut'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'Dossier incomplet'
                    WHEN prix_total <= 0 THEN 'Prix anormal'
                    WHEN date_fin IS NULL THEN 'Date manquante'
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
                    WHEN date_fin < CURRENT_DATE AND statut = 'actif' THEN 'Incohérence de statut'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'Dossier incomplet'
                    WHEN prix_total <= 0 THEN 'Prix anormal'
                    WHEN date_fin IS NULL THEN 'Date manquante'
                END
        `);

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

        // ============================================
        // 8. ANALYSE GÉOGRAPHIQUE ET DÉMOGRAPHIQUE
        // ============================================
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
                COUNT(*) as nombre_clients,
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
            ORDER BY nombre_clients DESC
        `);

        const segmentationAge = await db.query(`
            SELECT 
                CASE 
                    WHEN email LIKE '%gmail%' OR email LIKE '%yahoo%' OR email LIKE '%hotmail%' THEN 'Grand Public'
                    WHEN email LIKE '%pro%' OR email LIKE '%entreprise%' OR email LIKE '%company%' THEN 'Professionnel'
                    WHEN email LIKE '%edu%' OR email LIKE '%universite%' OR email LIKE '%student%' THEN 'Étudiant'
                    ELSE 'Autre'
                END as segment,
                COUNT(*) as nombre_clients,
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
            ORDER BY nombre_clients DESC
        `);

        // ============================================
        // 9. ANALYSE DE LA PERFORMANCE COMMERCIALE
        // ============================================
        const performanceMois = await db.query(`
            SELECT 
                COUNT(*) as nombre_ventes,
                SUM(prix_total) as chiffre_affaires_total,
                AVG(prix_total) as panier_moyen,
                COUNT(DISTINCT email) as nouveaux_clients
            FROM clients
            WHERE date_debut >= $1
        `, [debutMois]);

        const comparaisonMoisPrec = await db.query(`
            SELECT 
                COUNT(*) as nombre_ventes,
                SUM(prix_total) as chiffre_affaires_total,
                AVG(prix_total) as panier_moyen
            FROM clients
            WHERE date_debut BETWEEN $1 AND $2
        `, [datePast30, debutMois]);

        const topVentes = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_ventes,
                SUM(prix_total) as chiffre_affaires_genere,
                ROUND(AVG(prix_total), 2) as prix_moyen,
                COUNT(DISTINCT email) as clients_distincts
            FROM clients
            WHERE date_debut >= $1
            GROUP BY type_abonnement
            ORDER BY chiffre_affaires_genere DESC
        `, [debutMois]);

        // ============================================
        // 10. ÉTUDES SUPPLÉMENTAIRES (Surprises)
        // ============================================
        const correlationPrixFidelite = await db.query(`
            SELECT 
                CASE 
                    WHEN prix_total < 100 THEN 'Petit budget'
                    WHEN prix_total < 300 THEN 'Budget moyen'
                    WHEN prix_total < 500 THEN 'Budget élevé'
                    ELSE 'Premium'
                END as categorie_prix,
                AVG(CASE WHEN statut = 'actif' THEN 1 ELSE 0 END) as taux_fidelite,
                COUNT(*) as nombre_clients,
                AVG(EXTRACT(DAY FROM (COALESCE(date_fin, CURRENT_DATE) - date_debut))) as duree_moyenne_jours
            FROM clients
            GROUP BY 
                CASE 
                    WHEN prix_total < 100 THEN 'Petit budget'
                    WHEN prix_total < 300 THEN 'Budget moyen'
                    WHEN prix_total < 500 THEN 'Budget élevé'
                    ELSE 'Premium'
                END
            ORDER BY taux_fidelite DESC
        `);

        const impactReservations = await db.query(`
            SELECT 
                CASE 
                    WHEN heure_reservation IS NOT NULL THEN 'Avec réservation'
                    ELSE 'Sans réservation'
                END as type_usage,
                COUNT(*) as nombre,
                AVG(CASE WHEN statut = 'actif' THEN 1 ELSE 0 END) as taux_fidelite,
                AVG(prix_total) as panier_moyen,
                COUNT(DISTINCT email) as clients_uniques
            FROM clients
            GROUP BY CASE WHEN heure_reservation IS NOT NULL THEN 'Avec réservation' ELSE 'Sans réservation' END
        `);

        const saisonnaliteDesabonnement = await db.query(`
            SELECT 
                TO_CHAR(date_fin, 'Month') as mois,
                EXTRACT(MONTH FROM date_fin) as numero_mois,
                COUNT(*) as desabonnements,
                AVG(prix_total) as prix_moyen_perdu
            FROM clients
            WHERE statut IN ('inactif', 'expire')
            AND date_fin IS NOT NULL
            GROUP BY TO_CHAR(date_fin, 'Month'), EXTRACT(MONTH FROM date_fin)
            ORDER BY numero_mois
        `);

        const topClientsRentables = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                COUNT(*) as nombre_abonnements,
                SUM(prix_total) as depense_totale,
                AVG(prix_total) as panier_moyen,
                MAX(date_fin) as dernier_achat,
                ROUND(SUM(prix_total) / NULLIF(COUNT(*), 0), 2) as valeur_moyenne_par_achat
            FROM clients
            GROUP BY email, nom, prenom
            ORDER BY depense_totale DESC
            LIMIT 20
        `);

        const clientsRisquesSignauxFaibles = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                type_abonnement,
                prix_total,
                date_fin,
                CASE 
                    WHEN date_fin - CURRENT_DATE < 15 THEN 'Expiration proche'
                    WHEN photo_abonne IS NULL THEN 'Photographie manquante'
                    WHEN heure_reservation IS NULL AND statut = 'actif' THEN 'Jamais utilisé le service'
                    WHEN prix_total < (SELECT AVG(prix_total) * 0.5 FROM clients) THEN 'Prix anormalement bas'
                    ELSE 'Situation normale'
                END as signal_faible,
                CASE 
                    WHEN date_fin - CURRENT_DATE < 15 THEN 5
                    WHEN photo_abonne IS NULL THEN 3
                    WHEN heure_reservation IS NULL AND statut = 'actif' THEN 4
                    WHEN prix_total < (SELECT AVG(prix_total) * 0.5 FROM clients) THEN 2
                    ELSE 0
                END as niveau_risque
            FROM clients
            WHERE statut = 'actif'
            AND (
                date_fin - CURRENT_DATE < 15
                OR photo_abonne IS NULL
                OR (heure_reservation IS NULL AND statut = 'actif')
                OR prix_total < (SELECT AVG(prix_total) * 0.5 FROM clients)
            )
            ORDER BY niveau_risque DESC, date_fin ASC
            LIMIT 30
        `);

        const tauxCroissance = await db.query(`
            WITH mois_consecutifs AS (
                SELECT 
                    TO_CHAR(date_debut, 'YYYY-MM') as mois,
                    COUNT(*) as nouveaux,
                    SUM(prix_total) as revenus
                FROM clients
                WHERE date_debut > CURRENT_DATE - INTERVAL '6 months'
                GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
                ORDER BY mois
            )
            SELECT 
                mois,
                nouveaux,
                revenus,
                LAG(nouveaux) OVER (ORDER BY mois) as nouveaux_mois_precedent,
                LAG(revenus) OVER (ORDER BY mois) as revenus_mois_precedent,
                ROUND((nouveaux - LAG(nouveaux) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(nouveaux) OVER (ORDER BY mois), 0), 2) as croissance_nouveaux,
                ROUND((revenus - LAG(revenus) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(revenus) OVER (ORDER BY mois), 0), 2) as croissance_revenus
            FROM mois_consecutifs
        `);

        // ============================================
        // 11. ANALYSE DES TENDANCES (Dashboard Exécutif)
        // ============================================
        const evolutionHebdo = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'IW') as semaine,
                COUNT(*) as inscriptions,
                SUM(prix_total) as revenus
            FROM clients
            WHERE date_debut > $1
            GROUP BY TO_CHAR(date_debut, 'IW')
            ORDER BY semaine DESC
            LIMIT 8
        `, [datePast90]);

        const heuresAffluence = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation) as heure,
                COUNT(*) as nombre_reservations,
                AVG(prix_total) as panier_moyen
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation)
            ORDER BY nombre_reservations DESC
        `);

        // ============================================
        // 12. CALCUL DES MÉTRIQUES FINANCIÈRES AVANCÉES
        // ============================================
        const mrr = parseFloat(revenusRecurrents.rows[0]?.mrr || 0);
        const arr = mrr * 12;
        const nbActifs = parseInt(revenusRecurrents.rows[0]?.nb_actifs || 0);
        const arpu = nbActifs > 0 ? mrr / nbActifs : 0;
        const ltvMoyenne = parseFloat(predictionLTV.rows[0]?.ltv_moyenne || 0);
        const cacEstime = arpu * 0.3; // Estimation simplifiée du coût d'acquisition
        const ratioLtvCac = cacEstime > 0 ? ltvMoyenne / cacEstime : 0;

        // ============================================
        // 13. CALCUL DU SCORE DE SANTÉ GLOBAL
        // ============================================
        let scoreSante = 100;
        const tauxChurnValue = parseFloat(churnGlobal.rows[0]?.taux_churn_periode || 0);
        const tauxRenouvValue = parseFloat(tauxRenouvellement.rows[0]?.taux_renouvellement || 0);
        const tauxActifs = (actifsAujourdhui.rows[0]?.actifs / totalClients.rows[0]?.total) * 100;

        if (tauxChurnValue > 5) scoreSante -= 20;
        if (tauxRenouvValue < 60) scoreSante -= 15;
        if (arpu < 50) scoreSante -= 10;
        if (ltvMoyenne < 500) scoreSante -= 15;
        if (tauxActifs < 50) scoreSante -= 20;
        if (ratioLtvCac < 3) scoreSante -= 15;

        scoreSante = Math.max(0, Math.min(100, scoreSante));

        let niveauSante;
        if (scoreSante >= 85) niveauSante = 'Excellent';
        else if (scoreSante >= 70) niveauSante = 'Bon';
        else if (scoreSante >= 55) niveauSante = 'Moyen';
        else if (scoreSante >= 40) niveauSante = 'Faible';
        else niveauSante = 'Critique';

        // ============================================
        // 14. CONSTRUCTION DE LA RÉPONSE FINALE
        // ============================================
        const total = parseInt(totalClients.rows[0]?.total || 0);
        const actifs = parseInt(actifsAujourdhui.rows[0]?.actifs || 0);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            date_analyse: new Date().toLocaleDateString('fr-FR', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            data: {
                // ========================================
                // 1. RÉSUMÉ EXÉCUTIF (Vue d'ensemble)
                // ========================================
                resume_executif: {
                    metriques_principales: {
                        total_abonnes: total,
                        abonnes_actifs: actifs,
                        abonnes_inactifs: parseInt(inactifs.rows[0]?.inactifs || 0),
                        abonnes_en_attente: parseInt(enAttente.rows[0]?.en_attente || 0),
                        abonnes_expires: parseInt(expires.rows[0]?.expires || 0),
                        pourcentage_actifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0,
                        clients_uniques: parseInt(clientsUniques.rows[0]?.uniques || 0),
                        nouveaux_ce_mois: parseInt(nouveauxMois.rows[0]?.nouveaux || 0),
                        revenu_mensuel: parseFloat(revenuMois.rows[0]?.revenu || 0).toFixed(2),
                        revenu_annuel: parseFloat(revenuAnnee.rows[0]?.revenu || 0).toFixed(2),
                        panier_moyen: parseFloat(panierMoyen.rows[0]?.moyen || 0).toFixed(2)
                    },
                    kpis_financiers: {
                        mrr: mrr.toFixed(2),
                        arr: arr.toFixed(2),
                        arpu: arpu.toFixed(2),
                        ltv_moyenne: ltvMoyenne.toFixed(2),
                        cac_estime: cacEstime.toFixed(2),
                        ratio_ltv_cac: ratioLtvCac.toFixed(2),
                        interpretation_ratio: ratioLtvCac > 3 ? 'Sain' : ratioLtvCac > 1 ? 'Acceptable' : 'Risqué'
                    },
                    kpis_fidelite: {
                        taux_desabonnement_mensuel: parseFloat(tauxChurnValue).toFixed(2),
                        taux_retention: (100 - tauxChurnValue).toFixed(2),
                        taux_renouvellement: tauxRenouvValue.toFixed(2),
                        interpretation_churn: tauxChurnValue < 2 ? 'Excellent' : tauxChurnValue < 5 ? 'Bon' : tauxChurnValue < 8 ? 'Moyen' : 'Critique'
                    },
                    score_sante_globale: {
                        score: Math.round(scoreSante),
                        niveau: niveauSante,
                        interpretation: scoreSante >= 70 ? 'Entreprise en bonne santé' : 'Des actions correctives sont nécessaires'
                    }
                },

                // ========================================
                // 2. ANALYSE COMPLÈTE DU DÉSABONNEMENT
                // ========================================
                analyse_desabonnement: {
                    taux_global: parseFloat(tauxChurnValue).toFixed(2),
                    desabonnes_periode: parseInt(churnGlobal.rows[0]?.churn_periode || 0),
                    par_periode: churnParPeriode.rows,
                    par_type_abonnement: churnParType.rows,
                    evolution_mensuelle: evolutionChurn.rows,
                    raisons_estimees: raisonsChurn.rows,
                    cout_financier: {
                        revenu_perdu_mois: parseFloat(coutChurn.rows[0]?.revenu_total_perdu || 0).toFixed(2),
                        revenu_moyen_par_client_perdu: parseFloat(coutChurn.rows[0]?.revenu_moyen_perdu || 0).toFixed(2),
                        nombre_clients_perdus: parseInt(coutChurn.rows[0]?.nombre_churn || 0),
                        projection_perte_annuelle: parseFloat(coutChurn.rows[0]?.projection_annuelle_perte || 0).toFixed(2)
                    }
                },

                // ========================================
                // 3. SANTÉ FINANCIÈRE DÉTAILLÉE
                // ========================================
                sante_financiere: {
                    metriques_cles: {
                        mrr: mrr.toFixed(2),
                        arr: arr.toFixed(2),
                        arpu: arpu.toFixed(2),
                        ltv_moyenne: ltvMoyenne.toFixed(2),
                        ltv_mediane: parseFloat(predictionLTV.rows[0]?.ltv_mediane || 0).toFixed(2),
                        ltv_top_10: parseFloat(predictionLTV.rows[0]?.ltv_top_10 || 0).toFixed(2),
                        taux_renouvellement: tauxRenouvValue.toFixed(2),
                        ont_renouvele: parseInt(tauxRenouvellement.rows[0]?.ont_renouvele || 0),
                        total_expires: parseInt(tauxRenouvellement.rows[0]?.total_expires || 0)
                    },
                    repartition_revenus: {
                        par_type_abonnement: revenusParType.rows,
                        par_statut: revenusParStatut.rows
                    },
                    previsionnel_12_mois: previsionRevenus.rows,
                    analyse_rentabilite: {
                        par_categorie_prix: correlationPrixFidelite.rows,
                        impact_reservations: impactReservations.rows
                    }
                },

                // ========================================
                // 4. CLIENTS À CONTACTER (Alertes)
                // ========================================
                clients_a_contacter: {
                    resume: {
                        total_a_contacter: urgent3Jours.rows.length + hautePriorite7Jours.rows.length + prioriteMoyenne15Jours.rows.length + prioriteFaible30Jours.rows.length + clientsExpires.rows.length,
                        urgent_3_jours: urgent3Jours.rows.length,
                        haute_priorite_7_jours: hautePriorite7Jours.rows.length,
                        priorite_moyenne_15_jours: prioriteMoyenne15Jours.rows.length,
                        priorite_faible_30_jours: prioriteFaible30Jours.rows.length,
                        deja_expires: clientsExpires.rows.length
                    },
                    listes: {
                        urgent_3_jours: urgent3Jours.rows,
                        haute_priorite_7_jours: hautePriorite7Jours.rows,
                        priorite_moyenne_15_jours: prioriteMoyenne15Jours.rows,
                        priorite_faible_30_jours: prioriteFaible30Jours.rows,
                        deja_expires: clientsExpires.rows
                    }
                },

                // ========================================
                // 5. ANALYSE DE COHORTE
                // ========================================
                analyse_cohorte: {
                    matrice_retention: matriceRetention.rows.map(cohorte => {
                        const taille = parseInt(cohorte.taille_cohorte);
                        return {
                            cohorte: cohorte.cohorte,
                            taille,
                            retention: {
                                mois_0: '100%',
                                mois_1: taille > 0 ? ((cohorte.mois_1 / taille) * 100).toFixed(1) + '%' : '0%',
                                mois_2: taille > 0 ? ((cohorte.mois_2 / taille) * 100).toFixed(1) + '%' : '0%',
                                mois_3: taille > 0 ? ((cohorte.mois_3 / taille) * 100).toFixed(1) + '%' : '0%',
                                mois_4: taille > 0 ? ((cohorte.mois_4 / taille) * 100).toFixed(1) + '%' : '0%',
                                mois_5: taille > 0 ? ((cohorte.mois_5 / taille) * 100).toFixed(1) + '%' : '0%',
                                mois_6: taille > 0 ? ((cohorte.mois_6 / taille) * 100).toFixed(1) + '%' : '0%'
                            }
                        };
                    }),
                    par_type_abonnement: cohorteParType.rows,
                    duree_vie_par_cohorte: dureeVieCohorte.rows,
                    insights: {
                        meilleure_cohorte: matriceRetention.rows.sort((a,b) => 
                            parseFloat((b.mois_3 / b.taille_cohorte) * 100) - parseFloat((a.mois_3 / a.taille_cohorte) * 100)
                        )[0]?.cohorte,
                        pire_cohorte: matriceRetention.rows.sort((a,b) => 
                            parseFloat((a.mois_3 / a.taille_cohorte) * 100) - parseFloat((b.mois_3 / b.taille_cohorte) * 100)
                        )[0]?.cohorte
                    }
                },

                // ========================================
                // 6. ANALYSE PRÉDICTIVE
                // ========================================
                analyse_predictive: {
                    churn_prediction: {
                        facteurs_risque: facteursChurn.rows[0],
                        profil_churn: {
                            nombre_abonnements_moyen: parseFloat(facteursChurn.rows[0]?.nb_abonnements_churn || 0).toFixed(2),
                            montant_moyen: parseFloat(facteursChurn.rows[0]?.montant_moyen_churn || 0).toFixed(2)
                        },
                        profil_fidele: {
                            nombre_abonnements_moyen: parseFloat(facteursChurn.rows[0]?.nb_abonnements_fidele || 0).toFixed(2),
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
                    opportunites_croix_vente: opportunitesCrossSell.rows
                },

                // ========================================
                // 7. ANALYSE DE LA SATISFACTION CLIENT
                // ========================================
                analyse_satisfaction: {
                    indicateurs: {
                        note_moyenne: parseFloat(satisfaction.rows[0]?.note_moyenne_estimee || 0).toFixed(1) + '/5',
                        clients_actifs: satisfaction.rows[0]?.clients_actifs || 0,
                        taux_activite: ((satisfaction.rows[0]?.clients_actifs / satisfaction.rows[0]?.total_clients) * 100 || 0).toFixed(1) + '%'
                    },
                    points_douleur: pointsDouleur.rows,
                    nps_estime: {
                        score: parseFloat(npsEstime.rows[0]?.nps_estime || 0).toFixed(1),
                        promoteurs: npsEstime.rows[0]?.promoteurs || 0,
                        detracteurs: npsEstime.rows[0]?.detracteurs || 0,
                        interpretation: npsEstime.rows[0]?.nps_estime > 50 ? 'Excellent' :
                                       npsEstime.rows[0]?.nps_estime > 30 ? 'Bon' :
                                       npsEstime.rows[0]?.nps_estime > 0 ? 'Moyen' : 'Critique'
                    }
                },

                // ========================================
                // 8. ANALYSE GÉOGRAPHIQUE ET DÉMOGRAPHIQUE
                // ========================================
                analyse_geographique_demographique: {
                    repartition_geographique: repartitionGeo.rows,
                    segmentation_professionnelle: segmentationAge.rows,
                    saisonnalite_regionale: [], // À implémenter si nécessaire
                    insights: {
                        region_plus_rentable: repartitionGeo.rows[0]?.region || 'Non déterminé',
                        segment_plus_premium: segmentationAge.rows.sort((a,b) => b.panier_moyen - a.panier_moyen)[0]?.segment || 'Non déterminé'
                    }
                },

                // ========================================
                // 9. PERFORMANCE COMMERCIALE
                // ========================================
                performance_commerciale: {
                    mois_en_cours: {
                        nombre_ventes: parseInt(performanceMois.rows[0]?.nombre_ventes || 0),
                        chiffre_affaires: parseFloat(performanceMois.rows[0]?.chiffre_affaires_total || 0).toFixed(2),
                        panier_moyen: parseFloat(performanceMois.rows[0]?.panier_moyen || 0).toFixed(2),
                        nouveaux_clients: parseInt(performanceMois.rows[0]?.nouveaux_clients || 0)
                    },
                    comparaison_mois_precedent: {
                        evolution_ventes: comparaisonMoisPrec.rows[0]?.nombre_ventes ? 
                            ((performanceMois.rows[0]?.nombre_ventes - comparaisonMoisPrec.rows[0]?.nombre_ventes) / comparaisonMoisPrec.rows[0]?.nombre_ventes * 100).toFixed(1) + '%' : 'N/A',
                        evolution_chiffre_affaires: comparaisonMoisPrec.rows[0]?.chiffre_affaires_total ?
                            ((performanceMois.rows[0]?.chiffre_affaires_total - comparaisonMoisPrec.rows[0]?.chiffre_affaires_total) / comparaisonMoisPrec.rows[0]?.chiffre_affaires_total * 100).toFixed(1) + '%' : 'N/A',
                        evolution_panier: comparaisonMoisPrec.rows[0]?.panier_moyen ?
                            ((performanceMois.rows[0]?.panier_moyen - comparaisonMoisPrec.rows[0]?.panier_moyen) / comparaisonMoisPrec.rows[0]?.panier_moyen * 100).toFixed(1) + '%' : 'N/A'
                    },
                    top_ventes_par_type: topVentes.rows
                },

                // ========================================
                // 10. ÉTUDES SUPPLÉMENTAIRES (Surprises)
                // ========================================
                etudes_supplementaires: {
                    correlation_prix_fidelite: correlationPrixFidelite.rows,
                    impact_reservations: impactReservations.rows,
                    saisonnalite_desabonnements: saisonnaliteDesabonnement.rows,
                    top_clients_rentables: topClientsRentables.rows,
                    signaux_faibles_risques: clientsRisquesSignauxFaibles.rows,
                    taux_croissance: tauxCroissance.rows,
                    insights_surprenants: {
                        meilleur_mois_pour_vendre: saisonnaliteDesabonnement.rows.sort((a,b) => b.desabonnements - a.desabonnements)[0]?.mois,
                        pire_mois: saisonnaliteDesabonnement.rows.sort((a,b) => a.desabonnements - b.desabonnements)[0]?.mois,
                        clients_a_surveiller: clientsRisquesSignauxFaibles.rows.length,
                        croissance_moyenne_mensuelle: (tauxCroissance.rows.reduce((acc, curr) => acc + (parseFloat(curr.croissance_nouveaux) || 0), 0) / tauxCroissance.rows.length).toFixed(2) + '%'
                    }
                },

                // ========================================
                // 11. ANALYSE DES TENDANCES
                // ========================================
                analyse_tendances: {
                    hebdomadaires: evolutionHebdo.rows,
                    horaires: heuresAffluence.rows.map(h => ({
                        ...h,
                        heure: h.heure + 'h'
                    })),
                    meilleurs_clients: topClientsRentables.rows.slice(0, 5),
                    clients_a_risque: clientsRisquesSignauxFaibles.rows.slice(0, 5)
                },

                // ========================================
                // 12. RECOMMANDATIONS STRATÉGIQUES
                // ========================================
                recommandations_strategiques: [
                    {
                        priorite: urgent3Jours.rows.length > 0 ? 'Urgente' : 'Normale',
                        domaine: 'Fidélisation',
                        action: urgent3Jours.rows.length > 0 
                            ? `Contacter les ${urgent3Jours.rows.length} clients dont l'abonnement expire dans 3 jours`
                            : 'Préparer la campagne de fidélisation mensuelle',
                        impact: urgent3Jours.rows.length > 0 
                            ? `Potentiel de récupération de ${(urgent3Jours.rows.length * arpu * 3).toFixed(2)} €`
                            : 'Maintien du taux de rétention actuel',
                        delai: 'Immédiat'
                    },
                    {
                        priorite: tauxChurnValue > 5 ? 'Haute' : 'Moyenne',
                        domaine: 'Réduction du désabonnement',
                        action: `Analyser en profondeur la raison principale de désabonnement : "${raisonsChurn.rows[0]?.raison_estimee || 'Non déterminée'}"`,
                        impact: 'Réduction potentielle du taux de désabonnement de 15%',
                        delai: 'Cette semaine'
                    },
                    {
                        priorite: arpu < 50 ? 'Moyenne' : 'Basse',
                        domaine: 'Optimisation des revenus',
                        action: arpu < 50 
                            ? 'Optimiser la stratégie de prix pour augmenter le revenu moyen par utilisateur'
                            : 'Maintenir la stratégie de prix actuelle',
                        impact: arpu < 50 
                            ? `Augmentation potentielle du revenu mensuel de ${(arpu * 0.1 * nbActifs).toFixed(2)} €`
                            : 'Stabilité des revenus',
                        delai: 'Ce mois'
                    },
                    {
                        priorite: tauxRenouvValue < 60 ? 'Haute' : 'Normale',
                        domaine: 'Fidélisation',
                        action: tauxRenouvValue < 60
                            ? 'Mettre en place un programme de fidélisation pour améliorer le taux de renouvellement'
                            : 'Récompenser les clients fidèles avec des offres exclusives',
                        impact: tauxRenouvValue < 60
                            ? 'Amélioration potentielle de la valeur vie client de 25%'
                            : 'Renforcement de la relation client',
                        delai: 'Ce trimestre'
                    },
                    {
                        priorite: clientsRisquesSignauxFaibles.rows.length > 10 ? 'Moyenne' : 'Basse',
                        domaine: 'Prévention',
                        action: `Contacter préventivement les ${clientsRisquesSignauxFaibles.rows.length} clients présentant des signaux de risque`,
                        impact: 'Réduction du risque de désabonnement préventif',
                        delai: 'Dans les 15 jours'
                    },
                    {
                        priorite: ratioLtvCac < 3 ? 'Haute' : 'Basse',
                        domaine: 'Rentabilité',
                        action: ratioLtvCac < 3 
                            ? 'Optimiser le coût d\'acquisition client pour améliorer la rentabilité'
                            : 'Maintenir la stratégie d\'acquisition actuelle',
                        impact: 'Amélioration de la rentabilité globale',
                        delai: 'Ce trimestre'
                    }
                ]
            }
        });

    } catch (error) {
        console.error('Erreur dans l\'API ultime complète:', error);
        res.status(500).json({
            success: false,
            message: 'Une erreur est survenue lors de la récupération des données',
            error: error.message
        });
    }
});

export default router;