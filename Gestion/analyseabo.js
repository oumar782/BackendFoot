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
// 1. ENDPOINT DE TEST SIMPLE
// ============================================

router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'API d\'analyse des abonnés fonctionnelle',
        timestamp: new Date().toISOString(),
        endpoints: [
            '/sante-abonnements',
            '/dashboard-principal',
            '/analyse-revenus',
            '/comportement-abonnes',
            '/analyse-fidelite',
            '/analyse-risques',
            '/securite-controle',
            '/stats-globales',
            '/test'
        ]
    });
});

// ============================================
// 2. SANTÉ DES ABONNEMENTS (VERSION SIMPLIFIÉE)
// ============================================

router.get('/sante-abonnements', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const [totalResult, actifsResult, inactifsResult] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'actif\' AND date_fin >= $1', [today]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'inactif\'')
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);

        res.json({
            success: true,
            data: {
                total,
                actifs,
                inactifs,
                pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0
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
// 3. DASHBOARD PRINCIPAL
// ============================================

router.get('/dashboard-principal', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const debutMois = new Date();
        debutMois.setDate(1);
        const debutMoisStr = debutMois.toISOString().split('T')[0];
        
        const [totalResult, actifsResult, caMoisResult] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'actif\' AND date_fin >= $1', [today]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE date_debut >= $1', [debutMoisStr])
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const caMois = parseFloat(caMoisResult.rows[0].total);

        res.json({
            success: true,
            data: {
                totalAbonnes: total,
                abonnesActifs: actifs,
                pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0,
                caMois: caMois
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
// 4. ANALYSE DES REVENUS
// ============================================

router.get('/analyse-revenus', async (req, res) => {
    try {
        // Revenus par type d'abonnement
        const revenusParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_abonnes,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as revenu_moyen
            FROM clients
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `);

        // Revenus par mode de paiement
        const revenusParPaiement = await db.query(`
            SELECT 
                mode_paiement,
                COUNT(*) as nombre_transactions,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as montant_moyen
            FROM clients
            GROUP BY mode_paiement
            ORDER BY revenu_total DESC
        `);

        // Revenu total
        const revenuTotalResult = await db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients');

        res.json({
            success: true,
            data: {
                revenuTotal: parseFloat(revenuTotalResult.rows[0].total),
                parTypeAbonnement: revenusParType.rows,
                parModePaiement: revenusParPaiement.rows
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
// 5. COMPORTEMENT DES ABONNÉS
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

        // Top utilisateurs
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

        // Sous-utilisateurs
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

        res.json({
            success: true,
            data: {
                analyseParHeure: analyseHeures.rows,
                topUtilisateurs: topUtilisateurs.rows,
                sousUtilisateurs: sousUtilisateurs.rows
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
// 6. FIDÉLITÉ ET DURÉE DE VIE CLIENT
// ============================================

router.get('/analyse-fidelite', async (req, res) => {
    try {
        // Clients avec plusieurs abonnements
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

        res.json({
            success: true,
            data: {
                clientsFideles: clientsRenouvellements.rows,
                meilleursClients: ltvClients.rows
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
// 7. RISQUES ET ALERTES
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
            LIMIT 20
        `, [today]);

        // Incohérences de données
        const incoherences = await db.query(`
            SELECT 
                COUNT(CASE WHEN date_fin IS NULL THEN 1 END) as sans_date_fin,
                COUNT(CASE WHEN statut = 'actif' AND date_fin < $1 THEN 1 END) as statut_incoherent,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as prix_invalide
            FROM clients
        `, [today]);

        res.json({
            success: true,
            data: {
                alertes: incoherences.rows[0],
                detailsProblemes: abonnementsProblematiques.rows
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
// 8. SÉCURITÉ ET CONTRÔLE
// ============================================

router.get('/securite-controle', async (req, res) => {
    try {
        // Analyse des photos
        const analysePhotos = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) as avec_photo,
                ROUND(COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_couverture
            FROM clients
        `);

        // Clients sans photo
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

        res.json({
            success: true,
            data: {
                analysePhotos: analysePhotos.rows[0],
                clientsAVerifier: clientsSansPhoto.rows
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
// 9. STATISTIQUES GLOBALES
// ============================================

router.get('/stats-globales', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const [statsGeneralResult, statsFinancierResult] = await Promise.all([
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
            `)
        ]);

        res.json({
            success: true,
            data: {
                general: statsGeneralResult.rows[0],
                financier: statsFinancierResult.rows[0]
            }
        });
    } catch (err) {
        console.error('Erreur stats globales:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des statistiques',
            error: err.message 
        });
    }
});

// ============================================
// 10. ABONNÉS À RELANCER
// ============================================

router.get('/abonnes-a-relancer', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        
        const relancesResult = await db.query(`
            SELECT 
                nom, 
                prenom, 
                email, 
                telephone,
                type_abonnement,
                date_fin
            FROM clients 
            WHERE date_fin BETWEEN $1 AND $2 
            AND statut = 'actif'
            ORDER BY date_fin ASC
            LIMIT 20
        `, [today, dateFuture30]);

        res.json({
            success: true,
            data: relancesResult.rows
        });
    } catch (err) {
        console.error('Erreur abonnés à relancer:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des abonnés à relancer',
            error: err.message 
        });
    }
});

// ============================================
// 11. ANALYSE PAR TYPE D'ABONNEMENT
// ============================================

router.get('/analyse-par-type', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const result = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as prix_moyen
            FROM clients
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `, [today]);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error('Erreur analyse par type:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse par type',
            error: err.message 
        });
    }
});

export default router;