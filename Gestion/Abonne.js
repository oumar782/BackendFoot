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
// API COMPLÈTE - TOUTES LES ÉTUDES AVEC CHAMPS RÉELS
// ============================================

router.get('/analyse-complete', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const debutAnnee = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
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
        // 3. STATISTIQUES PAR TYPE D'ABONNEMENT
        // ============================================
        const statsParAbonnement = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as prix_moyen,
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
        // 4. STATISTIQUES PAR MODE DE PAIEMENT
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
        // 5. ANALYSE DES HEURES DE RÉSERVATION (sans EXTRACT)
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
        // 6. TAUX DE DÉSABONNEMENT (CHURN)
        // ============================================
        const churnData = await db.query(`
            SELECT 
                COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $1 THEN 1 END) as desabonnes_mois,
                COUNT(CASE WHEN statut = 'actif' AND date_debut > $1 THEN 1 END) as nouveaux_actifs_mois,
                COUNT(CASE WHEN statut = 'actif' AND date_debut <= $1 AND date_fin >= $1 THEN 1 END) as actifs_debut_mois
            FROM clients
        `, [datePast30]);

        // ============================================
        // 7. CLIENTS À CONTACTER (expirations)
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
        // 8. TOP CLIENTS (performance commerciale)
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
        // 9. PERFORMANCE COMMERCIALE DU MOIS
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
        // 10. COMPARAISON AVEC MOIS PRÉCÉDENT
        // ============================================
        const comparaisonMoisPrec = await db.query(`
            SELECT 
                COUNT(*) as nombre_ventes,
                COALESCE(SUM(prix_total), 0) as chiffre_affaires
            FROM clients
            WHERE date_debut BETWEEN $1 AND $2
        `, [datePast30, debutMois]);

        // ============================================
        // 11. STATISTIQUES PAR STATUT (détaillées)
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
        // 12. RÉPARTITION PAR TRANCHE DE PRIX
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
        // 13. ÉVOLUTION DES STATUTS
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
        // 14. ANALYSE DE SATISFACTION (basée sur données réelles)
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
        // 15. ANALYSE DÉMOGRAPHIQUE (via indicatifs téléphoniques)
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
        // 16. ANALYSE DES TENDANCES (hebdomadaires)
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
        // 17. PRÉVISION DES RENOUVELLEMENTS
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
        // 18. CALCUL DES MÉTRIQUES FINANCIÈRES
        // ============================================
        const total = parseInt(statsGenerales.rows[0]?.total_clients || 0);
        const actifs = parseInt(statsGenerales.rows[0]?.clients_actifs || 0);
        const caTotal = parseFloat(statsGenerales.rows[0]?.chiffre_affaires_total || 0);
        const caMois = parseFloat(performanceMois.rows[0]?.chiffre_affaires || 0);
        
        // Taux de désabonnement
        const desabonnesMois = parseInt(churnData.rows[0]?.desabonnes_mois || 0);
        const actifsDebutMois = parseInt(churnData.rows[0]?.actifs_debut_mois || 1);
        const tauxDesabonnement = (desabonnesMois / actifsDebutMois * 100).toFixed(2);
        
        // Évolution par rapport au mois précédent
        const caMoisPrec = parseFloat(comparaisonMoisPrec.rows[0]?.chiffre_affaires || 0);
        const evolutionCA = caMoisPrec > 0 ? ((caMois - caMoisPrec) / caMoisPrec * 100).toFixed(1) : 0;

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
            
            // 1. RÉSUMÉ EXÉCUTIF
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
                    total: caTotal.toFixed(2),
                    mois_en_cours: caMois.toFixed(2),
                    evolution_mensuelle: evolutionCA + '%',
                    panier_moyen: parseFloat(statsGenerales.rows[0]?.panier_moyen || 0).toFixed(2)
                },
                indicateurs_cles: {
                    taux_desabonnement_mensuel: tauxDesabonnement + '%',
                    nouveaux_clients_mois: parseInt(churnData.rows[0]?.nouveaux_actifs_mois || 0),
                    clients_a_contacter: expirationsProchaines.rows.length,
                    renouvellements_prevus_3mois: renouvellementsPrevus.rows.reduce((acc, r) => acc + parseInt(r.nb_renouvellements), 0)
                }
            },

            // 2. ANALYSE DES TENDANCES
            tendances: {
                evolution_mensuelle: evolutionMensuelle.rows,
                evolution_statuts: evolutionStatuts.rows,
                tendances_hebdomadaires: tendancesHebdo.rows,
                heures_populaires: heuresReservation.rows
            },

            // 3. ANALYSE COMMERCIALE
            commercial: {
                performance_mois: {
                    ventes: parseInt(performanceMois.rows[0]?.nombre_ventes || 0),
                    chiffre_affaires: parseFloat(performanceMois.rows[0]?.chiffre_affaires || 0).toFixed(2),
                    panier_moyen: parseFloat(performanceMois.rows[0]?.panier_moyen || 0).toFixed(2),
                    nouveaux_clients: parseInt(performanceMois.rows[0]?.nouveaux_clients || 0)
                },
                comparaison_mois_precedent: {
                    ventes_precedent: parseInt(comparaisonMoisPrec.rows[0]?.nombre_ventes || 0),
                    ca_precedent: parseFloat(comparaisonMoisPrec.rows[0]?.chiffre_affaires || 0).toFixed(2),
                    evolution_ventes: comparaisonMoisPrec.rows[0]?.nombre_ventes ? 
                        (((performanceMois.rows[0]?.nombre_ventes || 0) - (comparaisonMoisPrec.rows[0]?.nombre_ventes || 0)) / (comparaisonMoisPrec.rows[0]?.nombre_ventes || 1) * 100).toFixed(1) + '%' : 'N/A'
                },
                top_clients: topClients.rows.slice(0, 10),
                par_type_abonnement: statsParAbonnement.rows,
                par_mode_paiement: statsParPaiement.rows
            },

            // 4. ANALYSE CLIENTS
            clients: {
                repartition_par_statut: statsParStatut.rows,
                repartition_par_tranche_prix: tranchesPrix.rows,
                repartition_geographique: repartitionGeo.rows,
                clients_actifs_sans_reservation: statsParStatut.rows.find(s => s.statut === 'actif')?.avec_reservation || 0
            },

            // 5. ACTIONS REQUISES
            actions: {
                clients_a_contacter: expirationsProchaines.rows,
                renouvellements_prevus: renouvellementsPrevus.rows,
                alertes: {
                    expirations_urgentes: expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length,
                    expirations_prochaines: expirationsProchaines.rows.filter(c => c.priorite === 'À relancer').length
                }
            },

            // 6. ANALYSE DE SATISFACTION
            satisfaction: {
                indicateurs: {
                    taux_activite: total > 0 ? ((satisfactionData.rows[0]?.clients_actifs || 0) / total * 100).toFixed(1) + '%' : '0%',
                    clients_actifs: satisfactionData.rows[0]?.clients_actifs || 0,
                    clients_inactifs: satisfactionData.rows[0]?.clients_inactifs || 0,
                    en_attente_validation: satisfactionData.rows[0]?.en_attente_validation || 0
                }
            },

            // 7. PRÉVISIONS
            previsions: {
                renouvellements_3_mois: renouvellementsPrevus.rows,
                montant_total_renouvellements: renouvellementsPrevus.rows.reduce((acc, r) => acc + parseFloat(r.montant_total), 0).toFixed(2)
            },

            // 8. RECOMMANDATIONS STRATÉGIQUES
            recommandations: [
                {
                    priorite: expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length > 0 ? 'Haute' : 'Normale',
                    domaine: 'Fidélisation',
                    action: expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length > 0 
                        ? `Contacter d'urgence les ${expirationsProchaines.rows.filter(c => c.priorite === 'Urgent').length} clients dont l'abonnement expire dans moins de 7 jours`
                        : 'Aucune expiration urgente',
                    impact: 'Maintien du taux de rétention'
                },
                {
                    priorite: parseFloat(tauxDesabonnement) > 5 ? 'Haute' : 'Moyenne',
                    domaine: 'Rétention',
                    action: parseFloat(tauxDesabonnement) > 5
                        ? 'Mettre en place un programme de fidélisation pour réduire le taux de désabonnement'
                        : 'Taux de désabonnement sous contrôle',
                    impact: `Réduction potentielle de ${parseFloat(tauxDesabonnement).toFixed(1)}% à 3%`
                },
                {
                    priorite: evolutionCA < 0 ? 'Moyenne' : 'Basse',
                    domaine: 'Croissance',
                    action: evolutionCA < 0
                        ? 'Relancer les campagnes marketing pour inverser la tendance'
                        : 'Maintenir la stratégie commerciale actuelle',
                    impact: 'Augmentation du chiffre d\'affaires'
                },
                {
                    priorite: topClients.rows.length > 0 ? 'Basse' : 'Moyenne',
                    domaine: 'Fidélisation premium',
                    action: 'Proposer des offres exclusives aux top clients',
                    impact: 'Renforcement de la relation client'
                }
            ]
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

export default router;