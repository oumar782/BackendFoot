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
// 1. DASHBOARD PRINCIPAL - VISION BOSS
// ============================================

router.get('/dashboard-principal', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date();
        debutMois.setDate(1);
        const debutMoisStr = debutMois.toISOString().split('T')[0];
        const dateFuture7 = getDateInFuture(7);
        const dateFuture15 = getDateInFuture(15);
        const dateFuture30 = getDateInFuture(30);
        const dateDebutAnnee = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
        
        const [
            totalResult,
            actifsResult,
            expirations7jResult,
            expirations15jResult,
            expirations30jResult,
            caMoisResult,
            photoManquanteResult,
            churnResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE statut = 'actif' AND date_fin >= $1`, [today]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin BETWEEN $1 AND $2 
                     AND statut = 'actif'`, [today, dateFuture7]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin BETWEEN $1 AND $2 
                     AND statut = 'actif'`, [today, dateFuture15]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin BETWEEN $1 AND $2 
                     AND statut = 'actif'`, [today, dateFuture30]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as total FROM clients 
                     WHERE date_debut >= $1`, [debutMoisStr]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE photo_abonne IS NULL OR photo_abonne = ''`),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE statut = 'inactif' AND date_debut >= $1`, [dateDebutAnnee])
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const expirations7j = parseInt(expirations7jResult.rows[0].count);
        const expirations15j = parseInt(expirations15jResult.rows[0].count);
        const expirations30j = parseInt(expirations30jResult.rows[0].count);
        const caMois = parseFloat(caMoisResult.rows[0].total);
        const photoManquante = parseInt(photoManquanteResult.rows[0].count);
        const churnCount = parseInt(churnResult.rows[0].count);
        const tauxChurn = total > 0 ? ((churnCount / total) * 100).toFixed(2) : 0;

        res.json({
            success: true,
            data: {
                kpis: {
                    totalAbonnes: total,
                    abonnesActifs: actifs,
                    pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0,
                    caMois: caMois,
                    tauxChurn: tauxChurn + '%',
                    photoManquante: photoManquante
                },
                expirations: {
                    dans7jours: expirations7j,
                    dans15jours: expirations15j,
                    dans30jours: expirations30j
                }
            }
        });
    } catch (err) {
        console.error('Erreur dashboard:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des données du dashboard',
            error: err.message 
        });
    }
});

// ============================================
// 2. SANTÉ DES ABONNEMENTS
// ============================================

router.get('/sante-abonnements', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            expiresResult,
            bientotExpiresResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE statut = 'actif' AND date_fin >= $1`, [today]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'inactif\''),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin < $1 AND statut = 'actif'`, [today]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin BETWEEN $1 AND $2 
                     AND statut = 'actif'`, [today, dateFuture30])
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
        const expires = parseInt(expiresResult.rows[0].count);
        const bientotExpires = parseInt(bientotExpiresResult.rows[0].count);

        // Liste des abonnés à relancer
        const relancesResult = await db.query(`
            SELECT nom, prenom, email, telephone, date_fin, type_abonnement 
            FROM clients 
            WHERE date_fin BETWEEN $1 AND $2 
            AND statut = 'actif'
            ORDER BY date_fin ASC
            LIMIT 50
        `, [today, dateFuture30]);

        res.json({
            success: true,
            data: {
                resume: {
                    total,
                    actifs,
                    inactifs,
                    expires,
                    bientotExpires,
                    pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0
                },
                aRelancer: relancesResult.rows
            }
        });
    } catch (err) {
        console.error('Erreur santé abonnements:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de la santé des abonnements',
            error: err.message 
        });
    }
});

// ============================================
// 3. REVENUS ET ARGENT RÉCURRENT
// ============================================

router.get('/analyse-revenus', async (req, res) => {
    try {
        const datePast365 = getDateInPast(365);
        const datePast180 = getDateInPast(180);
        
        // Revenus par type d'abonnement
        const revenusParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_abonnes,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as revenu_moyen
            FROM clients
            WHERE date_debut >= $1
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `, [datePast365]);

        // Revenus par mode de paiement
        const revenusParPaiement = await db.query(`
            SELECT 
                mode_paiement,
                COUNT(*) as nombre_transactions,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as montant_moyen
            FROM clients
            WHERE date_debut >= $1
            GROUP BY mode_paiement
            ORDER BY revenu_total DESC
        `, [datePast365]);

        // Revenu mensuel (derniers 6 mois)
        const revenuMensuel = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                SUM(prix_total) as revenu_mois,
                COUNT(*) as nouveaux_abonnes
            FROM clients
            WHERE date_debut >= $1
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois DESC
            LIMIT 6
        `, [datePast180]);

        // Revenu total
        const revenuTotalResult = await db.query(`
            SELECT COALESCE(SUM(prix_total), 0) as total FROM clients
        `);

        res.json({
            success: true,
            data: {
                revenuTotal: parseFloat(revenuTotalResult.rows[0].total),
                parTypeAbonnement: revenusParType.rows,
                parModePaiement: revenusParPaiement.rows,
                historiqueMensuel: revenuMensuel.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse revenus:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse des revenus',
            error: err.message 
        });
    }
});

// ============================================
// 4. COMPORTEMENT DES ABONNÉS
// ============================================

router.get('/comportement-abonnes', async (req, res) => {
    try {
        // Analyse par heure de réservation
        const analyseHeures = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation) as heure,
                COUNT(*) as nombre_reservations,
                COUNT(DISTINCT email) as abonnes_uniques
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation)
            ORDER BY heure ASC
        `);

        // Top utilisateurs (ceux qui réservent le plus)
        const topUtilisateurs = await db.query(`
            SELECT 
                nom, 
                prenom, 
                email,
                COUNT(*) as nombre_reservations,
                type_abonnement,
                statut
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY nom, prenom, email, type_abonnement, statut
            ORDER BY nombre_reservations DESC
            LIMIT 20
        `);

        // Sous-utilisateurs (payent mais ne réservent pas)
        const sousUtilisateurs = await db.query(`
            SELECT 
                nom, 
                prenom, 
                email,
                type_abonnement,
                prix_total,
                date_debut,
                date_fin
            FROM clients
            WHERE heure_reservation IS NULL
            AND statut = 'actif'
            ORDER BY prix_total DESC
            LIMIT 20
        `);

        // Fréquence d'utilisation par abonnement
        const frequenceParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(heure_reservation) as avec_reservations,
                ROUND(COUNT(heure_reservation) * 100.0 / COUNT(*), 2) as taux_utilisation
            FROM clients
            WHERE statut = 'actif'
            GROUP BY type_abonnement
            ORDER BY taux_utilisation DESC
        `);

        res.json({
            success: true,
            data: {
                analyseParHeure: analyseHeures.rows,
                topUtilisateurs: topUtilisateurs.rows,
                sousUtilisateurs: sousUtilisateurs.rows,
                frequenceUtilisation: frequenceParType.rows
            }
        });
    } catch (err) {
        console.error('Erreur comportement abonnés:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse du comportement',
            error: err.message 
        });
    }
});

// ============================================
// 5. FIDÉLITÉ ET DURÉE DE VIE CLIENT (LTV)
// ============================================

router.get('/analyse-fidelite', async (req, res) => {
    try {
        // Durée moyenne d'abonnement
        const dureeMoyenne = await db.query(`
            SELECT 
                AVG(date_fin - date_debut) as duree_moyenne_jours,
                type_abonnement
            FROM clients
            WHERE date_fin IS NOT NULL 
            AND date_debut IS NOT NULL
            AND date_fin >= date_debut
            GROUP BY type_abonnement
        `);

        // Clients avec plusieurs abonnements (renouvellements)
        const clientsRenouvellements = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                COUNT(*) as nombre_abonnements,
                MIN(date_debut) as premier_abonnement,
                MAX(date_fin) as dernier_abonnement,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as panier_moyen
            FROM clients
            GROUP BY email, nom, prenom
            HAVING COUNT(*) > 1
            ORDER BY nombre_abonnements DESC
            LIMIT 20
        `);

        // Valeur à vie (LTV) par client
        const ltvClients = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                COUNT(*) as nombre_abonnements,
                SUM(prix_total) as revenu_total,
                MIN(date_debut) as premier_achat,
                MAX(date_fin) as dernier_abonnement,
                ROUND(SUM(prix_total) / COUNT(*), 2) as ltv_moyen
            FROM clients
            GROUP BY email, nom, prenom
            ORDER BY revenu_total DESC
            LIMIT 20
        `);

        // Taux de rétention par période
        const datePast365 = getDateInPast(365);
        const retentionParPeriode = await db.query(`
            SELECT 
                EXTRACT(YEAR FROM date_debut) as annee,
                EXTRACT(MONTH FROM date_debut) as mois,
                COUNT(*) as nouveaux_clients,
                COUNT(CASE WHEN EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = clients.email 
                    AND c2.date_debut > clients.date_fin
                ) THEN 1 END) as renouvellements
            FROM clients
            WHERE date_debut >= $1
            GROUP BY EXTRACT(YEAR FROM date_debut), EXTRACT(MONTH FROM date_debut)
            ORDER BY annee DESC, mois DESC
            LIMIT 12
        `, [datePast365]);

        res.json({
            success: true,
            data: {
                dureeMoyenne: dureeMoyenne.rows,
                clientsFideles: clientsRenouvellements.rows,
                meilleursClients: ltvClients.rows,
                analyseRetention: retentionParPeriode.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse fidélité:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de la fidélité',
            error: err.message 
        });
    }
});

// ============================================
// 6. RISQUES ET ALERTES
// ============================================

router.get('/analyse-risques', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Abonnements problématiques
        const abonnementsProblematiques = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                prix_total,
                date_debut,
                date_fin,
                statut,
                CASE 
                    WHEN date_fin IS NULL THEN 'DATE_FIN_MANQUANTE'
                    WHEN statut = 'actif' AND date_fin < $1 THEN 'STATUT_INCOHERENT'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'PHOTO_MANQUANTE'
                    ELSE 'AUTRE'
                END as type_probleme
            FROM clients
            WHERE 
                date_fin IS NULL 
                OR (statut = 'actif' AND date_fin < $1)
                OR photo_abonne IS NULL 
                OR photo_abonne = ''
            ORDER BY date_fin DESC
        `, [today]);

        // Incohérences de données
        const incoherences = await db.query(`
            SELECT 
                COUNT(*) as total_incoherences,
                SUM(CASE WHEN date_fin IS NULL THEN 1 ELSE 0 END) as sans_date_fin,
                SUM(CASE WHEN statut = 'actif' AND date_fin < $1 THEN 1 ELSE 0 END) as statut_incoherent,
                SUM(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 ELSE 0 END) as sans_photo,
                SUM(CASE WHEN prix_total <= 0 THEN 1 ELSE 0 END) as prix_invalide
            FROM clients
        `, [today]);

        // Doublons potentiels
        const doublonsPotentiels = await db.query(`
            SELECT 
                email,
                COUNT(*) as occurrences,
                STRING_AGG(CONCAT(nom, ' ', prenom), ', ') as noms,
                STRING_AGG(statut, ', ') as statuts
            FROM clients
            GROUP BY email
            HAVING COUNT(*) > 1
            ORDER BY occurrences DESC
            LIMIT 10
        `);

        const alertesData = incoherences.rows[0];

        res.json({
            success: true,
            data: {
                alertes: {
                    totalProblemes: parseInt(alertesData.total_incoherences),
                    sansDateFin: parseInt(alertesData.sans_date_fin),
                    statutIncoherent: parseInt(alertesData.statut_incoherent),
                    sansPhoto: parseInt(alertesData.sans_photo),
                    prixInvalide: parseInt(alertesData.prix_invalide)
                },
                detailsProblemes: abonnementsProblematiques.rows,
                doublons: doublonsPotentiels.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse risques:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse des risques',
            error: err.message 
        });
    }
});

// ============================================
// 7. SÉCURITÉ ET CONTRÔLE
// ============================================

router.get('/securite-controle', async (req, res) => {
    try {
        // Analyse des photos
        const analysePhotos = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                SUM(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 ELSE 0 END) as sans_photo,
                SUM(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 ELSE 0 END) as avec_photo,
                ROUND(SUM(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as taux_couverture
            FROM clients
        `);

        // Clients sans photo (à vérifier)
        const clientsSansPhoto = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                statut,
                date_fin
            FROM clients
            WHERE photo_abonne IS NULL OR photo_abonne = ''
            ORDER BY date_fin DESC
            LIMIT 20
        `);

        // Utilisation suspecte (mêmes créneaux fréquents)
        const utilisationSuspecte = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                COUNT(*) as nombre_reservations,
                COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)) as heures_differentes,
                MIN(heure_reservation) as premiere_reservation,
                MAX(heure_reservation) as derniere_reservation
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY email, nom, prenom
            HAVING COUNT(*) > 5
            ORDER BY nombre_reservations DESC
            LIMIT 15
        `);

        res.json({
            success: true,
            data: {
                analysePhotos: analysePhotos.rows[0],
                clientsAVerifier: clientsSansPhoto.rows,
                activiteSuspecte: utilisationSuspecte.rows
            }
        });
    } catch (err) {
        console.error('Erreur sécurité:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de sécurité',
            error: err.message 
        });
    }
});

// ============================================
// 8. STATISTIQUES GLOBALES (pour widgets)
// ============================================

router.get('/stats-globales', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const [
            statsGeneralResult,
            statsFinancierResult,
            statsUtilisationResult
        ] = await Promise.all([
            db.query(`
                SELECT 
                    COUNT(*) as total_clients,
                    COUNT(DISTINCT email) as clients_uniques,
                    COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as abonnes_actifs,
                    COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as abonnes_inactifs
                FROM clients
            `, [today]),
            
            db.query(`
                SELECT 
                    COALESCE(SUM(prix_total), 0) as revenu_total,
                    COALESCE(AVG(prix_total), 0) as panier_moyen,
                    COUNT(DISTINCT mode_paiement) as modes_paiement_differents,
                    COUNT(DISTINCT type_abonnement) as types_abonnement_differents
                FROM clients
            `),
            
            db.query(`
                SELECT 
                    COUNT(heure_reservation) as reservations_totales,
                    COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)) as creneaux_utilises,
                    COUNT(DISTINCT email) as abonnes_actifs_utilisateurs,
                    ROUND(COUNT(heure_reservation) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_utilisation_global
                FROM clients
                WHERE statut = 'actif'
            `)
        ]);

        res.json({
            success: true,
            data: {
                general: statsGeneralResult.rows[0],
                financier: statsFinancierResult.rows[0],
                utilisation: statsUtilisationResult.rows[0]
            }
        });
    } catch (err) {
        console.error('Erreur stats globales:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des statistiques globales',
            error: err.message 
        });
    }
});

// ============================================
// 9. ANALYSE PAR TYPE D'ABONNEMENT
// ============================================

router.get('/analyse-par-type', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const analyseParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as prix_moyen,
                COUNT(heure_reservation) as reservations,
                ROUND(COUNT(heure_reservation) * 100.0 / COUNT(*), 2) as taux_utilisation,
                AVG(date_fin - date_debut) as duree_moyenne_jours
            FROM clients
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `, [today]);

        // Distribution par type pour graphique
        const distributionType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM clients), 2) as pourcentage
            FROM clients
            GROUP BY type_abonnement
            ORDER BY nombre DESC
        `);

        res.json({
            success: true,
            data: {
                analyseDetaillee: analyseParType.rows,
                distribution: distributionType.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse par type:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse par type d\'abonnement',
            error: err.message 
        });
    }
});

// ============================================
// 10. ENDPOINT SIMPLIFIÉ POUR DASHBOARD
// ============================================

router.get('/dashboard-simplifie', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        
        const [
            totalResult,
            actifsResult,
            revenuMoisResult,
            bientotExpiresResult,
            tauxUtilisationResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE statut = 'actif' AND date_fin >= $1`, [today]),
            db.query(`
                SELECT COALESCE(SUM(prix_total), 0) as revenu 
                FROM clients 
                WHERE EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(YEAR FROM date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)
            `),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin BETWEEN $1 AND $2 
                     AND statut = 'actif'`, [today, dateFuture30]),
            db.query(`
                SELECT 
                    ROUND(COUNT(heure_reservation) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux
                FROM clients 
                WHERE statut = 'actif'
            `)
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const revenuMois = parseFloat(revenuMoisResult.rows[0].revenu);
        const bientotExpires = parseInt(bientotExpiresResult.rows[0].count);
        const tauxUtilisation = parseFloat(tauxUtilisationResult.rows[0].taux);

        res.json({
            success: true,
            data: {
                totalAbonnes: total,
                abonnesActifs: actifs,
                pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0,
                revenuMois: revenuMois,
                abonnementsExpirentBientot: bientotExpires,
                tauxUtilisation: tauxUtilisation
            }
        });
    } catch (err) {
        console.error('Erreur dashboard simplifié:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des données du dashboard',
            error: err.message 
        });
    }
});

// ============================================
// 11. TOP 10 DES MEILLEURS CLIENTS
// ============================================

router.get('/top-clients', async (req, res) => {
    try {
        const topClients = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                COUNT(*) as nombre_abonnements,
                SUM(prix_total) as montant_total_depense,
                MIN(date_debut) as premier_abonnement,
                MAX(date_fin) as dernier_abonnement,
                ROUND(SUM(prix_total) / COUNT(*), 2) as valeur_moyenne_abonnement
            FROM clients
            GROUP BY nom, prenom, email
            ORDER BY montant_total_depense DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            data: topClients.rows
        });
    } catch (err) {
        console.error('Erreur top clients:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des meilleurs clients',
            error: err.message 
        });
    }
});

// ============================================
// 12. ANALYSE DES HEURES DE RÉSERVATION
// ============================================

router.get('/analyse-heures-reservation', async (req, res) => {
    try {
        const analyseHeures = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation) as heure,
                COUNT(*) as nombre_reservations,
                COUNT(DISTINCT email) as clients_uniques,
                ROUND(AVG(prix_total), 2) as prix_moyen,
                type_abonnement,
                statut
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation), type_abonnement, statut
            ORDER BY heure ASC, nombre_reservations DESC
        `);

        // Récupérer les heures les plus populaires
        const heuresPopulaires = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation) as heure,
                COUNT(*) as total_reservations
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation)
            ORDER BY total_reservations DESC
            LIMIT 5
        `);

        res.json({
            success: true,
            data: {
                analyseDetaillee: analyseHeures.rows,
                heuresPopulaires: heuresPopulaires.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse heures:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse des heures de réservation',
            error: err.message 
        });
    }
});

// ============================================
// 13. ABONNÉS À PROBLÈMES (pour suivi)
// ============================================

router.get('/abonnes-problemes', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const abonnesProblemes = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                statut,
                date_debut,
                date_fin,
                prix_total,
                photo_abonne,
                heure_reservation,
                CASE 
                    WHEN date_fin IS NULL THEN 'DATE_FIN_MANQUANTE'
                    WHEN statut = 'actif' AND date_fin < $1 THEN 'ABONNEMENT_EXPIRE'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'PHOTO_MANQUANTE'
                    WHEN heure_reservation IS NULL AND statut = 'actif' THEN 'NON_UTILISATEUR'
                    WHEN statut NOT IN ('actif', 'inactif') THEN 'STATUT_INVALIDE'
                    ELSE 'AUTRE'
                END as type_probleme,
                CASE 
                    WHEN date_fin IS NULL THEN 'URGENT'
                    WHEN statut = 'actif' AND date_fin < $1 THEN 'HAUTE'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'MOYENNE'
                    ELSE 'BASSE'
                END as priorite
            FROM clients
            WHERE 
                date_fin IS NULL 
                OR (statut = 'actif' AND date_fin < $1)
                OR photo_abonne IS NULL 
                OR photo_abonne = ''
                OR (heure_reservation IS NULL AND statut = 'actif')
                OR statut NOT IN ('actif', 'inactif')
            ORDER BY 
                CASE priorite
                    WHEN 'URGENT' THEN 1
                    WHEN 'HAUTE' THEN 2
                    WHEN 'MOYENNE' THEN 3
                    ELSE 4
                END,
                date_fin DESC
            LIMIT 50
        `, [today]);

        res.json({
            success: true,
            data: abonnesProblemes.rows
        });
    } catch (err) {
        console.error('Erreur abonnés problèmes:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des abonnés à problèmes',
            error: err.message 
        });
    }
});

// ============================================
// 14. SYSTÈME DE SANTÉ GLOBAL
// ============================================

router.get('/systeme-sante-global', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            expiresResult,
            bientotExpiresResult,
            photoManquanteResult,
            sansReservationResult,
            revenuTotalResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE statut = 'actif' AND date_fin >= $1`, [today]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE statut = 'inactif'`, [today]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin < $1 AND statut = 'actif'`, [today]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE date_fin BETWEEN $1 AND $2 
                     AND statut = 'actif'`, [today, dateFuture30]),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE photo_abonne IS NULL OR photo_abonne = ''`),
            db.query(`SELECT COUNT(*) as count FROM clients 
                     WHERE heure_reservation IS NULL AND statut = 'actif'`),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients')
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
        const expires = parseInt(expiresResult.rows[0].count);
        const bientotExpires = parseInt(bientotExpiresResult.rows[0].count);
        const photoManquante = parseInt(photoManquanteResult.rows[0].count);
        const sansReservation = parseInt(sansReservationResult.rows[0].count);
        const revenuTotal = parseFloat(revenuTotalResult.rows[0].total);

        // Calcul des pourcentages
        const pourcentageActifs = total > 0 ? ((actifs / total) * 100).toFixed(2) : 0;
        const pourcentageInactifs = total > 0 ? ((inactifs / total) * 100).toFixed(2) : 0;
        const pourcentageExpires = total > 0 ? ((expires / total) * 100).toFixed(2) : 0;
        const pourcentagePhotoManquante = total > 0 ? ((photoManquante / total) * 100).toFixed(2) : 0;
        const pourcentageSansReservation = actifs > 0 ? ((sansReservation / actifs) * 100).toFixed(2) : 0;

        // Score de santé (0-100)
        let scoreSante = 100;
        
        // Pénalités
        if (pourcentageExpires > 10) scoreSante -= 20;
        if (pourcentagePhotoManquante > 20) scoreSante -= 15;
        if (pourcentageSansReservation > 30) scoreSante -= 10;
        if (pourcentageActifs < 50) scoreSante -= 25;
        
        scoreSante = Math.max(0, scoreSante);

        res.json({
            success: true,
            data: {
                resume: {
                    total,
                    actifs,
                    inactifs,
                    expires,
                    bientotExpires,
                    photoManquante,
                    sansReservation,
                    revenuTotal
                },
                pourcentages: {
                    actifs: pourcentageActifs + '%',
                    inactifs: pourcentageInactifs + '%',
                    expires: pourcentageExpires + '%',
                    photoManquante: pourcentagePhotoManquante + '%',
                    sansReservation: pourcentageSansReservation + '%'
                },
                scoreSante: Math.round(scoreSante),
                niveauSante: scoreSante >= 80 ? 'EXCELLENT' : 
                            scoreSante >= 60 ? 'BON' : 
                            scoreSante >= 40 ? 'MOYEN' : 
                            scoreSante >= 20 ? 'FAIBLE' : 'CRITIQUE'
            }
        });
    } catch (err) {
        console.error('Erreur système santé global:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse du système de santé',
            error: err.message 
        });
    }
});

export default router;