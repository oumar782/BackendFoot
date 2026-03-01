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
// 1. ANALYSE DU TAUX DE CHURN (DÉSABONNEMENT)
// ============================================

router.get('/analyse-churn', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const datePast30 = getDateInPast(30);
        const datePast60 = getDateInPast(60);
        const datePast90 = getDateInPast(90);
        const datePast180 = getDateInPast(180);
        const datePast365 = getDateInPast(365);

        // 1. TAUX DE CHURN GLOBAL
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

        // 2. CHURN PAR PÉRIODE (mensuel, trimestriel, annuel)
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

        // 3. CHURN PAR TYPE D'ABONNEMENT
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

        // 4. CHURN PAR MOIS (évolution sur 12 mois)
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

        // 5. RAISONS DE CHURN ESTIMÉES (basées sur les données)
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

        // 6. COÛT DU CHURN (revenu perdu)
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

        // 7. TAUX DE RÉTENTION (inverse du churn)
        const tauxRetention = await db.query(`
            SELECT 
                ROUND(100 - AVG(taux_churn), 2) as taux_retention_moyen
            FROM (
                SELECT 
                    TO_CHAR(date_debut, 'YYYY-MM') as mois,
                    COUNT(CASE WHEN statut = 'actif' AND date_fin > CURRENT_DATE THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0) as taux_churn
                FROM clients
                GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ) as stats
        `);

        res.json({
            success: true,
            data: {
                churn_global: {
                    periode: '30 derniers jours',
                    desabonnes: parseInt(churnGlobal.rows[0]?.churn_periode || 0),
                    actifs_debut: parseInt(churnGlobal.rows[0]?.actifs_debut_periode || 0),
                    taux: parseFloat(churnGlobal.rows[0]?.taux_churn_periode || 0).toFixed(2) + '%',
                    interpretation: churnGlobal.rows[0]?.taux_churn_periode < 2 ? 'EXCELLENT' :
                                   churnGlobal.rows[0]?.taux_churn_periode < 5 ? 'BON' :
                                   churnGlobal.rows[0]?.taux_churn_periode < 8 ? 'MOYEN' : 'CRITIQUE'
                },
                churn_par_periode: churnParPeriode.rows,
                churn_par_type_abonnement: churnParType.rows,
                evolution_churn_mensuel: evolutionChurn.rows,
                raisons_churn: raisonsChurn.rows,
                cout_churn: {
                    revenu_perdu_mois: parseFloat(coutChurn.rows[0]?.revenu_total_perdu || 0).toFixed(2),
                    revenu_moyen_par_client_perdu: parseFloat(coutChurn.rows[0]?.revenu_moyen_perdu || 0).toFixed(2),
                    projection_perte_annuelle: parseFloat(coutChurn.rows[0]?.projection_annuelle_perte || 0).toFixed(2),
                    impact_financier: coutChurn.rows[0]?.revenu_total_perdu > 10000 ? 'ÉLEVÉ' : 'MODÉRÉ'
                },
                taux_retention: parseFloat(tauxRetention.rows[0]?.taux_retention_moyen || 0).toFixed(2) + '%'
            }
        });
    } catch (err) {
        console.error('Erreur Analyse Churn:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 2. SANTÉ FINANCIÈRE DES ABONNEMENTS
// ============================================

router.get('/sante-financiere', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const debutTrimestre = new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1).toISOString().split('T')[0];
        const debutAnnee = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
        const dateFuture90 = getDateInFuture(90);
        const dateFuture180 = getDateInFuture(180);
        const dateFuture365 = getDateInFuture(365);

        // 1. REVENUS RÉCURRENTS (MRR, ARR)
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

        // 2. RÉPARTITION DES REVENUS PAR TYPE D'ABONNEMENT
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

        // 3. REVENUS PAR STATUT
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

        // 4. PRÉVISION DE REVENUS (cashflow prévisionnel)
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

        // 5. VALEUR À VIE DU CLIENT (LTV) par cohorte
        const ltvParCohorte = await db.query(`
            WITH cohortes AS (
                SELECT 
                    DATE_TRUNC('month', date_debut) as cohorte,
                    email,
                    SUM(prix_total) as ltv
                FROM clients
                GROUP BY DATE_TRUNC('month', date_debut), email
            )
            SELECT 
                TO_CHAR(cohorte, 'YYYY-MM') as mois_cohorte,
                COUNT(*) as taille_cohorte,
                ROUND(AVG(ltv), 2) as ltv_moyenne,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ltv), 2) as ltv_mediane,
                ROUND(SUM(ltv), 2) as revenu_total_cohorte,
                ROUND(AVG(ltv) / NULLIF(AVG(CASE WHEN EXTRACT(MONTH FROM cohorte) = EXTRACT(MONTH FROM CURRENT_DATE) THEN ltv END), 0) * 100, 2) as progression_vs_mois_courant
            FROM cohortes
            GROUP BY cohorte
            ORDER BY cohorte DESC
            LIMIT 12
        `);

        // 6. TAUX DE RENOUVELLEMENT
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

        // 7. RENTABILITÉ PAR TYPE D'ABONNEMENT
        const rentabilite = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_ventes,
                SUM(prix_total) as revenu,
                AVG(prix_total) as prix_moyen,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                ROUND(COUNT(CASE WHEN statut = 'actif' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_retention,
                ROUND(SUM(prix_total) / NULLIF(COUNT(DISTINCT email), 0), 2) as revenu_par_client_unique
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement
            ORDER BY rentabilite DESC
        `);

        // 8. SANTÉ FINANCIÈRE GLOBALE (score)
        const mrr = parseFloat(revenusRecurrents.rows[0]?.mrr || 0);
        const arr = mrr * 12;
        const nbActifs = parseInt(revenusRecurrents.rows[0]?.nb_actifs || 0);
        const arpu = nbActifs > 0 ? mrr / nbActifs : 0;
        const ltvMoyenne = parseFloat(ltvParCohorte.rows[0]?.ltv_moyenne || 0);
        const ratioLtvCac = ltvMoyenne / (arpu * 0.3); // CAC estimé à 30% de l'ARPU

        let scoreSanteFinanciere = 100;
        if (mrr < 1000) scoreSanteFinanciere -= 20;
        if (arr < 12000) scoreSanteFinanciere -= 15;
        if (arpu < 50) scoreSanteFinanciere -= 10;
        if (ratioLtvCac < 3) scoreSanteFinanciere -= 25;
        if (parseFloat(tauxRenouvellement.rows[0]?.taux_renouvellement || 0) < 60) scoreSanteFinanciere -= 20;

        res.json({
            success: true,
            data: {
                revenus_clefs: {
                    mrr: parseFloat(mrr).toFixed(2),
                    arr: parseFloat(arr).toFixed(2),
                    arpu: parseFloat(arpu).toFixed(2),
                    ltv_moyenne: parseFloat(ltvMoyenne).toFixed(2),
                    ratio_ltv_cac: parseFloat(ratioLtvCac).toFixed(2),
                    interpretation_ratio: ratioLtvCac > 3 ? 'SAIN' : ratioLtvCac > 1 ? 'ACCEPTABLE' : 'RISQUÉ'
                },
                repartition_revenus: {
                    par_type_abonnement: revenusParType.rows,
                    par_statut: revenusParStatut.rows
                },
                previsionnel: previsionRevenus.rows,
                ltv_par_cohorte: ltvParCohorte.rows,
                taux_renouvellement: {
                    valeur: parseFloat(tauxRenouvellement.rows[0]?.taux_renouvellement || 0).toFixed(2) + '%',
                    ont_renouvele: parseInt(tauxRenouvellement.rows[0]?.ont_renouvele || 0),
                    total_expires: parseInt(tauxRenouvellement.rows[0]?.total_expires || 0)
                },
                rentabilite_par_type: rentabilite.rows,
                score_sante_financiere: {
                    score: Math.max(0, scoreSanteFinanciere),
                    niveau: scoreSanteFinanciere >= 80 ? 'EXCELLENT' :
                            scoreSanteFinanciere >= 60 ? 'BON' :
                            scoreSanteFinanciere >= 40 ? 'MOYEN' : 'CRITIQUE',
                    facteurs_amelioration: []
                }
            }
        });
    } catch (err) {
        console.error('Erreur Santé Financière:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 3. ALERTES CLIENTS À CONTACTER (EXPIRATION PROCHAINE)
// ============================================

router.get('/clients-a-contacter', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture3 = getDateInFuture(3);
        const dateFuture7 = getDateInFuture(7);
        const dateFuture15 = getDateInFuture(15);
        const dateFuture30 = getDateInFuture(30);

        // 1. URGENT - Expire dans les 3 jours
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
                DATEDIFF(day, CURRENT_DATE, date_fin) as jours_restants,
                CASE 
                    WHEN prix_total > 500 THEN 'VIP'
                    WHEN prix_total > 200 THEN 'PREMIUM'
                    ELSE 'STANDARD'
                END as priorite_client,
                'URGENT - Expire dans 3 jours' as motif_contact,
                'APPEL TELEPHONIQUE' as mode_contact_recommande
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            ORDER BY prix_total DESC, date_fin ASC
        `, [today, dateFuture3]);

        // 2. HAUTE PRIORITÉ - Expire dans 7 jours
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
                DATEDIFF(day, CURRENT_DATE, date_fin) as jours_restants,
                CASE 
                    WHEN prix_total > 500 THEN 'APPEL PRIORITAIRE'
                    ELSE 'EMAIL + SMS'
                END as mode_contact,
                'HAUTE PRIORITÉ - Expire dans 7 jours' as motif_contact
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $3 AND $4
            ORDER BY prix_total DESC, date_fin ASC
        `, [dateFuture3, dateFuture7]);

        // 3. PRIORITÉ MOYENNE - Expire dans 15 jours
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
                DATEDIFF(day, CURRENT_DATE, date_fin) as jours_restants,
                'EMAIL AUTOMATIQUE' as mode_contact,
                'MOYENNE - Expire dans 15 jours' as motif_contact
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $5 AND $6
            ORDER BY date_fin ASC
        `, [dateFuture7, dateFuture15]);

        // 4. PRIORITÉ FAIBLE - Expire dans 30 jours
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
                DATEDIFF(day, CURRENT_DATE, date_fin) as jours_restants,
                'EMAIL INFO' as mode_contact,
                'INFORMATION - Expire dans 30 jours' as motif_contact
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $7 AND $8
            ORDER BY date_fin ASC
        `, [dateFuture15, dateFuture30]);

        // 5. CLIENTS DÉJÀ EXPIRÉS (à relancer d'urgence)
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
                DATEDIFF(day, date_fin, CURRENT_DATE) as jours_depuis_expiration,
                'URGENCE ABSOLUE' as priorite,
                'OFFRE DE RETOUR SPÉCIALE' as action_recommandee
            FROM clients
            WHERE statut = 'actif'
            AND date_fin < $1
            ORDER BY date_fin DESC
        `, [today]);

        // 6. STATISTIQUES DE RELANCE
        const statsRelance = await db.query(`
            SELECT 
                COUNT(CASE WHEN date_fin BETWEEN $1 AND $2 AND statut = 'actif' THEN 1 END) as urgent_3j,
                COUNT(CASE WHEN date_fin BETWEEN $3 AND $4 AND statut = 'actif' THEN 1 END) as haute_priorite_7j,
                COUNT(CASE WHEN date_fin BETWEEN $5 AND $6 AND statut = 'actif' THEN 1 END) as moyenne_15j,
                COUNT(CASE WHEN date_fin BETWEEN $7 AND $8 AND statut = 'actif' THEN 1 END) as faible_30j,
                COUNT(CASE WHEN date_fin < $1 AND statut = 'actif' THEN 1 END) as deja_expires,
                ROUND(AVG(CASE WHEN date_fin BETWEEN $1 AND $8 AND statut = 'actif' THEN prix_total ELSE NULL END), 2) as panier_moyen_a_relancer
            FROM clients
        `, [today, dateFuture3, dateFuture3, dateFuture7, dateFuture7, dateFuture15, dateFuture15, dateFuture30]);

        // 7. SUGGESTIONS D'OFFRES PERSONNALISÉES
        const suggestionsOffres = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as clients_concernes,
                AVG(prix_total) as prix_moyen_actuel,
                ROUND(AVG(prix_total) * 0.9, 2) as offre_reduction_10,
                ROUND(AVG(prix_total) * 0.85, 2) as offre_fidelite_15,
                'Passer à ' || 
                CASE 
                    WHEN type_abonnement = 'mensuel' THEN 'trimestriel (économie 15%)'
                    WHEN type_abonnement = 'trimestriel' THEN 'semestriel (économie 20%)'
                    WHEN type_abonnement = 'semestriel' THEN 'annuel (économie 25%)'
                    ELSE 'offre supérieure'
                END as suggestion_upgrade
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            GROUP BY type_abonnement
        `, [today, dateFuture30]);

        res.json({
            success: true,
            data: {
                resume_contacts: {
                    total_a_contacter: 
                        parseInt(statsRelance.rows[0]?.urgent_3j || 0) +
                        parseInt(statsRelance.rows[0]?.haute_priorite_7j || 0) +
                        parseInt(statsRelance.rows[0]?.moyenne_15j || 0) +
                        parseInt(statsRelance.rows[0]?.faible_30j || 0) +
                        parseInt(statsRelance.rows[0]?.deja_expires || 0),
                    urgent: statsRelance.rows[0]?.urgent_3j || 0,
                    haute_priorite: statsRelance.rows[0]?.haute_priorite_7j || 0,
                    moyenne: statsRelance.rows[0]?.moyenne_15j || 0,
                    faible: statsRelance.rows[0]?.faible_30j || 0,
                    deja_expires: statsRelance.rows[0]?.deja_expires || 0,
                    panier_moyen: statsRelance.rows[0]?.panier_moyen_a_relancer || 0
                },
                listes_contacts: {
                    urgent_3j: urgent3Jours.rows,
                    haute_priorite_7j: hautePriorite7Jours.rows,
                    moyenne_15j: prioriteMoyenne15Jours.rows,
                    faible_30j: prioriteFaible30Jours.rows,
                    deja_expires: clientsExpires.rows
                },
                strategies_relance: suggestionsOffres.rows.map(offre => ({
                    type_abonnement: offre.type_abonnement,
                    clients_concernes: offre.clients_concernes,
                    offre_personnalisee: offre.suggestion_upgrade,
                    montant_propose: offre.offre_fidelite_15,
                    economie_potentielle: (offre.prix_moyen_actuel - offre.offre_fidelite_15).toFixed(2)
                })),
                calendrier_contacts: [
                    { date: today, action: 'Contacter URGENT', nombre: statsRelance.rows[0]?.urgent_3j },
                    { date: dateFuture3, action: 'Contacter HAUTE PRIORITÉ', nombre: statsRelance.rows[0]?.haute_priorite_7j },
                    { date: dateFuture7, action: 'Contacter MOYENNE', nombre: statsRelance.rows[0]?.moyenne_15j },
                    { date: dateFuture15, action: 'Contacter INFO', nombre: statsRelance.rows[0]?.faible_30j }
                ]
            }
        });
    } catch (err) {
        console.error('Erreur Clients à Contacter:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 4. ANALYSE DE COHORTE COMPLÈTE
// ============================================

router.get('/analyse-cohorte', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 1. MATRICE DE RÉTENTION PAR COHORTE MENSUELLE
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

        // 2. COHORTE PAR TYPE D'ABONNEMENT
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

        // 3. COHORTE PAR VALEUR (segmentation RFM simplifiée)
        const cohorteValeur = await db.query(`
            WITH segments AS (
                SELECT 
                    email,
                    CASE 
                        WHEN SUM(prix_total) > 1000 THEN 'VIP'
                        WHEN SUM(prix_total) > 500 THEN 'PREMIUM'
                        WHEN SUM(prix_total) > 200 THEN 'STANDARD'
                        ELSE 'BASIC'
                    END as segment_valeur,
                    MIN(date_debut) as premier_achat
                FROM clients
                GROUP BY email
            )
            SELECT 
                segment_valeur,
                DATE_TRUNC('month', premier_achat) as mois_acquisition,
                COUNT(*) as nb_clients,
                ROUND(AVG(ltv), 2) as ltv_moyenne
            FROM segments
            GROUP BY segment_valeur, DATE_TRUNC('month', premier_achat)
            ORDER BY mois_acquisition DESC, segment_valeur
        `);

        // 4. TAUX DE RÉTENTION PAR COHORTE (en pourcentage)
        const tauxRetentionCohorte = matriceRetention.rows.map(cohorte => {
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
        });

        // 5. DURÉE DE VIE MOYENNE PAR COHORTE
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

        res.json({
            success: true,
            data: {
                matrice_retention: tauxRetentionCohorte,
                cohorte_par_type: cohorteParType.rows,
                cohorte_par_valeur: cohorteValeur.rows,
                duree_vie_par_cohorte: dureeVieCohorte.rows,
                insights: {
                    meilleure_cohorte: tauxRetentionCohorte.sort((a,b) => 
                        parseFloat(b.retention.mois_3) - parseFloat(a.retention.mois_3)
                    )[0]?.cohorte,
                    pire_cohorte: tauxRetentionCohorte.sort((a,b) => 
                        parseFloat(a.retention.mois_3) - parseFloat(b.retention.mois_3)
                    )[0]?.cohorte,
                    retention_moyenne_m3: tauxRetentionCohorte.reduce((acc, curr) => 
                        acc + parseFloat(curr.retention.mois_3 || 0), 0
                    ) / tauxRetentionCohorte.length
                }
            }
        });
    } catch (err) {
        console.error('Erreur Analyse Cohorte:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 5. ÉTUDES SUPPLÉMENTAIRES (SURPRISES)
// ============================================

router.get('/etudes-surprises', async (req, res) => {
    try {
        // 1. CORRÉLATION ENTRE PRIX ET FIDÉLITÉ
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

        // 2. IMPACT DES RÉSERVATIONS SUR LA FIDÉLITÉ
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

        // 3. SAISONNALITÉ DES DÉSABONNEMENTS
        const saisonnaliteDesabonnement = await db.query(`
            SELECT 
                EXTRACT(MONTH FROM date_fin) as mois,
                COUNT(*) as desabonnements,
                AVG(prix_total) as prix_moyen_perdu
            FROM clients
            WHERE statut IN ('inactif', 'expire')
            AND date_fin IS NOT NULL
            GROUP BY EXTRACT(MONTH FROM date_fin)
            ORDER BY mois
        `);

        // 4. TOP 10 DES CLIENTS LES PLUS RENTABLES
        const topClientsRentables = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                COUNT(*) as nb_abonnements,
                SUM(prix_total) as depense_totale,
                AVG(prix_total) as panier_moyen,
                MAX(date_fin) as dernier_achat,
                ROUND(SUM(prix_total) / NULLIF(COUNT(*), 0), 2) as valeur_moyenne_par_achat
            FROM clients
            GROUP BY email, nom, prenom
            ORDER BY depense_totale DESC
            LIMIT 20
        `);

        // 5. ANALYSE DES CLIENTS "À RISQUE" (signal faible)
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
                    WHEN photo_abonne IS NULL THEN 'Photo manquante'
                    WHEN heure_reservation IS NULL AND statut = 'actif' THEN 'Jamais utilisé'
                    WHEN prix_total < (SELECT AVG(prix_total) * 0.5 FROM clients) THEN 'Prix anormalement bas'
                    ELSE 'OK'
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

        // 6. TAUX DE CROISSANCE (MoM)
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
                LAG(nouveaux) OVER (ORDER BY mois) as nouveaux_mois_prec,
                LAG(revenus) OVER (ORDER BY mois) as revenus_mois_prec,
                ROUND((nouveaux - LAG(nouveaux) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(nouveaux) OVER (ORDER BY mois), 0), 2) as croissance_nouveaux,
                ROUND((revenus - LAG(revenus) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(revenus) OVER (ORDER BY mois), 0), 2) as croissance_revenus
            FROM mois_consecutifs
        `);

        res.json({
            success: true,
            data: {
                correlation_prix_fidelite: correlationPrixFidelite.rows,
                impact_reservations: impactReservations.rows,
                saisonnalite_desabonnements: saisonnaliteDesabonnement.rows,
                top_clients_rentables: topClientsRentables.rows,
                signaux_faibles_risques: clientsRisquesSignauxFaibles.rows,
                taux_croissance: tauxCroissance.rows,
                insights_surprenants: {
                    meilleur_moment_pour_vendre: saisonnaliteDesabonnement.rows.sort((a,b) => b.desabonnements - a.desabonnements)[0]?.mois,
                    pire_moment: saisonnaliteDesabonnement.rows.sort((a,b) => a.desabonnements - b.desabonnements)[0]?.mois,
                    clients_a_surveiller: clientsRisquesSignauxFaibles.rows.length,
                    croissance_moyenne: tauxCroissance.rows.reduce((acc, curr) => acc + (parseFloat(curr.croissance_nouveaux) || 0), 0) / tauxCroissance.rows.length
                }
            }
        });
    } catch (err) {
        console.error('Erreur Études Surprises:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

// ============================================
// 6. TABLEAU DE BORD EXÉCUTIF COMPLET
// ============================================

router.get('/dashboard-executif-complet', async (req, res) => {
    try {
        // Récupérer toutes les analyses en parallèle
        const [
            churn,
            santeFinanciere,
            clientsAContacter,
            cohorte,
            etudesSurprises
        ] = await Promise.all([
            // On appelle les fonctions précédentes via des requêtes directes
            // (en pratique, vous pourriez factoriser le code)
            db.query(`
                SELECT 
                    COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as churn_mensuel,
                    COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                    ROUND(COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) * 100.0 / NULLIF(COUNT(CASE WHEN statut = 'actif' THEN 1 END), 0), 2) as taux_churn
                FROM clients
            `),
            db.query(`
                SELECT 
                    SUM(CASE WHEN statut = 'actif' THEN 
                        CASE 
                            WHEN type_abonnement = 'mensuel' THEN prix_total
                            WHEN type_abonnement = 'trimestriel' THEN prix_total / 3
                            WHEN type_abonnement = 'semestriel' THEN prix_total / 6
                            WHEN type_abonnement = 'annuel' THEN prix_total / 12
                            ELSE 0
                        END
                    ELSE 0 END) as mrr,
                    COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                    SUM(CASE WHEN statut = 'actif' THEN prix_total ELSE 0 END) as revenu_actifs
                FROM clients
            `),
            db.query(`
                SELECT 
                    COUNT(CASE WHEN date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND statut = 'actif' THEN 1 END) as a_contacter_7j,
                    COUNT(CASE WHEN date_fin < CURRENT_DATE AND statut = 'actif' THEN 1 END) as deja_expires
                FROM clients
            `),
            db.query(`
                SELECT 
                    DATE_TRUNC('month', date_debut) as cohorte,
                    COUNT(*) as taille,
                    AVG(CASE WHEN statut = 'actif' THEN 1 ELSE 0 END) as taux_retention
                FROM clients
                GROUP BY DATE_TRUNC('month', date_debut)
                ORDER BY cohorte DESC
                LIMIT 6
            `),
            db.query(`
                SELECT 
                    CASE 
                        WHEN prix_total < 100 THEN 'Petit budget'
                        WHEN prix_total < 300 THEN 'Budget moyen'
                        ELSE 'Premium'
                    END as segment,
                    AVG(CASE WHEN statut = 'actif' THEN 1 ELSE 0 END) as fidelite
                FROM clients
                GROUP BY 
                    CASE 
                        WHEN prix_total < 100 THEN 'Petit budget'
                        WHEN prix_total < 300 THEN 'Budget moyen'
                        ELSE 'Premium'
                    END
            `)
        ]);

        const mrr = parseFloat(santeFinanciere.rows[0]?.mrr || 0);
        const arr = mrr * 12;
        const actifs = parseInt(santeFinanciere.rows[0]?.actifs || 0);
        const arpu = actifs > 0 ? mrr / actifs : 0;

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: {
                resume_executif: {
                    date_analyse: new Date().toLocaleDateString('fr-FR'),
                    kpi_principaux: {
                        actifs: parseInt(churn.rows[0]?.actifs || 0),
                        churn_mensuel: parseFloat(churn.rows[0]?.taux_churn || 0).toFixed(2) + '%',
                        mrr: mrr.toFixed(2),
                        arr: arr.toFixed(2),
                        arpu: arpu.toFixed(2)
                    },
                    alertes: {
                        clients_a_contacter_7j: parseInt(clientsAContacter.rows[0]?.a_contacter_7j || 0),
                        clients_deja_expires: parseInt(clientsAContacter.rows[0]?.deja_expires || 0)
                    }
                },
                tendances: {
                    retention_cohortes: cohorte.rows,
                    fidelite_par_segment: etudesSurprises.rows
                },
                recommandations: [
                    {
                        priorite: clientsAContacter.rows[0]?.deja_expires > 0 ? 'URGENTE' : 'NORMALE',
                        action: clientsAContacter.rows[0]?.deja_expires > 0 ? 
                            'Contacter les clients expirés immédiatement' : 
                            'Préparer campagne de fidélisation',
                        impact: 'Potentiel de récupération élevé'
                    },
                    {
                        priorite: churn.rows[0]?.taux_churn > 5 ? 'HAUTE' : 'MOYENNE',
                        action: 'Analyser les raisons de churn et mettre en place des actions correctives',
                        impact: 'Réduction du churn de 10-15%'
                    },
                    {
                        priorite: arpu < 50 ? 'MOYENNE' : 'BASSE',
                        action: 'Optimiser la stratégie de prix pour augmenter l\'ARPU',
                        impact: 'Augmentation du MRR de 5-10%'
                    }
                ]
            }
        });
    } catch (err) {
        console.error('Erreur Dashboard Exécutif Complet:', err);
        res.status(500).json({ success: false, message: 'Erreur', error: err.message });
    }
});

export default router;