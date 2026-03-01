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

// Fonction pour formater les prix en Dirham
const formatPrixMAD = (prix) => {
    return new Intl.NumberFormat('fr-MA', {
        style: 'currency',
        currency: 'MAD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(prix).replace('MAD', 'DH').trim();
};

// ============================================
// API COMPLÈTE - TOUTES LES ÉTUDES AVEC CHAMPS RÉELS
// ============================================

router.get('/analyse-complete', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const dateFuture7 = getDateInFuture(7);
        const dateFuture15 = getDateInFuture(15);
        const dateFuture30 = getDateInFuture(30);
        const dateFuture90 = getDateInFuture(90);
        const datePast30 = getDateInPast(30);
        const datePast90 = getDateInPast(90);
        const datePast180 = getDateInPast(180);
        const datePast365 = getDateInPast(365);

        // ============================================
        // 1. STATISTIQUES GÉNÉRALES (KPI de base)
        // ============================================
        const statsGenerales = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as clients_actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as clients_inactifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as clients_en_attente,
                COUNT(CASE WHEN statut = 'expire' THEN 1 END) as clients_expires,
                COUNT(DISTINCT email) as emails_uniques,
                COALESCE(SUM(prix_total), 0) as chiffre_affaires_total,
                COALESCE(AVG(prix_total), 0) as panier_moyen
            FROM clients
        `);

        // ============================================
        // 2. ÉVOLUTION MENSUELLE (pour courbes)
        // ============================================
        const evolutionMensuelle = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(*) as nouveaux_clients,
                COALESCE(SUM(prix_total), 0) as revenus_mois
            FROM clients
            WHERE date_debut >= $1
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois DESC
            LIMIT 12
        `, [datePast365]);

        // ============================================
        // 3. ÉVOLUTION DU CHIFFRE D'AFFAIRES MENSUEL COMPARATIF
        // ============================================
        const evolutionCAMensuelle = await db.query(`
            WITH ca_mensuel AS (
                SELECT 
                    TO_CHAR(date_debut, 'YYYY-MM') as mois,
                    DATE_PART('year', date_debut) as annee,
                    DATE_PART('month', date_debut) as mois_num,
                    COALESCE(SUM(prix_total), 0) as ca_mois,
                    COUNT(*) as nombre_ventes,
                    COUNT(DISTINCT email) as nouveaux_clients,
                    LAG(COALESCE(SUM(prix_total), 0), 1) OVER (ORDER BY MIN(date_debut)) as ca_mois_precedent,
                    LAG(COALESCE(SUM(prix_total), 0), 12) OVER (ORDER BY MIN(date_debut)) as ca_annee_precedente
                FROM clients
                WHERE date_debut >= $1
                GROUP BY TO_CHAR(date_debut, 'YYYY-MM'), DATE_PART('year', date_debut), DATE_PART('month', date_debut)
            )
            SELECT 
                mois,
                ca_mois,
                ca_mois_precedent,
                ca_annee_precedente,
                CASE 
                    WHEN ca_mois_precedent > 0 
                    THEN ((ca_mois - ca_mois_precedent) / ca_mois_precedent * 100)
                    ELSE 0 
                END as evolution_mensuelle_pourcentage,
                CASE 
                    WHEN ca_annee_precedente > 0 
                    THEN ((ca_mois - ca_annee_precedente) / ca_annee_precedente * 100)
                    ELSE 0 
                END as evolution_annuelle_pourcentage,
                nombre_ventes,
                nouveaux_clients
            FROM ca_mensuel
            ORDER BY mois DESC
            LIMIT 24
        `, [datePast365]);

        // ============================================
        // 4. STATISTIQUES PAR TYPE D'ABONNEMENT
        // ============================================
        const statsParAbonnement = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as prix_moyen,
                MIN(prix_total) as prix_minimum,
                MAX(prix_total) as prix_maximum,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN statut = 'expire' THEN 1 END) as expires
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement
            ORDER BY nombre DESC
        `);

        // ============================================
        // 5. STATISTIQUES PAR MODE DE PAIEMENT
        // ============================================
        const statsParPaiement = await db.query(`
            SELECT 
                mode_paiement,
                COUNT(*) as nombre_transactions,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as montant_moyen
            FROM clients
            WHERE mode_paiement IS NOT NULL
            GROUP BY mode_paiement
            ORDER BY revenu_total DESC
        `);

        // ============================================
        // 6. ANALYSE DES HEURES DE RÉSERVATION
        // ============================================
        const heuresReservation = await db.query(`
            SELECT 
                heure_reservation,
                COUNT(*) as nombre_reservations,
                COUNT(DISTINCT email) as clients_uniques
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY heure_reservation
            ORDER BY nombre_reservations DESC
            LIMIT 10
        `);

        // ============================================
        // 7. TAUX DE DÉSABONNEMENT (CHURN) - Synthèse
        // ============================================
        const churnData = await db.query(`
            SELECT 
                COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $1 THEN 1 END) as desabonnes_mois,
                COUNT(CASE WHEN statut = 'actif' AND date_debut > $1 THEN 1 END) as nouveaux_actifs_mois,
                COUNT(CASE WHEN statut = 'actif' AND date_debut <= $1 AND (date_fin >= $1 OR date_fin IS NULL) THEN 1 END) as actifs_debut_mois
            FROM clients
        `, [datePast30]);

        // ============================================
        // 8. ÉTUDE CHURN APPROFONDIE
        // ============================================
        const etudeChurn = await db.query(`
            WITH churn_analysis AS (
                SELECT 
                    DATE_TRUNC('month', date_fin) as mois_desabonnement,
                    COUNT(*) as nb_desabonnements,
                    COALESCE(SUM(prix_total), 0) as revenu_perdu,
                    AVG(EXTRACT(EPOCH FROM (date_fin - date_debut)) / 86400) as duree_moyenne_abonnement,
                    COUNT(CASE WHEN (date_fin - date_debut) <= 30 THEN 1 END) as desabonnes_premiers_30j,
                    COUNT(CASE WHEN type_abonnement = 'premium' THEN 1 END) as premium_perdus,
                    COUNT(CASE WHEN type_abonnement = 'standard' THEN 1 END) as standard_perdus,
                    COUNT(CASE WHEN type_abonnement = 'essentiel' THEN 1 END) as essentiel_perdus
                FROM clients
                WHERE statut IN ('inactif', 'expire')
                AND date_fin >= $1
                GROUP BY DATE_TRUNC('month', date_fin)
            ),
            actifs_par_mois AS (
                SELECT 
                    DATE_TRUNC('month', date_debut) as mois_debut,
                    COUNT(*) as nouveaux_actifs
                FROM clients
                WHERE statut = 'actif'
                AND date_debut >= $1
                GROUP BY DATE_TRUNC('month', date_debut)
            )
            SELECT 
                TO_CHAR(ca.mois_desabonnement, 'YYYY-MM') as mois,
                ca.nb_desabonnements,
                ca.revenu_perdu,
                ROUND(ca.duree_moyenne_abonnement::numeric, 1) as duree_moyenne_abonnement,
                ca.desabonnes_premiers_30j,
                ca.premium_perdus,
                ca.standard_perdus,
                ca.essentiel_perdus,
                COALESCE(apm.nouveaux_actifs, 0) as nouveaux_actifs_mois,
                CASE 
                    WHEN COALESCE(apm.nouveaux_actifs, 0) > 0 
                    THEN (ca.nb_desabonnements::float / apm.nouveaux_actifs::float * 100)
                    ELSE 0 
                END as ratio_desabonnement_nouveaux
            FROM churn_analysis ca
            LEFT JOIN actifs_par_mois apm ON ca.mois_desabonnement = apm.mois_debut
            ORDER BY ca.mois_desabonnement DESC
        `, [datePast180]);

        // ============================================
        // 9. CLIENTS À CONTACTER (expirations)
        // ============================================
        const expirationsProchaines = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                TO_CHAR(date_fin, 'DD/MM/YYYY') as date_expiration,
                prix_total,
                (date_fin - CURRENT_DATE) as jours_restants,
                CASE 
                    WHEN (date_fin - CURRENT_DATE) <= 7 THEN 'Urgent'
                    WHEN (date_fin - CURRENT_DATE) <= 15 THEN 'À relancer'
                    ELSE 'Information'
                END as priorite
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            ORDER BY date_fin ASC
        `);

        // ============================================
        // 10. CLIENT LE PLUS PERFORMANT
        // ============================================
        const clientPlusPerformant = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                COUNT(*) as nombre_abonnements,
                COALESCE(SUM(prix_total), 0) as total_depense,
                COALESCE(AVG(prix_total), 0) as depense_moyenne,
                MIN(date_debut) as premier_abonnement,
                MAX(date_fin) as dernier_abonnement,
                CASE 
                    WHEN MAX(date_fin) >= CURRENT_DATE THEN 'Actif'
                    ELSE 'Inactif'
                END as statut_actuel,
                (MAX(date_fin) - MIN(date_debut)) as duree_totale_jours
            FROM clients
            GROUP BY idclient, nom, prenom, email, telephone, type_abonnement
            ORDER BY total_depense DESC
            LIMIT 1
        `);

        // ============================================
        // 11. TOP CLIENTS (performance commerciale)
        // ============================================
        const topClients = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                COUNT(*) as nombre_abonnements,
                COALESCE(SUM(prix_total), 0) as total_depense,
                MAX(date_fin) as dernier_abonnement
            FROM clients
            GROUP BY nom, prenom, email
            ORDER BY total_depense DESC
            LIMIT 20
        `);

        // ============================================
        // 12. PERFORMANCE COMMERCIALE DU MOIS
        // ============================================
        const performanceMois = await db.query(`
            SELECT 
                COUNT(*) as nombre_ventes,
                COALESCE(SUM(prix_total), 0) as chiffre_affaires,
                COALESCE(AVG(prix_total), 0) as panier_moyen,
                COUNT(DISTINCT email) as nouveaux_clients
            FROM clients
            WHERE date_debut >= $1
        `, [debutMois]);

        // ============================================
        // 13. COMPARAISON AVEC MOIS PRÉCÉDENT
        // ============================================
        const comparaisonMoisPrec = await db.query(`
            SELECT 
                COUNT(*) as nombre_ventes,
                COALESCE(SUM(prix_total), 0) as chiffre_affaires
            FROM clients
            WHERE date_debut BETWEEN $1 AND $2
        `, [datePast30, debutMois]);

        // ============================================
        // 14. STATISTIQUES PAR STATUT (détaillées)
        // ============================================
        const statsParStatut = await db.query(`
            SELECT 
                statut,
                COUNT(*) as nombre_clients,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as panier_moyen,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservation
            FROM clients
            GROUP BY statut
            ORDER BY nombre_clients DESC
        `);

        // ============================================
        // 15. RÉPARTITION PAR TRANCHE DE PRIX
        // ============================================
        const tranchesPrix = await db.query(`
            SELECT 
                CASE 
                    WHEN prix_total < 100 THEN 'Moins de 100'
                    WHEN prix_total < 300 THEN '100 - 300'
                    WHEN prix_total < 500 THEN '301 - 500'
                    WHEN prix_total >= 500 THEN 'Plus de 500'
                    ELSE 'Non renseigné'
                END as tranche,
                COUNT(*) as nombre_clients,
                COALESCE(SUM(prix_total), 0) as revenu_tranche
            FROM clients
            GROUP BY 
                CASE 
                    WHEN prix_total < 100 THEN 'Moins de 100'
                    WHEN prix_total < 300 THEN '100 - 300'
                    WHEN prix_total < 500 THEN '301 - 500'
                    WHEN prix_total >= 500 THEN 'Plus de 500'
                    ELSE 'Non renseigné'
                END
            ORDER BY revenu_tranche DESC
        `);

        // ============================================
        // 16. ÉVOLUTION DES STATUTS
        // ============================================
        const evolutionStatuts = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN statut = 'expire' THEN 1 END) as expires
            FROM clients
            WHERE date_debut >= $1
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois DESC
            LIMIT 6
        `, [datePast180]);

        // ============================================
        // 17. ANALYSE DE SATISFACTION
        // ============================================
        const satisfactionData = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as clients_actifs,
                COUNT(CASE WHEN heure_reservation IS NULL AND statut = 'actif' THEN 1 END) as clients_inactifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente_validation
            FROM clients
        `);

        // ============================================
        // 18. ANALYSE DÉMOGRAPHIQUE
        // ============================================
        const repartitionGeo = await db.query(`
            SELECT 
                CASE 
                    WHEN telephone LIKE '+33%' THEN 'France'
                    WHEN telephone LIKE '+32%' THEN 'Belgique'
                    WHEN telephone LIKE '+41%' THEN 'Suisse'
                    WHEN telephone LIKE '+1%' THEN 'Amérique du Nord'
                    WHEN telephone LIKE '+44%' THEN 'Royaume-Uni'
                    ELSE 'Autre'
                END as region,
                COUNT(*) as nombre_clients,
                COALESCE(SUM(prix_total), 0) as revenu_total
            FROM clients
            WHERE telephone IS NOT NULL
            GROUP BY 
                CASE 
                    WHEN telephone LIKE '+33%' THEN 'France'
                    WHEN telephone LIKE '+32%' THEN 'Belgique'
                    WHEN telephone LIKE '+41%' THEN 'Suisse'
                    WHEN telephone LIKE '+1%' THEN 'Amérique du Nord'
                    WHEN telephone LIKE '+44%' THEN 'Royaume-Uni'
                    ELSE 'Autre'
                END
            ORDER BY nombre_clients DESC
        `);

        // ============================================
        // 19. ANALYSE DES TENDANCES HEBDOMADAIRES
        // ============================================
        const tendancesHebdo = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'IW') as semaine,
                COUNT(*) as inscriptions,
                COALESCE(SUM(prix_total), 0) as revenus
            FROM clients
            WHERE date_debut > $1
            GROUP BY TO_CHAR(date_debut, 'IW')
            ORDER BY semaine DESC
            LIMIT 8
        `, [datePast90]);

        // ============================================
        // 20. PRÉVISION DES RENOUVELLEMENTS
        // ============================================
        const renouvellementsPrevus = await db.query(`
            SELECT 
                TO_CHAR(date_fin, 'YYYY-MM') as mois,
                COUNT(*) as nb_renouvellements,
                COALESCE(SUM(prix_total), 0) as montant_total
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            GROUP BY TO_CHAR(date_fin, 'YYYY-MM')
            ORDER BY mois
        `, [today, dateFuture90]);

        // ============================================
        // CALCUL DES MÉTRIQUES FINANCIÈRES
        // ============================================
        const total = parseInt(statsGenerales.rows[0]?.total_clients || 0);
        const actifs = parseInt(statsGenerales.rows[0]?.clients_actifs || 0);
        const caTotal = parseFloat(statsGenerales.rows[0]?.chiffre_affaires_total || 0);
        const caMois = parseFloat(performanceMois.rows[0]?.chiffre_affaires || 0);
        
        const desabonnesMois = parseInt(churnData.rows[0]?.desabonnes_mois || 0);
        const actifsDebutMois = parseInt(churnData.rows[0]?.actifs_debut_mois || 1);
        const tauxDesabonnement = (desabonnesMois / actifsDebutMois * 100).toFixed(2);
        
        const caMoisPrec = parseFloat(comparaisonMoisPrec.rows[0]?.chiffre_affaires || 0);
        const evolutionCA = caMoisPrec > 0 ? ((caMois - caMoisPrec) / caMoisPrec * 100).toFixed(1) : 0;

        const topClient = clientPlusPerformant.rows[0] || null;
        const topClientFormatted = topClient ? {
            ...topClient,
            total_depense_formate: formatPrixMAD(topClient.total_depense),
            depense_moyenne_formate: formatPrixMAD(topClient.depense_moyenne)
        } : null;

        // ============================================
        // CONSTRUCTION DE LA RÉPONSE FINALE
        // ============================================
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
            
            resume_executif: {
                metriques_principales: {
                    total_clients: total,
                    clients_actifs: actifs,
                    clients_inactifs: parseInt(statsGenerales.rows[0]?.clients_inactifs || 0),
                    clients_en_attente: parseInt(statsGenerales.rows[0]?.clients_en_attente || 0),
                    clients_expires: parseInt(statsGenerales.rows[0]?.clients_expires || 0),
                    pourcentage_actifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0
                },
                chiffre_affaires: {
                    total: formatPrixMAD(caTotal),
                    mois_en_cours: formatPrixMAD(caMois),
                    evolution_mensuelle: evolutionCA + '%',
                    panier_moyen: formatPrixMAD(parseFloat(statsGenerales.rows[0]?.panier_moyen || 0))
                },
                indicateurs_cles: {
                    taux_desabonnement_mensuel: tauxDesabonnement + '%',
                    nouveaux_clients_mois: parseInt(churnData.rows[0]?.nouveaux_actifs_mois || 0),
                    clients_a_contacter: expirationsProchaines.rows.length,
                    renouvellements_prevus_3mois: renouvellementsPrevus.rows.reduce((acc, r) => acc + parseInt(r.nb_renouvellements), 0)
                },
                client_plus_performant: topClientFormatted
            },

            evolution_ca_mensuelle: {
                donnees: evolutionCAMensuelle.rows.map(row => ({
                    ...row,
                    ca_mois: formatPrixMAD(row.ca_mois),
                    ca_mois_precedent: row.ca_mois_precedent ? formatPrixMAD(row.ca_mois_precedent) : null,
                    ca_annee_precedente: row.ca_annee_precedente ? formatPrixMAD(row.ca_annee_precedente) : null,
                    evolution_mensuelle_pourcentage: parseFloat(row.evolution_mensuelle_pourcentage || 0).toFixed(2),
                    evolution_annuelle_pourcentage: parseFloat(row.evolution_annuelle_pourcentage || 0).toFixed(2)
                }))
            },

            etude_churn: {
                donnees_mensuelles: etudeChurn.rows.map(row => ({
                    ...row,
                    revenu_perdu: formatPrixMAD(row.revenu_perdu),
                    taux_premiers_30j: ((row.desabonnes_premiers_30j / row.nb_desabonnements) * 100).toFixed(2) + '%'
                })),
                analyse_globale: {
                    total_desabonnes_6mois: etudeChurn.rows.reduce((acc, row) => acc + parseInt(row.nb_desabonnements || 0), 0),
                    revenu_total_perdu_6mois: formatPrixMAD(etudeChurn.rows.reduce((acc, row) => acc + parseFloat(row.revenu_perdu || 0), 0))
                }
            },

            tendances: {
                evolution_mensuelle: evolutionMensuelle.rows.map(row => ({
                    ...row,
                    revenus_mois: formatPrixMAD(row.revenus_mois)
                })),
                evolution_statuts: evolutionStatuts.rows,
                tendances_hebdomadaires: tendancesHebdo.rows.map(row => ({
                    ...row,
                    revenus: formatPrixMAD(row.revenus)
                })),
                heures_populaires: heuresReservation.rows
            },

            commercial: {
                performance_mois: {
                    ventes: parseInt(performanceMois.rows[0]?.nombre_ventes || 0),
                    chiffre_affaires: formatPrixMAD(parseFloat(performanceMois.rows[0]?.chiffre_affaires || 0)),
                    panier_moyen: formatPrixMAD(parseFloat(performanceMois.rows[0]?.panier_moyen || 0)),
                    nouveaux_clients: parseInt(performanceMois.rows[0]?.nouveaux_clients || 0)
                },
                comparaison_mois_precedent: {
                    ventes_precedent: parseInt(comparaisonMoisPrec.rows[0]?.nombre_ventes || 0),
                    ca_precedent: formatPrixMAD(parseFloat(comparaisonMoisPrec.rows[0]?.chiffre_affaires || 0))
                },
                top_clients: topClients.rows.slice(0, 10).map(client => ({
                    ...client,
                    total_depense: formatPrixMAD(client.total_depense)
                })),
                par_type_abonnement: statsParAbonnement.rows.map(row => ({
                    ...row,
                    revenu_total: formatPrixMAD(row.revenu_total),
                    prix_moyen: formatPrixMAD(row.prix_moyen)
                })),
                par_mode_paiement: statsParPaiement.rows.map(row => ({
                    ...row,
                    revenu_total: formatPrixMAD(row.revenu_total),
                    montant_moyen: formatPrixMAD(row.montant_moyen)
                }))
            },

            clients: {
                repartition_par_statut: statsParStatut.rows.map(row => ({
                    ...row,
                    revenu_total: formatPrixMAD(row.revenu_total),
                    panier_moyen: formatPrixMAD(row.panier_moyen)
                })),
                repartition_par_tranche_prix: tranchesPrix.rows.map(row => ({
                    ...row,
                    revenu_tranche: formatPrixMAD(row.revenu_tranche)
                })),
                repartition_geographique: repartitionGeo.rows.map(row => ({
                    ...row,
                    revenu_total: formatPrixMAD(row.revenu_total)
                }))
            },

            actions: {
                clients_a_contacter: expirationsProchaines.rows.map(client => ({
                    ...client,
                    prix_total: formatPrixMAD(client.prix_total)
                })),
                renouvellements_prevus: renouvellementsPrevus.rows.map(row => ({
                    ...row,
                    montant_total: formatPrixMAD(row.montant_total)
                })),
                alertes: {
                    expirations_urgentes: expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length,
                    expirations_prochaines: expirationsProchaines.rows.filter(c => c.priorite === 'À relancer').length
                }
            },

            satisfaction: {
                indicateurs: {
                    taux_activite: total > 0 ? ((satisfactionData.rows[0]?.clients_actifs || 0) / total * 100).toFixed(1) + '%' : '0%',
                    clients_actifs: satisfactionData.rows[0]?.clients_actifs || 0,
                    clients_inactifs: satisfactionData.rows[0]?.clients_inactifs || 0,
                    en_attente_validation: satisfactionData.rows[0]?.en_attente_validation || 0
                }
            },

            previsions: {
                renouvellements_3_mois: renouvellementsPrevus.rows.map(row => ({
                    ...row,
                    montant_total: formatPrixMAD(row.montant_total)
                })),
                montant_total_renouvellements: formatPrixMAD(
                    renouvellementsPrevus.rows.reduce((acc, r) => acc + parseFloat(r.montant_total), 0)
                )
            },

            recommandations: [
                {
                    priorite: expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length > 0 ? 'Haute' : 'Normale',
                    domaine: 'Fidélisation',
                    action: expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length > 0 
                        ? `Contacter d'urgence les ${expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length} clients`
                        : 'Aucune expiration urgente',
                    impact: 'Maintien du taux de rétention'
                },
                {
                    priorite: parseFloat(tauxDesabonnement) > 5 ? 'Haute' : 'Moyenne',
                    domaine: 'Rétention',
                    action: parseFloat(tauxDesabonnement) > 5
                        ? 'Mettre en place un programme de fidélisation'
                        : 'Taux de désabonnement sous contrôle',
                    impact: 'Réduction du taux de désabonnement'
                }
            ],

            metriques_financieres: {
                total_revenus: formatPrixMAD(caTotal),
                panier_moyen_global: formatPrixMAD(parseFloat(statsGenerales.rows[0]?.panier_moyen || 0))
            }
        });

    } catch (error) {
        console.error('Erreur API analyse-complete:', error);
        res.status(500).json({
            success: false,
            message: 'Une erreur est survenue',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINT SIMPLIFIÉ POUR TEST
// ============================================
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'API fonctionnelle',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// ENDPOINT POUR LE CLIENT LE PLUS PERFORMANT
// ============================================
router.get('/top-client', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                idclient,
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                COUNT(*) as nombre_abonnements,
                COALESCE(SUM(prix_total), 0) as total_depense,
                COALESCE(AVG(prix_total), 0) as depense_moyenne,
                MIN(date_debut) as premier_abonnement,
                MAX(date_fin) as dernier_abonnement,
                CASE 
                    WHEN MAX(date_fin) >= CURRENT_DATE THEN 'Actif'
                    ELSE 'Inactif'
                END as statut_actuel
            FROM clients
            GROUP BY idclient, nom, prenom, email, telephone, type_abonnement
            ORDER BY total_depense DESC
            LIMIT 1
        `);

        if (result.rows.length > 0) {
            const client = result.rows[0];
            res.json({
                success: true,
                client: {
                    ...client,
                    total_depense_formate: formatPrixMAD(client.total_depense),
                    depense_moyenne_formate: formatPrixMAD(client.depense_moyenne)
                }
            });
        } else {
            res.json({
                success: true,
                message: "Aucun client trouvé",
                client: null
            });
        }
    } catch (error) {
        console.error('Erreur API top-client:', error);
        res.status(500).json({
            success: false,
            message: 'Une erreur est survenue',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINT POUR L'ÉTUDE CHURN DÉTAILLÉE
// ============================================
router.get('/etude-churn', async (req, res) => {
    try {
        const datePast180 = getDateInPast(180);
        
        const result = await db.query(`
            WITH churn_analysis AS (
                SELECT 
                    DATE_TRUNC('month', date_fin) as mois_desabonnement,
                    COUNT(*) as nb_desabonnements,
                    COALESCE(SUM(prix_total), 0) as revenu_perdu,
                    AVG(EXTRACT(EPOCH FROM (date_fin - date_debut)) / 86400) as duree_moyenne_abonnement,
                    COUNT(CASE WHEN (date_fin - date_debut) <= 30 THEN 1 END) as desabonnes_premiers_30j,
                    COUNT(CASE WHEN type_abonnement = 'premium' THEN 1 END) as premium_perdus,
                    COUNT(CASE WHEN type_abonnement = 'standard' THEN 1 END) as standard_perdus,
                    COUNT(CASE WHEN type_abonnement = 'essentiel' THEN 1 END) as essentiel_perdus
                FROM clients
                WHERE statut IN ('inactif', 'expire')
                AND date_fin >= $1
                GROUP BY DATE_TRUNC('month', date_fin)
            )
            SELECT 
                TO_CHAR(mois_desabonnement, 'YYYY-MM') as mois,
                nb_desabonnements,
                revenu_perdu,
                ROUND(duree_moyenne_abonnement::numeric, 1) as duree_moyenne_abonnement,
                desabonnes_premiers_30j,
                premium_perdus,
                standard_perdus,
                essentiel_perdus
            FROM churn_analysis
            ORDER BY mois_desabonnement DESC
        `, [datePast180]);

        const formattedResult = result.rows.map(row => ({
            ...row,
            revenu_perdu: formatPrixMAD(row.revenu_perdu),
            taux_premiers_30j: ((row.desabonnes_premiers_30j / row.nb_desabonnements) * 100).toFixed(2) + '%'
        }));

        res.json({
            success: true,
            donnees: formattedResult,
            total: {
                desabonnements: result.rows.reduce((acc, row) => acc + parseInt(row.nb_desabonnements), 0),
                revenu_perdu: formatPrixMAD(result.rows.reduce((acc, row) => acc + parseFloat(row.revenu_perdu), 0))
            }
        });
    } catch (error) {
        console.error('Erreur API etude-churn:', error);
        res.status(500).json({
            success: false,
            message: 'Une erreur est survenue',
            error: error.message
        });
    }
});

export default router;