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
// 1. TEST DE CONNEXION
// ============================================

router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'API d\'analyse des abonnés fonctionnelle',
        timestamp: new Date().toISOString(),
        endpoints: [
            '/dashboard-principal',
            '/sante-abonnements',
            '/analyse-revenus',
            '/comportement-abonnes',
            '/analyse-fidelite',
            '/analyse-risques',
            '/securite-controle',
            '/stats-globales',
            '/abonnes-a-relancer',
            '/analyse-par-type',
            '/systeme-sante-global',
            '/analyse-temporelle'
        ]
    });
});

// ============================================
// 2. DASHBOARD PRINCIPAL
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
        
        // Requêtes principales avec statuts réels
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            enAttenteResult,
            expiresResult,
            expirations7jResult,
            expirations15jResult,
            expirations30jResult,
            caMoisResult,
            caTotalResult,
            photoManquanteResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'actif' AND date_fin >= $1", [today]),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'inactif'"),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'en attente'"),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'expire'"),
            db.query("SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = 'actif'", [today, dateFuture7]),
            db.query("SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = 'actif'", [today, dateFuture15]),
            db.query("SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = 'actif'", [today, dateFuture30]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE date_debut >= $1', [debutMoisStr]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients'),
            db.query("SELECT COUNT(*) as count FROM clients WHERE photo_abonne IS NULL OR photo_abonne = ''")
        ]);

        // Calculs
        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
        const enAttente = parseInt(enAttenteResult.rows[0].count);
        const expires = parseInt(expiresResult.rows[0].count);
        const expirations7j = parseInt(expirations7jResult.rows[0].count);
        const expirations15j = parseInt(expirations15jResult.rows[0].count);
        const expirations30j = parseInt(expirations30jResult.rows[0].count);
        const caMois = parseFloat(caMoisResult.rows[0].total);
        const caTotal = parseFloat(caTotalResult.rows[0].total);
        const photoManquante = parseInt(photoManquanteResult.rows[0].count);

        // Taux de churn (clients inactifs ou expirés sur le mois)
        const debutMoisPrecedent = new Date();
        debutMoisPrecedent.setMonth(debutMoisPrecedent.getMonth() - 1);
        debutMoisPrecedent.setDate(1);
        const debutMoisPrecedentStr = debutMoisPrecedent.toISOString().split('T')[0];
        
        const churnResult = await db.query(`
            SELECT COUNT(*) as count FROM clients 
            WHERE (statut = 'inactif' OR statut = 'expire') 
            AND date_debut >= $1
        `, [debutMoisPrecedentStr]);
        
        const churnCount = parseInt(churnResult.rows[0].count);
        const tauxChurn = total > 0 ? ((churnCount / total) * 100).toFixed(2) : 0;

        // Taux d'utilisation (actifs avec réservation)
        const utilisationResult = await db.query(`
            SELECT 
                COUNT(*) as total_actifs,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservation
            FROM clients 
            WHERE statut = 'actif' AND date_fin >= $1
        `, [today]);
        
        const totalActifs = parseInt(utilisationResult.rows[0].total_actifs);
        const avecReservation = parseInt(utilisationResult.rows[0].avec_reservation);
        const tauxUtilisation = totalActifs > 0 ? ((avecReservation / totalActifs) * 100).toFixed(2) : 0;

        // Nouveaux ce mois
        const nouveauxResult = await db.query(`
            SELECT COUNT(*) as count FROM clients 
            WHERE EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)
        `);
        
        // Renouvellements ce mois
        const renouvellementsResult = await db.query(`
            SELECT COUNT(DISTINCT email) as count FROM clients c1
            WHERE EXISTS (
                SELECT 1 FROM clients c2 
                WHERE c2.email = c1.email 
                AND c2.date_debut > c1.date_fin
                AND EXTRACT(MONTH FROM c2.date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(YEAR FROM c2.date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)
            )
        `);

        res.json({
            success: true,
            data: {
                kpis: {
                    totalAbonnes: total,
                    abonnesActifs: actifs,
                    abonnesInactifs: inactifs,
                    abonnesEnAttente: enAttente,
                    abonnesExpires: expires,
                    pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0,
                    caMois: caMois,
                    caTotal: caTotal,
                    tauxChurn: parseFloat(tauxChurn),
                    tauxUtilisation: parseFloat(tauxUtilisation),
                    photoManquante: photoManquante
                },
                expirations: {
                    dans7jours: expirations7j,
                    dans15jours: expirations15j,
                    dans30jours: expirations30j
                },
                tendances: {
                    nouveauxCeMois: parseInt(nouveauxResult.rows[0].count),
                    renouvellementsCeMois: parseInt(renouvellementsResult.rows[0].count)
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
// 3. SANTÉ DES ABONNEMENTS
// ============================================

router.get('/sante-abonnements', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture7 = getDateInFuture(7);
        const dateFuture30 = getDateInFuture(30);
        const datePast30 = getDateInPast(30);
        
        // Statistiques principales avec tous les statuts
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            enAttenteResult,
            expiresResult,
            bientotExpiresResult,
            expiresRecemmentResult,
            jamaisRenouvellesResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'actif' AND date_fin >= $1", [today]),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'inactif'"),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'en attente'"),
            db.query("SELECT COUNT(*) as count FROM clients WHERE statut = 'expire'"),
            db.query("SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = 'actif'", [today, dateFuture30]),
            db.query("SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = 'actif'", [datePast30, today]),
            db.query(`
                SELECT COUNT(DISTINCT email) as count FROM clients c1
                WHERE statut = 'inactif' 
                AND NOT EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = c1.email 
                    AND c2.date_debut > c1.date_fin
                    AND c2.statut IN ('actif', 'inactif', 'en attente', 'expire')
                )
            `)
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
        const enAttente = parseInt(enAttenteResult.rows[0].count);
        const expires = parseInt(expiresResult.rows[0].count);
        const bientotExpires = parseInt(bientotExpiresResult.rows[0].count);
        const expiresRecemment = parseInt(expiresRecemmentResult.rows[0].count);
        const jamaisRenouvelles = parseInt(jamaisRenouvellesResult.rows[0].count);

        // Liste détaillée des abonnés à relancer
        const aRelancerResult = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                statut,
                CASE 
                    WHEN date_fin < $1 AND statut = 'actif' THEN 'EXPIRE_NON_MIS_A_JOUR'
                    WHEN date_fin BETWEEN $1 AND $2 AND statut = 'actif' THEN 'EXPIRE_DANS_7_JOURS'
                    WHEN date_fin BETWEEN $1 AND $3 AND statut = 'actif' THEN 'EXPIRE_DANS_30_JOURS'
                    WHEN statut = 'en attente' THEN 'EN_ATTENTE_VALIDATION'
                    ELSE 'AUTRE'
                END as categorie_relance
            FROM clients 
            WHERE statut IN ('actif', 'en attente')
            AND (
                (date_fin < $3 AND statut = 'actif')
                OR (statut = 'en attente')
            )
            ORDER BY 
                CASE 
                    WHEN date_fin < $1 AND statut = 'actif' THEN 1
                    WHEN date_fin BETWEEN $1 AND $2 AND statut = 'actif' THEN 2
                    WHEN statut = 'en attente' THEN 3
                    ELSE 4
                END,
                date_fin ASC
            LIMIT 100
        `, [today, dateFuture7, dateFuture30]);

        // Statistiques par type d'abonnement
        const statsParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN statut = 'expire' THEN 1 END) as expires,
                COUNT(CASE WHEN date_fin BETWEEN $1 AND $2 AND statut = 'actif' THEN 1 END) as expirent_bientot,
                ROUND(AVG(prix_total), 2) as prix_moyen
            FROM clients
            GROUP BY type_abonnement
            ORDER BY total DESC
        `, [today, dateFuture30]);

        res.json({
            success: true,
            data: {
                resume: {
                    total,
                    actifs,
                    inactifs,
                    enAttente,
                    expires,
                    bientotExpires,
                    expiresRecemment,
                    jamaisRenouvelles,
                    pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0,
                    pourcentageExpires: total > 0 ? ((expires / total) * 100).toFixed(2) : 0,
                    pourcentageEnAttente: total > 0 ? ((enAttente / total) * 100).toFixed(2) : 0,
                    pourcentageARelancer: actifs > 0 ? ((bientotExpires / actifs) * 100).toFixed(2) : 0
                },
                aRelancer: aRelancerResult.rows,
                statsParType: statsParType.rows
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
// 4. REVENUS ET ARGENT RÉCURRENT
// ============================================

router.get('/analyse-revenus', async (req, res) => {
    try {
        const datePast180 = getDateInPast(180);
        const today = new Date().toISOString().split('T')[0];
        
        // Revenus totaux par statut
        const [revenuTotalResult, revenuMoisResult, revenuActifsResult] = await Promise.all([
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients'),
            db.query(`
                SELECT COALESCE(SUM(prix_total), 0) as total 
                FROM clients 
                WHERE EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(YEAR FROM date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)
            `),
            db.query("SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE statut = 'actif' AND date_fin >= $1", [today])
        ]);

        // Revenus par type d'abonnement
        const revenusParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_abonnes,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as revenu_moyen,
                MIN(prix_total) as prix_min,
                MAX(prix_total) as prix_max,
                ROUND(SUM(prix_total) * 100.0 / NULLIF((SELECT SUM(prix_total) FROM clients), 0), 2) as pourcentage_total
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
                AVG(prix_total) as montant_moyen,
                ROUND(SUM(prix_total) * 100.0 / NULLIF((SELECT SUM(prix_total) FROM clients), 0), 2) as pourcentage_total
            FROM clients
            WHERE mode_paiement IS NOT NULL
            GROUP BY mode_paiement
            ORDER BY revenu_total DESC
        `);

        // Revenu mensuel (derniers 6 mois)
        const revenuMensuel = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(*) as nouveaux_abonnes,
                SUM(prix_total) as revenu_mois,
                ROUND(AVG(prix_total), 2) as panier_moyen,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= CURRENT_DATE THEN 1 END) as abonnes_actifs_mois
            FROM clients
            WHERE date_debut >= $1
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois DESC
            LIMIT 6
        `, [datePast180]);

        // Top 10 des abonnements les plus chers
        const topAbonnementsChers = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                type_abonnement,
                prix_total,
                date_debut,
                date_fin,
                statut
            FROM clients
            WHERE prix_total > 0
            ORDER BY prix_total DESC
            LIMIT 10
        `);

        // Abonnements par tranche de prix
        const repartitionPrix = await db.query(`
            SELECT 
                CASE 
                    WHEN prix_total < 100 THEN 'Moins de 100'
                    WHEN prix_total BETWEEN 100 AND 500 THEN '100-500'
                    WHEN prix_total BETWEEN 501 AND 1000 THEN '501-1000'
                    WHEN prix_total > 1000 THEN 'Plus de 1000'
                    ELSE 'Non renseigné'
                END as tranche_prix,
                COUNT(*) as nombre_abonnes,
                SUM(prix_total) as revenu_tranche,
                ROUND(AVG(prix_total), 2) as prix_moyen
            FROM clients
            GROUP BY 
                CASE 
                    WHEN prix_total < 100 THEN 'Moins de 100'
                    WHEN prix_total BETWEEN 100 AND 500 THEN '100-500'
                    WHEN prix_total BETWEEN 501 AND 1000 THEN '501-1000'
                    WHEN prix_total > 1000 THEN 'Plus de 1000'
                    ELSE 'Non renseigné'
                END
            ORDER BY revenu_tranche DESC
        `);

        // Panier moyen
        const panierMoyenResult = await db.query('SELECT COALESCE(AVG(prix_total), 0) as panier_moyen FROM clients WHERE prix_total > 0');
        
        // Nombre de transactions
        const nombreTransactionsResult = await db.query('SELECT COUNT(*) as count FROM clients');

        // Analyse rentabilité par statut
        const analyseRentabilite = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as clients,
                SUM(prix_total) as revenu,
                AVG(prix_total) as panier_moyen,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as utilisateurs_actifs,
                ROUND(COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_utilisation,
                ROUND(SUM(prix_total) / NULLIF(COUNT(*), 0), 2) as revenu_par_client
            FROM clients
            WHERE prix_total > 0
            GROUP BY type_abonnement
            ORDER BY revenu_par_client DESC
        `);

        // Répartition des revenus par statut
        const revenusParStatut = await db.query(`
            SELECT 
                statut,
                COUNT(*) as nombre_clients,
                SUM(prix_total) as revenu_total,
                ROUND(AVG(prix_total), 2) as prix_moyen,
                ROUND(SUM(prix_total) * 100.0 / NULLIF((SELECT SUM(prix_total) FROM clients), 0), 2) as pourcentage_revenu
            FROM clients
            WHERE prix_total > 0
            GROUP BY statut
            ORDER BY revenu_total DESC
        `);

        res.json({
            success: true,
            data: {
                resume: {
                    revenuTotal: parseFloat(revenuTotalResult.rows[0].total) || 0,
                    revenuMois: parseFloat(revenuMoisResult.rows[0].total) || 0,
                    revenuActifs: parseFloat(revenuActifsResult.rows[0].total) || 0,
                    panierMoyen: parseFloat(panierMoyenResult.rows[0].panier_moyen) || 0,
                    nombreTransactions: parseInt(nombreTransactionsResult.rows[0].count) || 0
                },
                parTypeAbonnement: revenusParType.rows,
                parModePaiement: revenusParPaiement.rows,
                parStatut: revenusParStatut.rows,
                historiqueMensuel: revenuMensuel.rows,
                topAbonnementsChers: topAbonnementsChers.rows,
                repartitionPrix: repartitionPrix.rows,
                analyseRentabilite: analyseRentabilite.rows
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
        const today = new Date().toISOString().split('T')[0];
        
        // Heures les plus populaires
        const heuresPopulaires = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation) as heure,
                COUNT(*) as total_reservations,
                COUNT(DISTINCT email) as clients_uniques,
                ROUND(AVG(prix_total), 2) as prix_moyen
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation)
            ORDER BY total_reservations DESC
            LIMIT 10
        `);

        // Top utilisateurs
        const topUtilisateurs = await db.query(`
            SELECT 
                nom, 
                prenom, 
                email,
                COUNT(*) as nombre_reservations,
                type_abonnement,
                statut,
                SUM(prix_total) as montant_total_depense
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY nom, prenom, email, type_abonnement, statut
            ORDER BY nombre_reservations DESC
            LIMIT 20
        `);

        // Fréquence par type
        const frequenceParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(heure_reservation) as avec_reservations,
                ROUND(COUNT(heure_reservation) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_utilisation
            FROM clients
            WHERE statut IN ('actif', 'en attente')
            GROUP BY type_abonnement
            ORDER BY taux_utilisation DESC
        `);

        // Clients dormants (actifs sans réservation)
        const clientsDormants = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                statut
            FROM clients
            WHERE statut = 'actif'
            AND date_fin >= $1
            AND heure_reservation IS NULL
            ORDER BY prix_total DESC
            LIMIT 15
        `, [today]);

        // Clients en attente
        const clientsEnAttente = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                statut,
                heure_reservation
            FROM clients
            WHERE statut = 'en attente'
            ORDER BY date_debut DESC
            LIMIT 10
        `);

        // Statistiques comportement
        const statistiquesComportement = await db.query(`
            SELECT 
                COUNT(DISTINCT email) as total_clients,
                COUNT(DISTINCT CASE WHEN heure_reservation IS NOT NULL THEN email END) as clients_actifs,
                ROUND(COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_activation,
                MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM heure_reservation)) as heure_populaire,
                COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)) as creneaux_utilises,
                ROUND(AVG(EXTRACT(HOUR FROM heure_reservation)), 1) as heure_moyenne
            FROM clients
            WHERE statut IN ('actif', 'en attente')
        `);

        // Répartition par statut et activité
        const repartitionStatutActivite = await db.query(`
            SELECT 
                statut,
                COUNT(*) as total,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservation,
                ROUND(COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_reservation
            FROM clients
            GROUP BY statut
            ORDER BY total DESC
        `);

        res.json({
            success: true,
            data: {
                heuresPopulaires: heuresPopulaires.rows.map(row => ({
                    ...row,
                    heure: parseInt(row.heure) || 0
                })),
                topUtilisateurs: topUtilisateurs.rows,
                frequenceUtilisation: frequenceParType.rows,
                clientsDormants: clientsDormants.rows,
                clientsEnAttente: clientsEnAttente.rows,
                repartitionStatutActivite: repartitionStatutActivite.rows,
                statistiquesComportement: statistiquesComportement.rows[0] || {}
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
// 6. FIDÉLITÉ
// ============================================

router.get('/analyse-fidelite', async (req, res) => {
    try {
        // Segmentation par ancienneté
        const segmentationAnciennete = await db.query(`
            SELECT 
                CASE 
                    WHEN date_debut > CURRENT_DATE - INTERVAL '30 days' THEN 'Nouveaux (< 1 mois)'
                    WHEN date_debut > CURRENT_DATE - INTERVAL '180 days' THEN 'Récent (1-6 mois)'
                    WHEN date_debut > CURRENT_DATE - INTERVAL '365 days' THEN 'Fidèle (6-12 mois)'
                    WHEN date_debut > CURRENT_DATE - INTERVAL '730 days' THEN 'Très fidèle (1-2 ans)'
                    ELSE 'VIP (> 2 ans)'
                END as segment_anciennete,
                COUNT(*) as nombre_clients,
                SUM(prix_total) as revenu_segment,
                ROUND(AVG(prix_total), 2) as panier_moyen,
                ROUND(SUM(prix_total) * 100.0 / NULLIF((SELECT SUM(prix_total) FROM clients), 0), 2) as pourcentage_revenu,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as utilisateurs_actifs
            FROM clients
            GROUP BY 
                CASE 
                    WHEN date_debut > CURRENT_DATE - INTERVAL '30 days' THEN 'Nouveaux (< 1 mois)'
                    WHEN date_debut > CURRENT_DATE - INTERVAL '180 days' THEN 'Récent (1-6 mois)'
                    WHEN date_debut > CURRENT_DATE - INTERVAL '365 days' THEN 'Fidèle (6-12 mois)'
                    WHEN date_debut > CURRENT_DATE - INTERVAL '730 days' THEN 'Très fidèle (1-2 ans)'
                    ELSE 'VIP (> 2 ans)'
                END
            ORDER BY revenu_segment DESC
        `);

        // Clients avec plusieurs abonnements
        const clientsFideles = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                COUNT(*) as nombre_abonnements,
                MIN(date_debut) as premier_abonnement,
                MAX(date_fin) as dernier_abonnement,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as panier_moyen,
                STRING_AGG(DISTINCT statut, ', ') as statuts
            FROM clients
            GROUP BY email, nom, prenom
            HAVING COUNT(*) > 1
            ORDER BY nombre_abonnements DESC, revenu_total DESC
            LIMIT 25
        `);

        // Taux de rétention
        const analyseRetention = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois_entree,
                COUNT(*) as nouveaux_clients,
                COUNT(CASE WHEN EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = clients.email 
                    AND c2.date_debut > clients.date_fin
                    AND c2.statut IN ('actif', 'en attente')
                ) THEN 1 END) as renouvellements,
                ROUND(COUNT(CASE WHEN EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = clients.email 
                    AND c2.date_debut > clients.date_fin
                    AND c2.statut IN ('actif', 'en attente')
                ) THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_retention
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois_entree DESC
        `);

        // Meilleurs clients
        const meilleursClients = await db.query(`
            SELECT 
                email,
                nom,
                prenom,
                COUNT(*) as nombre_abonnements,
                SUM(prix_total) as revenu_total,
                MIN(date_debut) as premier_achat,
                MAX(date_fin) as dernier_abonnement,
                type_abonnement as dernier_type_abonnement,
                statut as statut_actuel
            FROM clients
            GROUP BY email, nom, prenom, type_abonnement, statut
            ORDER BY revenu_total DESC
            LIMIT 30
        `);

        // Statistiques fidélité
        const statistiquesFidelite = await db.query(`
            WITH stats_fidelite AS (
                SELECT 
                    email,
                    COUNT(*) as nombre_abonnements,
                    SUM(prix_total) as revenu_total,
                    MIN(date_debut) as premier_achat,
                    MAX(date_fin) as dernier_abonnement
                FROM clients
                GROUP BY email
            )
            SELECT 
                COUNT(*) as total_clients,
                AVG(nombre_abonnements) as frequence_moyenne,
                AVG(revenu_total) as revenu_moyen_vie,
                COUNT(CASE WHEN nombre_abonnements > 1 THEN 1 END) as clients_fideles,
                ROUND(COUNT(CASE WHEN nombre_abonnements > 1 THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_fidelite
            FROM stats_fidelite
        `);

        // Analyse par statut et fidélité
        const fideliteParStatut = await db.query(`
            SELECT 
                statut,
                COUNT(*) as nombre_clients,
                AVG(prix_total) as panier_moyen,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as utilisateurs_actifs,
                ROUND(COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_utilisation
            FROM clients
            GROUP BY statut
            ORDER BY nombre_clients DESC
        `);

        res.json({
            success: true,
            data: {
                segmentationAnciennete: segmentationAnciennete.rows,
                clientsFideles: clientsFideles.rows,
                analyseRetention: analyseRetention.rows,
                meilleursClients: meilleursClients.rows,
                fideliteParStatut: fideliteParStatut.rows,
                statistiquesFidelite: statistiquesFidelite.rows[0] || {}
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
        const detailsProblemes = await db.query(`
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
                photo_abonne,
                heure_reservation,
                CASE 
                    WHEN date_fin IS NULL THEN 'DATE_FIN_MANQUANTE'
                    WHEN statut = 'actif' AND date_fin < $1 THEN 'STATUT_INCOHERENT'
                    WHEN statut = 'en attente' AND date_fin < $1 THEN 'EN_ATTENTE_EXPIRE'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'PHOTO_MANQUANTE'
                    WHEN prix_total <= 0 THEN 'PRIX_INVALIDE'
                    ELSE 'AUTRE'
                END as type_probleme,
                CASE 
                    WHEN date_fin IS NULL THEN 'URGENT'
                    WHEN statut = 'actif' AND date_fin < $1 THEN 'CRITIQUE'
                    WHEN statut = 'en attente' AND date_fin < $1 THEN 'HAUTE'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'MOYENNE'
                    WHEN prix_total <= 0 THEN 'MOYENNE'
                    ELSE 'BASSE'
                END as risque_niveau
            FROM clients
            WHERE 
                date_fin IS NULL 
                OR (statut = 'actif' AND date_fin < $1)
                OR (statut = 'en attente' AND date_fin < $1)
                OR photo_abonne IS NULL 
                OR photo_abonne = ''
                OR prix_total <= 0
            ORDER BY 
                CASE 
                    WHEN date_fin IS NULL THEN 1
                    WHEN statut = 'actif' AND date_fin < $1 THEN 2
                    WHEN statut = 'en attente' AND date_fin < $1 THEN 3
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 4
                    WHEN prix_total <= 0 THEN 5
                    ELSE 6
                END,
                date_fin DESC
            LIMIT 50
        `, [today]);

        // Statistiques des problèmes
        const resumeProblemes = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN date_fin IS NULL THEN 1 END) as sans_date_fin,
                COUNT(CASE WHEN statut = 'actif' AND date_fin < $1 THEN 1 END) as actifs_expires,
                COUNT(CASE WHEN statut = 'en attente' AND date_fin < $1 THEN 1 END) as en_attente_expires,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as prix_invalide,
                ROUND(COUNT(CASE WHEN 
                    date_fin IS NULL 
                    OR (statut = 'actif' AND date_fin < $1)
                    OR (statut = 'en attente' AND date_fin < $1)
                    OR photo_abonne IS NULL 
                    OR photo_abonne = ''
                    OR prix_total <= 0
                THEN 1 END) * 100.0 / COUNT(*), 2) as pourcentage_problemes
            FROM clients
        `, [today]);

        // Doublons potentiels
        const doublons = await db.query(`
            SELECT 
                email,
                COUNT(*) as occurrences,
                STRING_AGG(CONCAT(nom, ' ', prenom, ' (', statut, ')'), ' | ') as noms_statuts,
                STRING_AGG(DISTINCT type_abonnement, ', ') as types_abonnements,
                SUM(prix_total) as total_depense
            FROM clients
            GROUP BY email
            HAVING COUNT(*) > 1
            ORDER BY occurrences DESC, total_depense DESC
            LIMIT 15
        `);

        // Score de risque
        const scoreResult = await db.query(`
            SELECT 
                ROUND(
                    (COUNT(CASE WHEN date_fin IS NULL THEN 1 END) * 3.0 +
                     COUNT(CASE WHEN statut = 'actif' AND date_fin < $1 THEN 1 END) * 5.0 +
                     COUNT(CASE WHEN statut = 'en attente' AND date_fin < $1 THEN 1 END) * 4.0 +
                     COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) * 2.0 +
                     COUNT(CASE WHEN prix_total <= 0 THEN 1 END) * 4.0) / 
                    NULLIF((COUNT(*) * 10), 0) * 100, 2
                ) as score_risque
            FROM clients
        `, [today]);

        const scoreRisque = parseFloat(scoreResult.rows[0]?.score_risque || 0);
        let niveauRisque = 'MINIMAL';
        if (scoreRisque >= 80) niveauRisque = 'CRITIQUE';
        else if (scoreRisque >= 60) niveauRisque = 'ÉLEVÉ';
        else if (scoreRisque >= 40) niveauRisque = 'MOYEN';
        else if (scoreRisque >= 20) niveauRisque = 'FAIBLE';

        // Alertes prioritaires
        const alertesPrioritaires = await db.query(`
            SELECT 
                'STATUT_INCOHERENT' as type_alerte,
                COUNT(*) as nombre,
                'Actifs avec date d\'expiration passée' as description
            FROM clients
            WHERE statut = 'actif' AND date_fin < $1
            UNION ALL
            SELECT 
                'EN_ATTENTE_EXPIRE',
                COUNT(*),
                'En attente avec date d\'expiration passée'
            FROM clients
            WHERE statut = 'en attente' AND date_fin < $1
            UNION ALL
            SELECT 
                'SANS_DATE_FIN',
                COUNT(*),
                'Abonnements sans date de fin'
            FROM clients
            WHERE date_fin IS NULL
            UNION ALL
            SELECT 
                'PRIX_INVALIDE',
                COUNT(*),
                'Abonnements avec prix nul ou négatif'
            FROM clients
            WHERE prix_total <= 0
            ORDER BY nombre DESC
        `, [today]);

        res.json({
            success: true,
            data: {
                resumeProblemes: resumeProblemes.rows[0] || {},
                detailsProblemes: detailsProblemes.rows,
                doublons: doublons.rows,
                alertesPrioritaires: alertesPrioritaires.rows,
                scoreRisque: scoreRisque,
                niveauRisque: niveauRisque
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
        // Analyse des photos par statut
        const analysePhotos = await db.query(`
            SELECT 
                statut,
                COUNT(*) as total_clients,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) as avec_photo,
                ROUND(COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_couverture
            FROM clients
            GROUP BY statut
            ORDER BY sans_photo DESC
        `);

        // Clients sans photo par statut
        const clientsSansPhoto = await db.query(`
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
                heure_reservation
            FROM clients
            WHERE photo_abonne IS NULL OR photo_abonne = ''
            ORDER BY 
                CASE 
                    WHEN statut = 'actif' THEN 1
                    WHEN statut = 'en attente' THEN 2
                    WHEN statut = 'inactif' THEN 3
                    WHEN statut = 'expire' THEN 4
                    ELSE 5
                END,
                date_debut DESC
            LIMIT 30
        `);

        // Contrôle d'accès
        const controleAcces = await db.query(`
            SELECT 
                email,
                COUNT(DISTINCT CONCAT(nom, ' ', prenom)) as noms_differents,
                STRING_AGG(DISTINCT CONCAT(nom, ' ', prenom), ' | ') as liste_noms,
                COUNT(*) as nombre_abonnements,
                STRING_AGG(DISTINCT statut, ', ') as statuts
            FROM clients
            GROUP BY email
            HAVING COUNT(DISTINCT CONCAT(nom, ' ', prenom)) > 1
            ORDER BY noms_differents DESC, nombre_abonnements DESC
            LIMIT 15
        `);

        // Cohérence des données
        const coherenceDonnees = await db.query(`
            SELECT 
                'EMAILS_INVALIDES' as type_incoherence,
                COUNT(*) as nombre,
                STRING_AGG(email, ', ') as exemples
            FROM clients
            WHERE email NOT LIKE '%@%.%' OR email IS NULL
            UNION ALL
            SELECT 
                'TELEPHONES_INVALIDES',
                COUNT(*),
                STRING_AGG(telephone, ', ')
            FROM clients
            WHERE telephone IS NULL OR LENGTH(telephone) < 8
            UNION ALL
            SELECT 
                'DATES_INCOHERENTES',
                COUNT(*),
                STRING_AGG(CONCAT(date_debut::text, '->', date_fin::text), ' | ')
            FROM clients
            WHERE date_fin < date_debut
            UNION ALL
            SELECT 
                'STATUTS_INCOHERENTS',
                COUNT(*),
                STRING_AGG(CONCAT(nom, ' ', prenom, ' (', statut, ')'), ' | ')
            FROM clients
            WHERE statut NOT IN ('actif', 'inactif', 'expire', 'en attente')
        `);

        // Audit des modifications par statut
        const auditSecurite = await db.query(`
            SELECT 
                type_abonnement,
                statut,
                COUNT(*) as nombre_abonnements,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN date_fin IS NULL THEN 1 END) as sans_date_fin,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as prix_invalides,
                ROUND(AVG(prix_total), 2) as prix_moyen
            FROM clients
            GROUP BY type_abonnement, statut
            ORDER BY nombre_abonnements DESC
        `);

        // Résumé sécurité par statut
        const resumeSecurite = await db.query(`
            SELECT 
                statut,
                COUNT(*) as total,
                COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) as avec_photo,
                COUNT(CASE WHEN date_fin IS NULL THEN 1 END) as sans_date_fin,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as prix_invalides
            FROM clients
            GROUP BY statut
            ORDER BY total DESC
        `);

        res.json({
            success: true,
            data: {
                analysePhotos: analysePhotos.rows,
                clientsSansPhoto: clientsSansPhoto.rows,
                controleAcces: controleAcces.rows,
                coherenceDonnees: coherenceDonnees.rows,
                auditSecurite: auditSecurite.rows,
                resumeSecurite: resumeSecurite.rows
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
        
        // Statistiques générales par statut
        const general = await db.query(`
            SELECT 
                statut,
                COUNT(*) as total_clients,
                COUNT(DISTINCT email) as clients_uniques,
                COUNT(CASE WHEN date_fin >= $1 THEN 1 END) as non_expires,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservation,
                ROUND(AVG(prix_total), 2) as prix_moyen
            FROM clients
            GROUP BY statut
            ORDER BY total_clients DESC
        `, [today]);

        // Statistiques financières par statut
        const financier = await db.query(`
            SELECT 
                statut,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as panier_moyen,
                MIN(prix_total) as prix_min,
                MAX(prix_total) as prix_max,
                COUNT(CASE WHEN prix_total < 100 THEN 1 END) as abonnements_bas_prix,
                COUNT(CASE WHEN prix_total BETWEEN 100 AND 500 THEN 1 END) as abonnements_moyen_prix,
                COUNT(CASE WHEN prix_total > 500 THEN 1 END) as abonnements_haut_prix
            FROM clients
            WHERE prix_total > 0
            GROUP BY statut
            ORDER BY revenu_total DESC
        `);

        // Statistiques d'utilisation par statut
        const utilisation = await db.query(`
            SELECT 
                statut,
                COUNT(heure_reservation) as reservations_totales,
                COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)) as creneaux_utilises,
                COUNT(DISTINCT email) as clients_utilisateurs,
                ROUND(COUNT(heure_reservation) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_utilisation
            FROM clients
            GROUP BY statut
            ORDER BY reservations_totales DESC
        `);

        // Tendances temporelles par statut
        const tendancesTemporelles = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                statut,
                COUNT(*) as nouveaux_abonnes,
                SUM(prix_total) as revenu_mois,
                ROUND(AVG(prix_total), 2) as panier_moyen_mois
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '6 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM'), statut
            ORDER BY mois DESC, nouveaux_abonnes DESC
        `);

        // Résumé global
        const resumeGlobal = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(DISTINCT email) as clients_uniques,
                COUNT(DISTINCT type_abonnement) as types_abonnement_differents,
                COUNT(DISTINCT mode_paiement) as modes_paiement_differents,
                COALESCE(SUM(prix_total), 0) as revenu_total_global,
                ROUND(AVG(prix_total), 2) as panier_moyen_global
            FROM clients
        `);

        res.json({
            success: true,
            data: {
                resumeGlobal: resumeGlobal.rows[0] || {},
                parStatut: {
                    general: general.rows,
                    financier: financier.rows,
                    utilisation: utilisation.rows
                },
                tendancesTemporelles: tendancesTemporelles.rows
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
// 10. ABONNÉS À RELANCER
// ============================================

router.get('/abonnes-a-relancer', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture7 = getDateInFuture(7);
        const dateFuture15 = getDateInFuture(15);
        const dateFuture30 = getDateInFuture(30);
        const datePast30 = getDateInPast(30);
        
        // Expirent dans 7 jours (actifs)
        const expirent7jours = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                'URGENT' as priorite,
                'Expire dans moins de 7 jours' as motif,
                'actif' as statut
            FROM clients
            WHERE date_fin BETWEEN $1 AND $2
            AND statut = 'actif'
            ORDER BY date_fin ASC
        `, [today, dateFuture7]);

        // Expirent dans 15-30 jours (actifs)
        const expirent15a30jours = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                'MOYENNE' as priorite,
                'Expire dans 15-30 jours' as motif,
                'actif' as statut
            FROM clients
            WHERE date_fin BETWEEN $1 AND $2
            AND statut = 'actif'
            ORDER BY date_fin ASC
        `, [dateFuture7, dateFuture30]);

        // Expirés récemment (actifs avec statut incohérent)
        const expiresRecemment = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                'HAUTE' as priorite,
                'Statut incohérent - Date expirée' as motif,
                'actif' as statut
            FROM clients
            WHERE date_fin < $1
            AND statut = 'actif'
            ORDER BY date_fin DESC
        `, [today]);

        // En attente de validation
        const enAttente = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                'MOYENNE' as priorite,
                'En attente de validation' as motif,
                'en attente' as statut
            FROM clients
            WHERE statut = 'en attente'
            ORDER BY date_debut DESC
            LIMIT 50
        `);

        // Inactifs longue durée
        const inactifsLongueDuree = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                'FAIBLE' as priorite,
                'Inactif depuis plus de 30 jours' as motif,
                'inactif' as statut
            FROM clients
            WHERE statut = 'inactif'
            AND date_fin < $1
            ORDER BY date_fin DESC
            LIMIT 50
        `, [datePast30]);

        // Expirés définitivement
        const expiresDefinitifs = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                'FAIBLE' as priorite,
                'Abonnement expiré' as motif,
                'expire' as statut
            FROM clients
            WHERE statut = 'expire'
            ORDER BY date_fin DESC
            LIMIT 30
        `);

        // Statistiques de relance par statut
        const statsRelances = await db.query(`
            SELECT 
                COUNT(CASE WHEN date_fin BETWEEN $1 AND $2 AND statut = 'actif' THEN 1 END) as expirent_7j,
                COUNT(CASE WHEN date_fin BETWEEN $3 AND $4 AND statut = 'actif' THEN 1 END) as expirent_15a30j,
                COUNT(CASE WHEN date_fin < $1 AND statut = 'actif' THEN 1 END) as actifs_expires,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN statut = 'inactif' AND date_fin < $5 THEN 1 END) as inactifs_longue_duree,
                COUNT(CASE WHEN statut = 'expire' THEN 1 END) as expires_definitifs
            FROM clients
        `, [today, dateFuture7, dateFuture7, dateFuture30, datePast30]);

        res.json({
            success: true,
            data: {
                statsRelances: statsRelances.rows[0] || {},
                parPriorite: {
                    urgent: expirent7jours.rows || [],
                    haute: expiresRecemment.rows || [],
                    moyenne: [...(expirent15a30jours.rows || []), ...(enAttente.rows || [])],
                    faible: [...(inactifsLongueDuree.rows || []), ...(expiresDefinitifs.rows || [])]
                },
                resumeParStatut: {
                    actifs_expirent_7j: (expirent7jours.rows || []).length,
                    actifs_expirent_15a30j: (expirent15a30jours.rows || []).length,
                    actifs_expires: (expiresRecemment.rows || []).length,
                    en_attente: (enAttente.rows || []).length,
                    inactifs: (inactifsLongueDuree.rows || []).length,
                    expires: (expiresDefinitifs.rows || []).length
                }
            }
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
        const dateFuture30 = getDateInFuture(30);
        
        // Analyse par type avec tous les statuts
        const analyseDetaillee = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN statut = 'expire' THEN 1 END) as expires,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as prix_moyen,
                COUNT(heure_reservation) as reservations,
                ROUND(COUNT(heure_reservation) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_utilisation,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN date_fin BETWEEN $1 AND $2 AND statut = 'actif' THEN 1 END) as expirent_bientot
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `, [today, dateFuture30]);

        // Distribution par statut et type
        const distribution = await db.query(`
            SELECT 
                type_abonnement,
                statut,
                COUNT(*) as nombre,
                ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM clients WHERE type_abonnement IS NOT NULL), 0), 2) as pourcentage_total,
                ROUND(SUM(prix_total) * 100.0 / NULLIF((SELECT SUM(prix_total) FROM clients WHERE type_abonnement IS NOT NULL), 0), 2) as pourcentage_revenu,
                ROUND(AVG(prix_total), 2) as valeur_moyenne
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement, statut
            ORDER BY type_abonnement, nombre DESC
        `);

        // Évolution par type et statut
        const evolution = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                type_abonnement,
                statut,
                COUNT(*) as nouveaux_abonnes,
                SUM(prix_total) as revenu_mois
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '6 months'
            AND type_abonnement IS NOT NULL
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM'), type_abonnement, statut
            ORDER BY mois DESC, nouveaux_abonnes DESC
        `);

        // Statistiques par type et statut
        const statsParTypeStatut = await db.query(`
            SELECT 
                type_abonnement,
                statut,
                COUNT(*) as nombre,
                AVG(prix_total) as prix_moyen,
                MIN(prix_total) as prix_min,
                MAX(prix_total) as prix_max,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservation,
                ROUND(COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_reservation
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement, statut
            ORDER BY type_abonnement, nombre DESC
        `);

        res.json({
            success: true,
            data: {
                analyseDetaillee: analyseDetaillee.rows,
                distribution: distribution.rows,
                evolution: evolution.rows,
                statsParTypeStatut: statsParTypeStatut.rows
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
// 12. SYSTÈME DE SANTÉ GLOBAL
// ============================================

router.get('/systeme-sante-global', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        
        // Métriques de base pour chaque statut
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            enAttenteResult,
            expiresResult,
            expirentBientotResult,
            sansPhotoResult,
            sansReservationResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as total FROM clients'),
            db.query("SELECT COUNT(*) as actifs FROM clients WHERE statut = 'actif' AND date_fin >= $1", [today]),
            db.query("SELECT COUNT(*) as inactifs FROM clients WHERE statut = 'inactif'"),
            db.query("SELECT COUNT(*) as en_attente FROM clients WHERE statut = 'en attente'"),
            db.query("SELECT COUNT(*) as expires FROM clients WHERE statut = 'expire'"),
            db.query("SELECT COUNT(*) as expirent_bientot FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = 'actif'", [today, dateFuture30]),
            db.query("SELECT COUNT(*) as sans_photo FROM clients WHERE photo_abonne IS NULL OR photo_abonne = ''"),
            db.query("SELECT COUNT(*) as sans_reservation FROM clients WHERE heure_reservation IS NULL AND statut = 'actif' AND date_fin >= $1", [today])
        ]);

        const total = parseInt(totalResult.rows[0].total) || 0;
        const actifs = parseInt(actifsResult.rows[0].actifs) || 0;
        const inactifs = parseInt(inactifsResult.rows[0].inactifs) || 0;
        const enAttente = parseInt(enAttenteResult.rows[0].en_attente) || 0;
        const expires = parseInt(expiresResult.rows[0].expires) || 0;
        const expirentBientot = parseInt(expirentBientotResult.rows[0].expirent_bientot) || 0;
        const sansPhoto = parseInt(sansPhotoResult.rows[0].sans_photo) || 0;
        const sansReservation = parseInt(sansReservationResult.rows[0].sans_reservation) || 0;

        // Calculs des pourcentages
        const pourcentageActifs = total > 0 ? ((actifs / total) * 100).toFixed(2) : 0;
        const pourcentageInactifs = total > 0 ? ((inactifs / total) * 100).toFixed(2) : 0;
        const pourcentageEnAttente = total > 0 ? ((enAttente / total) * 100).toFixed(2) : 0;
        const pourcentageExpires = total > 0 ? ((expires / total) * 100).toFixed(2) : 0;
        const pourcentagePhotoManquante = total > 0 ? ((sansPhoto / total) * 100).toFixed(2) : 0;
        const pourcentageSansReservation = actifs > 0 ? ((sansReservation / actifs) * 100).toFixed(2) : 0;

        // Score de santé amélioré
        let scoreSante = 100;
        
        // Pénalités basées sur les statuts
        if (parseFloat(pourcentageExpires) > 10) scoreSante -= 15;
        if (parseFloat(pourcentageEnAttente) > 20) scoreSante -= 10;
        if (parseFloat(pourcentagePhotoManquante) > 20) scoreSante -= 10;
        if (parseFloat(pourcentageSansReservation) > 30) scoreSante -= 10;
        if (parseFloat(pourcentageActifs) < 50) scoreSante -= 20;
        
        // Pénalités pour incohérences
        const incohérencesResult = await db.query(`
            SELECT COUNT(*) as incohérences FROM clients 
            WHERE (statut = 'actif' AND date_fin < $1)
            OR (statut = 'en attente' AND date_fin < $1)
            OR date_fin IS NULL
            OR prix_total <= 0
        `, [today]);
        
        const incohérences = parseInt(incohérencesResult.rows[0].incohérences) || 0;
        const pourcentageIncohérences = total > 0 ? ((incohérences / total) * 100).toFixed(2) : 0;
        
        if (parseFloat(pourcentageIncohérences) > 5) scoreSante -= 15;
        if (parseFloat(pourcentageIncohérences) > 10) scoreSante -= 10;
        
        scoreSante = Math.max(0, Math.min(100, scoreSante));

        // Niveau de santé
        let niveauSante, couleur, icone;
        if (scoreSante >= 85) {
            niveauSante = 'EXCELLENT';
            couleur = '#10B981'; // Vert
            icone = '✅';
        } else if (scoreSante >= 70) {
            niveauSante = 'BON';
            couleur = '#3B82F6'; // Bleu
            icone = '👍';
        } else if (scoreSante >= 55) {
            niveauSante = 'MOYEN';
            couleur = '#F59E0B'; // Orange
            icone = '⚠️';
        } else if (scoreSante >= 40) {
            niveauSante = 'FAIBLE';
            couleur = '#EF4444'; // Rouge
            icone = '❌';
        } else {
            niveauSante = 'CRITIQUE';
            couleur = '#7C3AED'; // Violet
            icone = '🚨';
        }

        // Recommandations basées sur le score
        const recommandations = [];
        if (parseFloat(pourcentageExpires) > 10) {
            recommandations.push(`Nettoyer ${parseInt(pourcentageExpires)}% d'abonnés expirés`);
        }
        if (parseFloat(pourcentageEnAttente) > 20) {
            recommandations.push(`Traiter ${enAttente} abonnements en attente`);
        }
        if (parseFloat(pourcentagePhotoManquante) > 20) {
            recommandations.push(`Compléter ${sansPhoto} photos manquantes`);
        }
        if (parseFloat(pourcentageSansReservation) > 30) {
            recommandations.push(`Relancer ${sansReservation} abonnés inactifs`);
        }
        if (parseFloat(pourcentageIncohérences) > 5) {
            recommandations.push(`Corriger ${incohérences} incohérences de données`);
        }

        res.json({
            success: true,
            data: {
                resume: {
                    total,
                    actifs,
                    inactifs,
                    enAttente,
                    expires,
                    expirentBientot,
                    sansPhoto,
                    sansReservation,
                    incohérences
                },
                pourcentages: {
                    actifs: parseFloat(pourcentageActifs),
                    inactifs: parseFloat(pourcentageInactifs),
                    enAttente: parseFloat(pourcentageEnAttente),
                    expires: parseFloat(pourcentageExpires),
                    photoManquante: parseFloat(pourcentagePhotoManquante),
                    sansReservation: parseFloat(pourcentageSansReservation),
                    incohérences: parseFloat(pourcentageIncohérences)
                },
                scoreSante: Math.round(scoreSante),
                niveauSante: niveauSante,
                couleur: couleur,
                icone: icone,
                recommandations: recommandations
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

// ============================================
// 13. ANALYSE TEMPORELLE
// ============================================

router.get('/analyse-temporelle', async (req, res) => {
    try {
        const tendancesTemporelles = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                statut,
                COUNT(*) as nouveaux_abonnes,
                SUM(prix_total) as revenu_mois,
                ROUND(AVG(prix_total), 2) as panier_moyen_mois,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservation
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM'), statut
            ORDER BY mois ASC, statut
        `);

        // Évolution des statuts
        const evolutionStatuts = await db.query(`
            WITH monthly_stats AS (
                SELECT 
                    TO_CHAR(date_debut, 'YYYY-MM') as mois,
                    statut,
                    COUNT(*) as count
                FROM clients
                WHERE date_debut > CURRENT_DATE - INTERVAL '12 months'
                GROUP BY TO_CHAR(date_debut, 'YYYY-MM'), statut
            )
            SELECT 
                mois,
                SUM(CASE WHEN statut = 'actif' THEN count ELSE 0 END) as actifs,
                SUM(CASE WHEN statut = 'inactif' THEN count ELSE 0 END) as inactifs,
                SUM(CASE WHEN statut = 'en attente' THEN count ELSE 0 END) as en_attente,
                SUM(CASE WHEN statut = 'expire' THEN count ELSE 0 END) as expires,
                SUM(count) as total
            FROM monthly_stats
            GROUP BY mois
            ORDER BY mois ASC
        `);

        // Tendances mensuelles
        const tendancesMensuelles = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(*) as total_nouveaux,
                SUM(prix_total) as revenu_total,
                ROUND(AVG(prix_total), 2) as panier_moyen,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as nouveaux_actifs,
                COUNT(CASE WHEN statut = 'en attente' THEN 1 END) as nouveaux_en_attente
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois ASC
        `);

        res.json({
            success: true,
            data: {
                tendancesTemporelles: tendancesTemporelles.rows,
                evolutionStatuts: evolutionStatuts.rows,
                tendancesMensuelles: tendancesMensuelles.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse temporelle:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse temporelle',
            error: err.message 
        });
    }
});

export default router;