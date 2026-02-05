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
            '/systeme-sante-global'
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
        
        // Requêtes principales - COMPTE UNIQUEMENT PAR STATUT
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            expiresResult,
            enAttenteResult,
            expirations7jResult,
            expirations15jResult,
            expirations30jResult,
            caMoisResult,
            caTotalResult,
            photoManquanteResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['actif']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['inactif']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['expirer']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['en attente']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2', [today, dateFuture7]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2', [today, dateFuture15]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2', [today, dateFuture30]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE date_debut >= $1', [debutMoisStr]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE photo_abonne IS NULL OR photo_abonne = \'\'')
        ]);

        // Calculs
        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
        const expires = parseInt(expiresResult.rows[0].count);
        const enAttente = parseInt(enAttenteResult.rows[0].count);
        const expirations7j = parseInt(expirations7jResult.rows[0].count);
        const expirations15j = parseInt(expirations15jResult.rows[0].count);
        const expirations30j = parseInt(expirations30jResult.rows[0].count);
        const caMois = parseFloat(caMoisResult.rows[0].total);
        const caTotal = parseFloat(caTotalResult.rows[0].total);
        const photoManquante = parseInt(photoManquanteResult.rows[0].count);

        // Taux de churn
        const debutMoisPrecedent = new Date();
        debutMoisPrecedent.setMonth(debutMoisPrecedent.getMonth() - 1);
        debutMoisPrecedent.setDate(1);
        const debutMoisPrecedentStr = debutMoisPrecedent.toISOString().split('T')[0];
        
        const churnResult = await db.query(`
            SELECT COUNT(*) as count FROM clients 
            WHERE statut IN ($1, $2)
            AND date_debut >= $3
        `, ['inactif', 'expirer', debutMoisPrecedentStr]);
        
        const churnCount = parseInt(churnResult.rows[0].count);
        const tauxChurn = total > 0 ? ((churnCount / total) * 100).toFixed(2) : 0;

        // Taux d'utilisation
        const utilisationResult = await db.query(`
            SELECT 
                COUNT(*) as total_actifs,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservation
            FROM clients 
            WHERE statut = $1
        `, ['actif']);
        
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
                AND c2.id != c1.id
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
                    abonnesExpires: expires,
                    abonnesEnAttente: enAttente,
                    pourcentageActifs: total > 0 ? parseFloat(((actifs / total) * 100).toFixed(2)) : 0,
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
        
        // Statistiques principales - COMPTE UNIQUEMENT PAR STATUT
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            expiresResult,
            enAttenteResult,
            bientotExpiresResult,
            expiresRecemmentResult,
            jamaisRenouvellesResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['actif']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['inactif']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['expirer']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = $1', ['en attente']),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2', [today, dateFuture30]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2', [datePast30, today]),
            db.query(`
                SELECT COUNT(DISTINCT email) as count FROM clients c1
                WHERE statut IN ($1, $2)
                AND NOT EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = c1.email 
                    AND c2.id != c1.id
                    AND c2.date_debut > c1.date_fin
                )
            `, ['inactif', 'expirer'])
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
        const expires = parseInt(expiresResult.rows[0].count);
        const enAttente = parseInt(enAttenteResult.rows[0].count);
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
                    WHEN statut = $1 THEN 'EXPIRE'
                    WHEN date_fin BETWEEN $2 AND $3 THEN 'EXPIRE_DANS_7_JOURS'
                    WHEN date_fin BETWEEN $2 AND $4 THEN 'EXPIRE_DANS_30_JOURS'
                    ELSE 'AUTRE'
                END as categorie_relance
            FROM clients 
            WHERE statut IN ($1, $5)
            OR date_fin BETWEEN $2 AND $4
            ORDER BY 
                CASE 
                    WHEN statut = $1 THEN 1
                    WHEN date_fin BETWEEN $2 AND $3 THEN 2
                    WHEN date_fin BETWEEN $2 AND $4 THEN 3
                    ELSE 4
                END,
                date_fin ASC
            LIMIT 100
        `, ['expirer', today, dateFuture7, dateFuture30, 'inactif']);

        // Statistiques par type d'abonnement
        const statsParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = $2 THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = $3 THEN 1 END) as expires,
                COUNT(CASE WHEN statut = $4 THEN 1 END) as en_attente,
                COUNT(CASE WHEN date_fin BETWEEN $5 AND $6 THEN 1 END) as expirent_bientot,
                ROUND(AVG(prix_total), 2) as prix_moyen
            FROM clients
            GROUP BY type_abonnement
            ORDER BY total DESC
        `, ['actif', 'inactif', 'expirer', 'en attente', today, dateFuture30]);

        res.json({
            success: true,
            data: {
                resume: {
                    total,
                    actifs,
                    inactifs,
                    expires,
                    enAttente,
                    bientotExpires,
                    expiresRecemment,
                    jamaisRenouvelles,
                    pourcentageActifs: total > 0 ? parseFloat(((actifs / total) * 100).toFixed(2)) : 0,
                    pourcentageExpires: total > 0 ? parseFloat(((expires / total) * 100).toFixed(2)) : 0,
                    pourcentageARelancer: total > 0 ? parseFloat(((bientotExpires / total) * 100).toFixed(2)) : 0
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
        
        // Revenus totaux
        const [revenuTotalResult, revenuMoisResult, revenuActifsResult] = await Promise.all([
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients'),
            db.query(`
                SELECT COALESCE(SUM(prix_total), 0) as total 
                FROM clients 
                WHERE EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(YEAR FROM date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)
            `),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE statut = $1', ['actif'])
        ]);

        // Revenus par type d'abonnement
        const revenusParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_abonnes,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as revenu_moyen,
                COALESCE(MIN(prix_total), 0) as prix_min,
                COALESCE(MAX(prix_total), 0) as prix_max,
                ROUND(
                    COALESCE(SUM(prix_total), 0) * 100.0 / 
                    NULLIF((SELECT SUM(prix_total) FROM clients), 0), 
                    2
                ) as pourcentage_total
            FROM clients
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `);

        // Revenus par mode de paiement
        const revenusParPaiement = await db.query(`
            SELECT 
                mode_paiement,
                COUNT(*) as nombre_transactions,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as montant_moyen,
                ROUND(
                    COALESCE(SUM(prix_total), 0) * 100.0 / 
                    NULLIF((SELECT SUM(prix_total) FROM clients), 0), 
                    2
                ) as pourcentage_total
            FROM clients
            GROUP BY mode_paiement
            ORDER BY revenu_total DESC
        `);

        // Revenu mensuel (derniers 6 mois)
        const revenuMensuel = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(*) as nouveaux_abonnes,
                COALESCE(SUM(prix_total), 0) as revenu_mois,
                ROUND(COALESCE(AVG(prix_total), 0), 2) as panier_moyen,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as abonnes_actifs_mois
            FROM clients
            WHERE date_debut >= $2
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois DESC
            LIMIT 6
        `, ['actif', datePast180]);

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
                END as tranche_prix,
                COUNT(*) as nombre_abonnes,
                COALESCE(SUM(prix_total), 0) as revenu_tranche,
                ROUND(COALESCE(AVG(prix_total), 0), 2) as prix_moyen
            FROM clients
            GROUP BY 
                CASE 
                    WHEN prix_total < 100 THEN 'Moins de 100'
                    WHEN prix_total BETWEEN 100 AND 500 THEN '100-500'
                    WHEN prix_total BETWEEN 501 AND 1000 THEN '501-1000'
                    WHEN prix_total > 1000 THEN 'Plus de 1000'
                END
            ORDER BY revenu_tranche DESC
        `);

        // Panier moyen
        const panierMoyenResult = await db.query('SELECT COALESCE(AVG(prix_total), 0) as panier_moyen FROM clients');
        
        // Nombre de transactions
        const nombreTransactionsResult = await db.query('SELECT COUNT(*) as count FROM clients');

        // Analyse rentabilité
        const analyseRentabilite = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as clients,
                COALESCE(SUM(prix_total), 0) as revenu,
                COALESCE(AVG(prix_total), 0) as panier_moyen,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as utilisateurs_actifs,
                ROUND(
                    COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 
                    2
                ) as taux_utilisation,
                ROUND(
                    COALESCE(SUM(prix_total), 0) / NULLIF(COUNT(*), 0), 
                    2
                ) as revenu_par_client
            FROM clients
            GROUP BY type_abonnement
            ORDER BY revenu_par_client DESC
        `);

        res.json({
            success: true,
            data: {
                resume: {
                    revenuTotal: parseFloat(revenuTotalResult.rows[0].total),
                    revenuMois: parseFloat(revenuMoisResult.rows[0].total),
                    revenuActifs: parseFloat(revenuActifsResult.rows[0].total),
                    panierMoyen: parseFloat(panierMoyenResult.rows[0].panier_moyen),
                    nombreTransactions: parseInt(nombreTransactionsResult.rows[0].count)
                },
                parTypeAbonnement: revenusParType.rows,
                parModePaiement: revenusParPaiement.rows,
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
                ROUND(COALESCE(AVG(prix_total), 0), 2) as prix_moyen
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
                COALESCE(SUM(prix_total), 0) as montant_total_depense
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
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as avec_reservations,
                ROUND(
                    COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 
                    2
                ) as taux_utilisation
            FROM clients
            WHERE statut = $1
            GROUP BY type_abonnement
            ORDER BY taux_utilisation DESC
        `, ['actif']);

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
            WHERE statut = $1
            AND heure_reservation IS NULL
            ORDER BY prix_total DESC
            LIMIT 15
        `, ['actif']);

        // Statistiques comportement
        const statistiquesComportement = await db.query(`
            SELECT 
                COUNT(DISTINCT email) as total_clients,
                COUNT(DISTINCT CASE WHEN heure_reservation IS NOT NULL THEN email END) as clients_actifs,
                ROUND(
                    COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 
                    2
                ) as taux_activation,
                COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)) as creneaux_utilises,
                ROUND(COALESCE(AVG(EXTRACT(HOUR FROM heure_reservation)), 0), 1) as heure_moyenne
            FROM clients
            WHERE statut = $1
        `, ['actif']);

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
                COALESCE(SUM(prix_total), 0) as revenu_segment,
                ROUND(COALESCE(AVG(prix_total), 0), 2) as panier_moyen,
                ROUND(
                    COALESCE(SUM(prix_total), 0) * 100.0 / 
                    NULLIF((SELECT SUM(prix_total) FROM clients), 0), 
                    2
                ) as pourcentage_revenu,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as actifs,
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
        `, ['actif']);

        // Clients avec plusieurs abonnements
        const clientsFideles = await db.query(`
            SELECT 
                email,
                MAX(nom) as nom,
                MAX(prenom) as prenom,
                COUNT(*) as nombre_abonnements,
                MIN(date_debut) as premier_abonnement,
                MAX(date_fin) as dernier_abonnement,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as panier_moyen
            FROM clients
            GROUP BY email
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
                    AND c2.id != clients.id
                    AND c2.date_debut > clients.date_fin
                ) THEN 1 END) as renouvellements,
                ROUND(
                    COUNT(CASE WHEN EXISTS (
                        SELECT 1 FROM clients c2 
                        WHERE c2.email = clients.email 
                        AND c2.id != clients.id
                        AND c2.date_debut > clients.date_fin
                    ) THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 
                    2
                ) as taux_retention
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois_entree DESC
        `);

        // Meilleurs clients
        const meilleursClients = await db.query(`
            SELECT 
                email,
                MAX(nom) as nom,
                MAX(prenom) as prenom,
                COUNT(*) as nombre_abonnements,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                MIN(date_debut) as premier_achat,
                MAX(date_fin) as dernier_abonnement,
                MAX(type_abonnement) as dernier_type_abonnement,
                MAX(statut) as statut_actuel
            FROM clients
            GROUP BY email
            ORDER BY revenu_total DESC
            LIMIT 30
        `);

        // Statistiques fidélité
        const statistiquesFidelite = await db.query(`
            WITH stats_fidelite AS (
                SELECT 
                    email,
                    COUNT(*) as nombre_abonnements,
                    COALESCE(SUM(prix_total), 0) as revenu_total,
                    MIN(date_debut) as premier_achat,
                    MAX(date_fin) as dernier_abonnement
                FROM clients
                GROUP BY email
            )
            SELECT 
                COUNT(*) as total_clients,
                COALESCE(AVG(nombre_abonnements), 0) as frequence_moyenne,
                COALESCE(AVG(revenu_total), 0) as revenu_moyen_vie,
                COUNT(CASE WHEN nombre_abonnements > 1 THEN 1 END) as clients_fideles,
                ROUND(
                    COUNT(CASE WHEN nombre_abonnements > 1 THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 
                    2
                ) as taux_fidelite
            FROM stats_fidelite
        `);

        res.json({
            success: true,
            data: {
                segmentationAnciennete: segmentationAnciennete.rows,
                clientsFideles: clientsFideles.rows,
                analyseRetention: analyseRetention.rows,
                meilleursClients: meilleursClients.rows,
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
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'PHOTO_MANQUANTE'
                    WHEN prix_total <= 0 THEN 'PRIX_INVALIDE'
                    WHEN statut NOT IN ($1, $2, $3, $4) THEN 'STATUT_INVALIDE'
                    ELSE 'AUTRE'
                END as type_probleme,
                CASE 
                    WHEN date_fin IS NULL THEN 'URGENT'
                    WHEN prix_total <= 0 THEN 'HAUTE'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'MOYENNE'
                    ELSE 'BASSE'
                END as risque_niveau
            FROM clients
            WHERE 
                date_fin IS NULL 
                OR photo_abonne IS NULL 
                OR photo_abonne = ''
                OR prix_total <= 0
                OR statut NOT IN ($1, $2, $3, $4)
            ORDER BY 
                CASE 
                    WHEN date_fin IS NULL THEN 1
                    WHEN prix_total <= 0 THEN 2
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 3
                    ELSE 4
                END,
                date_fin DESC
            LIMIT 50
        `, ['actif', 'inactif', 'expirer', 'en attente']);

        // Statistiques des problèmes
        const resumeProblemes = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN date_fin IS NULL THEN 1 END) as sans_date_fin,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as prix_invalide,
                COUNT(CASE WHEN statut NOT IN ($1, $2, $3, $4) THEN 1 END) as statut_invalide,
                ROUND(
                    COUNT(CASE WHEN 
                        date_fin IS NULL 
                        OR photo_abonne IS NULL 
                        OR photo_abonne = ''
                        OR prix_total <= 0
                        OR statut NOT IN ($1, $2, $3, $4)
                    THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 
                    2
                ) as pourcentage_problemes
            FROM clients
        `, ['actif', 'inactif', 'expirer', 'en attente']);

        // Doublons potentiels (même email, noms différents)
        const doublons = await db.query(`
            SELECT 
                email,
                COUNT(*) as occurrences,
                STRING_AGG(DISTINCT CONCAT(nom, ' ', prenom), ' | ') as noms,
                STRING_AGG(DISTINCT statut, ', ') as statuts,
                STRING_AGG(DISTINCT type_abonnement, ', ') as types_abonnements,
                COALESCE(SUM(prix_total), 0) as total_depense
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
                     COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) * 2.0 +
                     COUNT(CASE WHEN prix_total <= 0 THEN 1 END) * 4.0 +
                     COUNT(CASE WHEN statut NOT IN ($1, $2, $3, $4) THEN 1 END) * 5.0) / 
                    NULLIF(COUNT(*) * 10, 0) * 100, 
                    2
                ) as score_risque
            FROM clients
        `, ['actif', 'inactif', 'expirer', 'en attente']);

        const scoreRisque = parseFloat(scoreResult.rows[0]?.score_risque || 0);
        let niveauRisque = 'MINIMAL';
        if (scoreRisque >= 80) niveauRisque = 'CRITIQUE';
        else if (scoreRisque >= 60) niveauRisque = 'ÉLEVÉ';
        else if (scoreRisque >= 40) niveauRisque = 'MOYEN';
        else if (scoreRisque >= 20) niveauRisque = 'FAIBLE';

        res.json({
            success: true,
            data: {
                resumeProblemes: resumeProblemes.rows[0] || {},
                detailsProblemes: detailsProblemes.rows,
                doublons: doublons.rows,
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
        // Analyse des photos
        const analysePhotos = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) as avec_photo,
                ROUND(
                    COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 
                    2
                ) as taux_couverture
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
                date_debut,
                date_fin,
                prix_total,
                heure_reservation
            FROM clients
            WHERE photo_abonne IS NULL OR photo_abonne = ''
            ORDER BY 
                CASE 
                    WHEN statut = $1 THEN 1 
                    WHEN statut = $2 THEN 2
                    WHEN statut = $3 THEN 3
                    WHEN statut = $4 THEN 4
                    ELSE 5
                END,
                date_debut DESC
            LIMIT 30
        `, ['actif', 'en attente', 'expirer', 'inactif']);

        // Contrôle d'accès (même email, noms différents)
        const controleAcces = await db.query(`
            SELECT 
                email,
                COUNT(DISTINCT CONCAT(nom, ' ', prenom)) as noms_differents,
                STRING_AGG(DISTINCT CONCAT(nom, ' ', prenom), ' | ') as liste_noms,
                COUNT(*) as nombre_abonnements
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
                STRING_AGG(email, ', ' ORDER BY email LIMIT 5) as exemples
            FROM clients
            WHERE email NOT LIKE '%@%.%'
            
            UNION ALL
            
            SELECT 
                'TELEPHONES_INVALIDES',
                COUNT(*),
                STRING_AGG(telephone, ', ' ORDER BY telephone LIMIT 5)
            FROM clients
            WHERE telephone IS NULL OR LENGTH(TRIM(telephone)) < 8
            
            UNION ALL
            
            SELECT 
                'DATES_INCOHERENTES',
                COUNT(*),
                STRING_AGG(CONCAT(date_debut::text, ' -> ', date_fin::text), ' | ' LIMIT 5)
            FROM clients
            WHERE date_fin < date_debut
            
            UNION ALL
            
            SELECT 
                'STATUTS_INVALIDES',
                COUNT(*),
                STRING_AGG(CONCAT(nom, ' ', prenom, ' (', statut, ')'), ' | ' LIMIT 5)
            FROM clients
            WHERE statut NOT IN ($1, $2, $3, $4)
        `, ['actif', 'inactif', 'expirer', 'en attente']);

        // Audit par type
        const auditSecurite = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_abonnements,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as prix_invalides,
                COUNT(CASE WHEN statut NOT IN ($1, $2, $3, $4) THEN 1 END) as statut_invalide,
                ROUND(COALESCE(AVG(prix_total), 0), 2) as prix_moyen
            FROM clients
            GROUP BY type_abonnement
            ORDER BY nombre_abonnements DESC
        `, ['actif', 'inactif', 'expirer', 'en attente']);

        // Résumé sécurité
        const resumeSecurite = await db.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN photo_abonne IS NOT NULL AND photo_abonne != '' THEN 1 END) as avec_photo,
                COUNT(DISTINCT email) as emails_uniques,
                COUNT(CASE WHEN statut NOT IN ($1, $2, $3, $4) THEN 1 END) as statuts_invalides
            FROM clients
        `, ['actif', 'inactif', 'expirer', 'en attente']);

        res.json({
            success: true,
            data: {
                analysePhotos: analysePhotos.rows[0] || {},
                clientsSansPhoto: clientsSansPhoto.rows,
                controleAcces: controleAcces.rows,
                coherenceDonnees: coherenceDonnees.rows,
                auditSecurite: auditSecurite.rows,
                resumeSecurite: resumeSecurite.rows[0] || {}
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
        // Statistiques générales
        const general = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(DISTINCT email) as clients_uniques,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as abonnes_actifs,
                COUNT(CASE WHEN statut = $2 THEN 1 END) as abonnes_inactifs,
                COUNT(CASE WHEN statut = $3 THEN 1 END) as abonnes_expires,
                COUNT(CASE WHEN statut = $4 THEN 1 END) as abonnes_en_attente,
                COUNT(DISTINCT type_abonnement) as types_abonnement_differents,
                COUNT(DISTINCT mode_paiement) as modes_paiement_differents
            FROM clients
        `, ['actif', 'inactif', 'expirer', 'en attente']);

        // Statistiques financières
        const financier = await db.query(`
            SELECT 
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as panier_moyen,
                COALESCE(MIN(prix_total), 0) as prix_min,
                COALESCE(MAX(prix_total), 0) as prix_max,
                COUNT(CASE WHEN prix_total < 100 THEN 1 END) as abonnements_bas_prix,
                COUNT(CASE WHEN prix_total BETWEEN 100 AND 500 THEN 1 END) as abonnements_moyen_prix,
                COUNT(CASE WHEN prix_total > 500 THEN 1 END) as abonnements_haut_prix
            FROM clients
        `);

        // Statistiques d'utilisation
        const utilisation = await db.query(`
            SELECT 
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as reservations_totales,
                COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)) as creneaux_utilises,
                COUNT(DISTINCT CASE WHEN heure_reservation IS NOT NULL THEN email END) as abonnes_actifs_utilisateurs,
                ROUND(
                    COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 
                    2
                ) as taux_utilisation_global
            FROM clients
            WHERE statut = $1
        `, ['actif']);

        // Tendances temporelles
        const tendancesTemporelles = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(*) as nouveaux_abonnes,
                COALESCE(SUM(prix_total), 0) as revenu_mois,
                ROUND(COALESCE(AVG(prix_total), 0), 2) as panier_moyen_mois,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as actifs_mois
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '6 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois DESC
        `, ['actif']);

        res.json({
            success: true,
            data: {
                general: general.rows[0] || {},
                financier: financier.rows[0] || {},
                utilisation: utilisation.rows[0] || {},
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
        const dateFuture30 = getDateInFuture(30);
        const datePast30 = getDateInPast(30);
        
        // Expirent dans 7 jours
        const expirent7jours = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                statut,
                'URGENT' as priorite,
                'Expire dans moins de 7 jours' as motif
            FROM clients
            WHERE date_fin BETWEEN $1 AND $2
            ORDER BY date_fin ASC
        `, [today, dateFuture7]);

        // Expirent dans 15-30 jours
        const expirent15a30jours = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                statut,
                'MOYENNE' as priorite,
                'Expire dans 15-30 jours' as motif
            FROM clients
            WHERE date_fin BETWEEN $1 AND $2
            ORDER BY date_fin ASC
        `, [dateFuture7, dateFuture30]);

        // Expirés récemment
        const expiresRecemment = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                statut,
                'HAUTE' as priorite,
                'A expiré récemment' as motif
            FROM clients
            WHERE statut = $1
            AND date_fin BETWEEN $2 AND $3
            ORDER BY date_fin DESC
        `, ['expirer', datePast30, today]);

        // Inactifs longue durée
        const inactifsLongueDuree = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                statut,
                prix_total,
                'MOYENNE' as priorite,
                'Inactif depuis longtemps' as motif
            FROM clients
            WHERE statut = $1
            AND date_fin < $2
            ORDER BY date_fin DESC
            LIMIT 50
        `, ['inactif', datePast30]);

        // Statistiques
        const statsRelances = await db.query(`
            SELECT 
                COUNT(CASE WHEN date_fin BETWEEN $1 AND $2 THEN 1 END) as expirent_7j,
                COUNT(CASE WHEN date_fin BETWEEN $3 AND $4 THEN 1 END) as expirent_15a30j,
                COUNT(CASE WHEN statut = $5 AND date_fin BETWEEN $6 AND $1 THEN 1 END) as expires_recemment,
                COUNT(CASE WHEN statut = $7 AND date_fin < $6 THEN 1 END) as inactifs_longue_duree
            FROM clients
        `, [today, dateFuture7, dateFuture7, dateFuture30, 'expirer', datePast30, 'inactif']);

        res.json({
            success: true,
            data: {
                statsRelances: statsRelances.rows[0] || {},
                parPriorite: {
                    urgent: expirent7jours.rows || [],
                    haute: expiresRecemment.rows || [],
                    moyenne: [...(expirent15a30jours.rows || []), ...(inactifsLongueDuree.rows || [])]
                },
                resumeParCategorie: {
                    expirent7jours: (expirent7jours.rows || []).length,
                    expirent15a30jours: (expirent15a30jours.rows || []).length,
                    expiresRecemment: (expiresRecemment.rows || []).length,
                    inactifsLongueDuree: (inactifsLongueDuree.rows || []).length
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
        
        // Analyse par type
        const analyseDetaillee = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = $2 THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = $3 THEN 1 END) as expires,
                COUNT(CASE WHEN statut = $4 THEN 1 END) as en_attente,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                COALESCE(AVG(prix_total), 0) as prix_moyen,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as reservations,
                ROUND(
                    COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0), 
                    2
                ) as taux_utilisation,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN date_fin BETWEEN $5 AND $6 THEN 1 END) as expirent_bientot
            FROM clients
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `, ['actif', 'inactif', 'expirer', 'en attente', today, dateFuture30]);

        // Distribution
        const distribution = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre,
                ROUND(
                    COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM clients), 0), 
                    2
                ) as pourcentage_total,
                ROUND(
                    COALESCE(SUM(prix_total), 0) * 100.0 / 
                    NULLIF((SELECT SUM(prix_total) FROM clients), 0), 
                    2
                ) as pourcentage_revenu,
                ROUND(COALESCE(AVG(prix_total), 0), 2) as valeur_moyenne
            FROM clients
            GROUP BY type_abonnement
            ORDER BY nombre DESC
        `);

        // Évolution
        const evolution = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                type_abonnement,
                COUNT(*) as nouveaux_abonnes,
                COALESCE(SUM(prix_total), 0) as revenu_mois
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '6 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM'), type_abonnement
            ORDER BY mois DESC, nouveaux_abonnes DESC
        `);

        res.json({
            success: true,
            data: {
                analyseDetaillee: analyseDetaillee.rows,
                distribution: distribution.rows,
                evolution: evolution.rows
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
        
        // Métriques de base
        const metriques = await db.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = $2 THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = $3 THEN 1 END) as expires,
                COUNT(CASE WHEN statut = $4 THEN 1 END) as en_attente,
                COUNT(CASE WHEN date_fin BETWEEN $5 AND $6 THEN 1 END) as expirent_bientot,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN statut = $1 AND heure_reservation IS NULL THEN 1 END) as sans_reservation
            FROM clients
        `, ['actif', 'inactif', 'expirer', 'en attente', today, dateFuture30]);

        const m = metriques.rows[0];
        const total = parseInt(m.total) || 0;
        const actifs = parseInt(m.actifs) || 0;
        const inactifs = parseInt(m.inactifs) || 0;
        const expires = parseInt(m.expires) || 0;
        const enAttente = parseInt(m.en_attente) || 0;
        const expirentBientot = parseInt(m.expirent_bientot) || 0;
        const sansPhoto = parseInt(m.sans_photo) || 0;
        const sansReservation = parseInt(m.sans_reservation) || 0;

        // Calculs
        const pourcentageActifs = total > 0 ? parseFloat(((actifs / total) * 100).toFixed(2)) : 0;
        const pourcentageExpires = total > 0 ? parseFloat(((expires / total) * 100).toFixed(2)) : 0;
        const pourcentagePhotoManquante = total > 0 ? parseFloat(((sansPhoto / total) * 100).toFixed(2)) : 0;
        const pourcentageSansReservation = actifs > 0 ? parseFloat(((sansReservation / actifs) * 100).toFixed(2)) : 0;

        // Score de santé
        let scoreSante = 100;
        if (pourcentageExpires > 10) scoreSante -= 20;
        if (pourcentagePhotoManquante > 20) scoreSante -= 15;
        if (pourcentageSansReservation > 30) scoreSante -= 10;
        if (pourcentageActifs < 50) scoreSante -= 25;
        if (expirentBientot > actifs * 0.3) scoreSante -= 10;
        scoreSante = Math.max(0, Math.min(100, scoreSante));

        // Niveau de santé
        let niveauSante, couleur, icone;
        if (scoreSante >= 80) {
            niveauSante = 'EXCELLENT';
            couleur = '#10B981';
            icone = '✅';
        } else if (scoreSante >= 60) {
            niveauSante = 'BON';
            couleur = '#3B82F6';
            icone = '👍';
        } else if (scoreSante >= 40) {
            niveauSante = 'MOYEN';
            couleur = '#F59E0B';
            icone = '⚠️';
        } else if (scoreSante >= 20) {
            niveauSante = 'FAIBLE';
            couleur = '#EF4444';
            icone = '❌';
        } else {
            niveauSante = 'CRITIQUE';
            couleur = '#7C3AED';
            icone = '🚨';
        }

        res.json({
            success: true,
            data: {
                resume: {
                    total,
                    actifs,
                    inactifs,
                    expires,
                    enAttente,
                    expirentBientot,
                    sansPhoto,
                    sansReservation
                },
                pourcentages: {
                    actifs: pourcentageActifs,
                    expires: pourcentageExpires,
                    photoManquante: pourcentagePhotoManquante,
                    sansReservation: pourcentageSansReservation
                },
                scoreSante: Math.round(scoreSante),
                niveauSante: niveauSante,
                couleur: couleur,
                icone: icone
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
// ROUTE POUR ANALYSE TEMPORELLE
// ============================================

router.get('/analyse-temporelle', async (req, res) => {
    try {
        const tendancesTemporelles = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(*) as nouveaux_abonnes,
                COALESCE(SUM(prix_total), 0) as revenu_mois,
                ROUND(COALESCE(AVG(prix_total), 0), 2) as panier_moyen_mois,
                COUNT(CASE WHEN statut = $1 THEN 1 END) as actifs_mois
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois ASC
        `, ['actif']);

        res.json({
            success: true,
            data: {
                tendancesTemporelles: tendancesTemporelles.rows
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