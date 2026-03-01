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
// API RÉALISTE - UNIQUEMENT LES CHAMPS EXISTANTS
// ============================================

router.get('/analyse-clients', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const debutAnnee = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
        const dateFuture7 = getDateInFuture(7);
        const dateFuture15 = getDateInFuture(15);
        const dateFuture30 = getDateInFuture(30);
        const datePast30 = getDateInPast(30);
        const datePast90 = getDateInPast(90);
        const datePast365 = getDateInPast(365);

        // ============================================
        // 1. STATISTIQUES GÉNÉRALES
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
        // 2. ÉVOLUTION MENSUELLE (inscriptions et revenus)
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
        // 5. ANALYSE DES HEURES DE RÉSERVATION
        // ============================================
        const heuresReservation = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation) as heure,
                COUNT(*) as nombre_reservations,
                COUNT(DISTINCT email) as clients_uniques
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation)
            ORDER BY nombre_reservations DESC
        `);

        // ============================================
        // 6. TAUX DE DÉSABONNEMENT (churn)
        // ============================================
        const churnMensuel = await db.query(`
            SELECT 
                COUNT(CASE WHEN statut IN ('inactif', 'expire') AND date_fin > $1 THEN 1 END) as desabonnes_mois,
                COUNT(CASE WHEN statut = 'actif' AND date_debut > $1 THEN 1 END) as nouveaux_actifs_mois,
                COUNT(CASE WHEN statut = 'actif' AND date_debut <= $1 AND date_fin >= $1 THEN 1 END) as actifs_debut_mois
            FROM clients
        `, [datePast30]);

        // ============================================
        // 7. CLIENTS DONT L'ABONNEMENT EXPIRE BIENTÔT
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
                EXTRACT(DAY FROM date_fin - CURRENT_DATE) as jours_restants,
                CASE 
                    WHEN date_fin - CURRENT_DATE <= 7 THEN 'Urgent'
                    WHEN date_fin - CURRENT_DATE <= 15 THEN 'À relancer'
                    ELSE 'Information'
                END as priorite
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            ORDER BY date_fin ASC
        `);

        // ============================================
        // 8. TOP CLIENTS (ceux qui dépensent le plus)
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
            LIMIT 10
        `);

        // ============================================
        // 9. STATISTIQUES PAR STATUT
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
        // 10. RÉPARTITION PAR TRANCHE DE PRIX
        // ============================================
        const tranchesPrix = await db.query(`
            SELECT 
                CASE 
                    WHEN prix_total < 100 THEN 'Moins de 100'
                    WHEN prix_total BETWEEN 100 AND 300 THEN '100 - 300'
                    WHEN prix_total BETWEEN 301 AND 500 THEN '301 - 500'
                    WHEN prix_total > 500 THEN 'Plus de 500'
                    ELSE 'Non renseigné'
                END as tranche,
                COUNT(*) as nombre_clients,
                COALESCE(SUM(prix_total), 0) as revenu_tranche
            FROM clients
            GROUP BY 
                CASE 
                    WHEN prix_total < 100 THEN 'Moins de 100'
                    WHEN prix_total BETWEEN 100 AND 300 THEN '100 - 300'
                    WHEN prix_total BETWEEN 301 AND 500 THEN '301 - 500'
                    WHEN prix_total > 500 THEN 'Plus de 500'
                    ELSE 'Non renseigné'
                END
            ORDER BY revenu_tranche DESC
        `);

        // ============================================
        // 11. ÉVOLUTION DES STATUTS
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
        // 12. CALCUL DES INDICATEURS CLÉS
        // ============================================
        const total = parseInt(statsGenerales.rows[0]?.total_clients || 0);
        const actifs = parseInt(statsGenerales.rows[0]?.clients_actifs || 0);
        const inactifs = parseInt(statsGenerales.rows[0]?.clients_inactifs || 0);
        const enAttente = parseInt(statsGenerales.rows[0]?.clients_en_attente || 0);
        const expires = parseInt(statsGenerales.rows[0]?.clients_expires || 0);
        const caTotal = parseFloat(statsGenerales.rows[0]?.chiffre_affaires_total || 0);
        const panierMoyen = parseFloat(statsGenerales.rows[0]?.panier_moyen || 0);

        // Calcul du taux de désabonnement
        const desabonnesMois = parseInt(churnMensuel.rows[0]?.desabonnes_mois || 0);
        const actifsDebutMois = parseInt(churnMensuel.rows[0]?.actifs_debut_mois || 1);
        const tauxDesabonnement = (desabonnesMois / actifsDebutMois * 100).toFixed(2);

        // Calcul du taux de rétention
        const tauxRetention = (100 - parseFloat(tauxDesabonnement)).toFixed(2);

        // ============================================
        // 13. CONSTRUCTION DE LA RÉPONSE FINALE
        // ============================================
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            resume: {
                date_analyse: new Date().toLocaleDateString('fr-FR', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                total_clients: total,
                repartition: {
                    actifs,
                    inactifs,
                    en_attente: enAttente,
                    expires
                },
                chiffre_affaires: {
                    total: caTotal.toFixed(2),
                    panier_moyen: panierMoyen.toFixed(2)
                },
                indicateurs_cles: {
                    taux_desabonnement_mensuel: tauxDesabonnement + '%',
                    taux_retention: tauxRetention + '%',
                    nouveaux_mois: parseInt(churnMensuel.rows[0]?.nouveaux_actifs_mois || 0)
                }
            },
            analyses: {
                // 1. Évolution mensuelle (pour courbes)
                evolution_mensuelle: evolutionMensuelle.rows,

                // 2. Répartition par type d'abonnement (pour camembert)
                par_type_abonnement: statsParAbonnement.rows,

                // 3. Répartition par mode de paiement (pour histogramme)
                par_mode_paiement: statsParPaiement.rows,

                // 4. Heures de réservation populaires (pour histogramme)
                heures_reservation: heuresReservation.rows,

                // 5. Répartition par statut (pour barres)
                par_statut: statsParStatut.rows,

                // 6. Tranches de prix (pour histogramme)
                tranches_prix: tranchesPrix.rows,

                // 7. Évolution des statuts (pour courbes multiples)
                evolution_statuts: evolutionStatuts.rows,

                // 8. Top clients (pour tableau)
                top_clients: topClients.rows
            },
            actions_requises: {
                // 9. Clients à contacter (expirations prochaines)
                clients_a_contacter: expirationsProchaines.rows
            },
            recommandations: [
                {
                    priorite: expirationsProchaines.rows.length > 0 ? 'Haute' : 'Normale',
                    action: expirationsProchaines.rows.length > 0 
                        ? `Contacter les ${expirationsProchaines.rows.length} clients dont l'abonnement expire bientôt`
                        : 'Aucune expiration imminente à signaler',
                    impact: 'Maintien du taux de rétention'
                },
                {
                    priorite: parseFloat(tauxDesabonnement) > 5 ? 'Haute' : 'Basse',
                    action: parseFloat(tauxDesabonnement) > 5
                        ? 'Analyser les causes du taux de désabonnement élevé'
                        : 'Taux de désabonnement sous contrôle',
                    impact: 'Réduction de la perte de clients'
                }
            ]
        });

    } catch (error) {
        console.error('Erreur dans l\'API analyse-clients:', error);
        res.status(500).json({
            success: false,
            message: 'Une erreur est survenue lors de la récupération des données',
            error: error.message
        });
    }
});

// ============================================
// ENDPOINT SIMPLIFIÉ POUR LE DASHBOARD PRINCIPAL
// ============================================

router.get('/dashboard-simple', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);

        const result = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM clients) as total_clients,
                (SELECT COUNT(*) FROM clients WHERE statut = 'actif' AND date_fin >= $1) as clients_actifs,
                (SELECT COUNT(*) FROM clients WHERE statut = 'inactif') as clients_inactifs,
                (SELECT COUNT(*) FROM clients WHERE statut = 'en attente') as clients_en_attente,
                (SELECT COUNT(*) FROM clients WHERE statut = 'expire') as clients_expires,
                (SELECT COALESCE(SUM(prix_total), 0) FROM clients WHERE date_debut >= $2) as revenu_mois,
                (SELECT COALESCE(SUM(prix_total), 0) FROM clients) as revenu_total,
                (SELECT COUNT(*) FROM clients WHERE date_fin BETWEEN $1 AND $3 AND statut = 'actif') as expirations_30j,
                (SELECT COUNT(*) FROM clients WHERE heure_reservation IS NOT NULL) as avec_reservation
        `, [today, debutMois, dateFuture30]);

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;