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
            '/analyse-temporelle',
            '/systeme-sante-global'
        ]
    });
});

// ============================================
// 2. DASHBOARD PRINCIPAL - VISION BOSS
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
        
        // Requêtes principales
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            expirations7jResult,
            expirations15jResult,
            expirations30jResult,
            caMoisResult,
            caTotalResult,
            photoManquanteResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'actif\' AND date_fin >= $1', [today]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'inactif\''),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = \'actif\'', [today, dateFuture7]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = \'actif\'', [today, dateFuture15]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = \'actif\'', [today, dateFuture30]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE date_debut >= $1', [debutMoisStr]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE photo_abonne IS NULL OR photo_abonne = \'\'')
        ]);

        // Calculs
        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
        const expirations7j = parseInt(expirations7jResult.rows[0].count);
        const expirations15j = parseInt(expirations15jResult.rows[0].count);
        const expirations30j = parseInt(expirations30jResult.rows[0].count);
        const caMois = parseFloat(caMoisResult.rows[0].total);
        const caTotal = parseFloat(caTotalResult.rows[0].total);
        const photoManquante = parseInt(photoManquanteResult.rows[0].count);

        // Taux de churn (abonnés perdus ce mois)
        const debutMoisPrecedent = new Date();
        debutMoisPrecedent.setMonth(debutMoisPrecedent.getMonth() - 1);
        debutMoisPrecedent.setDate(1);
        const debutMoisPrecedentStr = debutMoisPrecedent.toISOString().split('T')[0];
        
        const churnResult = await db.query(`
            SELECT COUNT(*) as count FROM clients 
            WHERE statut = 'inactif' 
            AND date_debut >= $1
        `, [debutMoisPrecedentStr]);
        
        const churnCount = parseInt(churnResult.rows[0].count);
        const tauxChurn = total > 0 ? ((churnCount / total) * 100).toFixed(2) : 0;

        // Taux d'utilisation (abonnés qui réservent)
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
        
        // Statistiques principales
        const [
            totalResult,
            actifsResult,
            inactifsResult,
            expiresResult,
            bientotExpiresResult,
            expiresRecemmentResult,
            jamaisRenouvellesResult
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM clients'),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'actif\' AND date_fin >= $1', [today]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE statut = \'inactif\''),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin < $1 AND statut = \'actif\'', [today]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = \'actif\'', [today, dateFuture30]),
            db.query('SELECT COUNT(*) as count FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = \'actif\'', [datePast30, today]),
            db.query(`
                SELECT COUNT(DISTINCT email) as count FROM clients c1
                WHERE statut = 'inactif' 
                AND NOT EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = c1.email 
                    AND c2.date_debut > c1.date_fin
                    AND c2.statut IN ('actif', 'inactif')
                )
            `)
        ]);

        const total = parseInt(totalResult.rows[0].count);
        const actifs = parseInt(actifsResult.rows[0].count);
        const inactifs = parseInt(inactifsResult.rows[0].count);
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
                CASE 
                    WHEN date_fin < $1 THEN 'EXPIRE'
                    WHEN date_fin BETWEEN $1 AND $2 THEN 'EXPIRE_DANS_7_JOURS'
                    WHEN date_fin BETWEEN $1 AND $3 THEN 'EXPIRE_DANS_30_JOURS'
                    ELSE 'AUTRE'
                END as categorie_relance
            FROM clients 
            WHERE statut = 'actif'
            AND (
                date_fin < $3
                OR date_fin BETWEEN $1 AND $3
            )
            ORDER BY date_fin ASC
            LIMIT 100
        `, [today, dateFuture7, dateFuture30]);

        // Statistiques par type d'abonnement
        const statsParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                COUNT(CASE WHEN date_fin < $1 AND statut = 'actif' THEN 1 END) as expires,
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
                    expires,
                    bientotExpires,
                    expiresRecemment,
                    jamaisRenouvelles,
                    pourcentageActifs: total > 0 ? ((actifs / total) * 100).toFixed(2) : 0,
                    pourcentageExpires: total > 0 ? ((expires / total) * 100).toFixed(2) : 0,
                    pourcentageARelancer: actifs > 0 ? ((bientotExpires / actifs) * 100).toFixed(2) : 0
                },
                aRelancer: aRelancerResult.rows,
                statsParType: statsParType.rows,
                recommandations: []
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
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE statut = \'actif\' AND date_fin >= $1', [today])
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
                ROUND(SUM(prix_total) * 100.0 / (SELECT SUM(prix_total) FROM clients), 2) as pourcentage_total
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
                ROUND(SUM(prix_total) * 100.0 / (SELECT SUM(prix_total) FROM clients), 2) as pourcentage_total
            FROM clients
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
                SUM(prix_total) as revenu_tranche,
                ROUND(AVG(prix_total), 2) as prix_moyen
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
                SUM(prix_total) as revenu,
                AVG(prix_total) as panier_moyen,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as utilisateurs_actifs,
                ROUND(COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as taux_utilisation,
                ROUND(SUM(prix_total) / COUNT(*), 2) as revenu_par_client
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
// 5. COMPORTEMENT DES ABONNÉS - CORRIGÉ
// ============================================

router.get('/comportement-abonnes', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Analyse par heure de réservation
        const analyseHeures = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation)::INTEGER as heure,
                COUNT(*) as nombre_reservations,
                COUNT(DISTINCT email) as abonnes_uniques,
                ROUND(AVG(EXTRACT(HOUR FROM heure_reservation)), 1) as heure_moyenne,
                type_abonnement,
                statut
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation), type_abonnement, statut
            ORDER BY heure ASC, nombre_reservations DESC
        `);

        // Top 20 utilisateurs (ceux qui réservent le plus)
        const topUtilisateurs = await db.query(`
            SELECT 
                nom, 
                prenom, 
                email,
                COUNT(*) as nombre_reservations,
                type_abonnement,
                statut,
                SUM(prix_total) as montant_total_depense,
                MIN(heure_reservation) as premiere_reservation,
                MAX(heure_reservation) as derniere_reservation,
                ROUND(AVG(EXTRACT(HOUR FROM heure_reservation)), 1) as heure_moyenne_reservation
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
                date_fin,
                statut,
                (EXTRACT(EPOCH FROM (COALESCE(date_fin, CURRENT_DATE) - date_debut)) / 86400)::INTEGER as duree_abonnement_jours
            FROM clients
            WHERE heure_reservation IS NULL
            AND statut = 'actif'
            AND date_fin >= $1
            ORDER BY prix_total DESC
            LIMIT 20
        `, [today]);

        // Fréquence d'utilisation par type d'abonnement
        const frequenceParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(heure_reservation) as avec_reservations,
                ROUND(COUNT(heure_reservation) * 100.0 / COUNT(*), 2) as taux_utilisation,
                ROUND(AVG(CASE WHEN heure_reservation IS NOT NULL THEN 1 ELSE 0 END), 2) as score_utilisation,
                COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)) as creneaux_differents_utilises
            FROM clients
            WHERE statut = 'actif'
            GROUP BY type_abonnement
            ORDER BY taux_utilisation DESC
        `);

        // Heures les plus populaires
        const heuresPopulaires = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heure_reservation)::INTEGER as heure,
                COUNT(*) as total_reservations,
                COUNT(DISTINCT email) as clients_uniques,
                ROUND(AVG(prix_total), 2) as prix_moyen,
                STRING_AGG(DISTINCT type_abonnement, ', ') as types_abonnements
            FROM clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation)
            ORDER BY total_reservations DESC
            LIMIT 10
        `);

        // Analyse des créneaux sous-utilisés
        const creneauxSousUtilises = await db.query(`
            SELECT 
                heure,
                total_reservations,
                RANK() OVER (ORDER BY total_reservations ASC) as rang_utilisation
            FROM (
                SELECT 
                    EXTRACT(HOUR FROM heure_reservation)::INTEGER as heure,
                    COUNT(*) as total_reservations
                FROM clients
                WHERE heure_reservation IS NOT NULL
                GROUP BY EXTRACT(HOUR FROM heure_reservation)
            ) as stats_heures
            ORDER BY total_reservations ASC
            LIMIT 5
        `);

        // Clients "dormants" (actifs mais sans réservation depuis longtemps)
        const clientsDormants = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER as jours_depuis_debut,
                statut
            FROM clients c1
            WHERE statut = 'actif'
            AND date_fin >= $1
            AND NOT EXISTS (
                SELECT 1 FROM clients c2
                WHERE c2.email = c1.email
                AND c2.heure_reservation IS NOT NULL
                AND c2.date_debut >= CURRENT_DATE - INTERVAL '30 days'
            )
            ORDER BY prix_total DESC
            LIMIT 15
        `, [today]);

        // Statistiques comportement
        const statistiquesComportement = await db.query(`
            SELECT 
                COUNT(DISTINCT email) as total_clients,
                COUNT(DISTINCT CASE WHEN heure_reservation IS NOT NULL THEN email END) as clients_actifs,
                ROUND(AVG(CASE WHEN heure_reservation IS NOT NULL THEN 1 ELSE 0 END) * 100, 2) as taux_activation,
                MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM heure_reservation)::INTEGER) as heure_populaire,
                COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)::INTEGER) as creneaux_utilises,
                ROUND(AVG(EXTRACT(HOUR FROM heure_reservation)), 1) as heure_moyenne
            FROM clients
            WHERE statut = 'actif'
        `);

        res.json({
            success: true,
            data: {
                analyseParHeure: analyseHeures.rows,
                topUtilisateurs: topUtilisateurs.rows,
                sousUtilisateurs: sousUtilisateurs.rows,
                frequenceUtilisation: frequenceParType.rows,
                heuresPopulaires: heuresPopulaires.rows,
                creneauxSousUtilises: creneauxSousUtilises.rows,
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
// 6. FIDÉLITÉ ET DURÉE DE VIE CLIENT (LTV) - CORRIGÉ
// ============================================

router.get('/analyse-fidelite', async (req, res) => {
    try {
        // Durée moyenne d'abonnement par type
        const dureeMoyenne = await db.query(`
            SELECT 
                type_abonnement,
                AVG((EXTRACT(EPOCH FROM (date_fin - date_debut)) / 86400)::INTEGER) as duree_moyenne_jours,
                MIN((EXTRACT(EPOCH FROM (date_fin - date_debut)) / 86400)::INTEGER) as duree_min_jours,
                MAX((EXTRACT(EPOCH FROM (date_fin - date_debut)) / 86400)::INTEGER) as duree_max_jours,
                COUNT(*) as nombre_abonnements
            FROM clients
            WHERE date_fin IS NOT NULL 
            AND date_debut IS NOT NULL
            AND date_fin >= date_debut
            GROUP BY type_abonnement
            ORDER BY duree_moyenne_jours DESC
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
                AVG(prix_total) as panier_moyen,
                (EXTRACT(EPOCH FROM (MAX(date_fin) - MIN(date_debut))) / 86400)::INTEGER as duree_totale_jours,
                ROUND(SUM(prix_total) / COUNT(*), 2) as valeur_moyenne_par_abonnement
            FROM clients
            GROUP BY email, nom, prenom
            HAVING COUNT(*) > 1
            ORDER BY nombre_abonnements DESC, revenu_total DESC
            LIMIT 25
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
                (EXTRACT(EPOCH FROM (COALESCE(MAX(date_fin), CURRENT_DATE) - MIN(date_debut))) / 86400)::INTEGER as duree_vie_jours,
                ROUND(SUM(prix_total) / COUNT(*), 2) as ltv_moyen,
                ROUND(SUM(prix_total) / NULLIF((EXTRACT(EPOCH FROM (COALESCE(MAX(date_fin), CURRENT_DATE) - MIN(date_debut))) / 86400)::INTEGER, 0), 2) as revenu_par_jour,
                type_abonnement as dernier_type_abonnement,
                statut as statut_actuel
            FROM clients
            GROUP BY email, nom, prenom, type_abonnement, statut
            ORDER BY revenu_total DESC
            LIMIT 30
        `);

        // Taux de rétention par période
        const retentionParPeriode = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois_entree,
                COUNT(*) as nouveaux_clients,
                COUNT(CASE WHEN EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = clients.email 
                    AND c2.date_debut > clients.date_fin
                    AND c2.statut IN ('actif', 'inactif')
                ) THEN 1 END) as renouvellements,
                ROUND(COUNT(CASE WHEN EXISTS (
                    SELECT 1 FROM clients c2 
                    WHERE c2.email = clients.email 
                    AND c2.date_debut > clients.date_fin
                    AND c2.statut IN ('actif', 'inactif')
                ) THEN 1 END) * 100.0 / COUNT(*), 2) as taux_retention
            FROM clients
            WHERE date_debut >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois_entree DESC
        `);

        // Segmentation par ancienneté
        const segmentationAnciennete = await db.query(`
            SELECT 
                CASE 
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER < 30 THEN 'Nouveaux (< 1 mois)'
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER BETWEEN 30 AND 180 THEN 'Récent (1-6 mois)'
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER BETWEEN 181 AND 365 THEN 'Fidèle (6-12 mois)'
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER BETWEEN 366 AND 730 THEN 'Très fidèle (1-2 ans)'
                    ELSE 'VIP (> 2 ans)'
                END as segment_anciennete,
                COUNT(*) as nombre_clients,
                SUM(prix_total) as revenu_segment,
                ROUND(AVG(prix_total), 2) as panier_moyen,
                ROUND(SUM(prix_total) * 100.0 / (SELECT SUM(prix_total) FROM clients), 2) as pourcentage_revenu,
                COUNT(CASE WHEN statut = 'actif' THEN 1 END) as actifs,
                COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as utilisateurs_actifs
            FROM clients
            GROUP BY 
                CASE 
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER < 30 THEN 'Nouveaux (< 1 mois)'
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER BETWEEN 30 AND 180 THEN 'Récent (1-6 mois)'
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER BETWEEN 181 AND 365 THEN 'Fidèle (6-12 mois)'
                    WHEN (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER BETWEEN 366 AND 730 THEN 'Très fidèle (1-2 ans)'
                    ELSE 'VIP (> 2 ans)'
                END
            ORDER BY revenu_segment DESC
        `);

        // Clients à forte valeur (Top 10%)
        const clientsForteValeur = await db.query(`
            WITH classement_clients AS (
                SELECT 
                    email,
                    nom,
                    prenom,
                    SUM(prix_total) as revenu_total,
                    COUNT(*) as nombre_abonnements,
                    (EXTRACT(EPOCH FROM (COALESCE(MAX(date_fin), CURRENT_DATE) - MIN(date_debut))) / 86400)::INTEGER as duree_vie_jours,
                    ROW_NUMBER() OVER (ORDER BY SUM(prix_total) DESC) as rang_revenu
                FROM clients
                GROUP BY email, nom, prenom
            )
            SELECT 
                email,
                nom,
                prenom,
                revenu_total,
                nombre_abonnements,
                duree_vie_jours,
                ROUND(revenu_total / NULLIF(duree_vie_jours, 0), 2) as revenu_par_jour,
                rang_revenu
            FROM classement_clients
            WHERE rang_revenu <= (SELECT COUNT(*) * 0.1 FROM classement_clients)
            ORDER BY revenu_total DESC
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
                AVG((EXTRACT(EPOCH FROM (dernier_abonnement - premier_achat)) / 86400)::INTEGER) as duree_vie_moyenne_jours,
                COUNT(CASE WHEN nombre_abonnements > 1 THEN 1 END) as clients_fideles,
                ROUND(COUNT(CASE WHEN nombre_abonnements > 1 THEN 1 END) * 100.0 / COUNT(*), 2) as taux_fidelite
            FROM stats_fidelite
        `);

        res.json({
            success: true,
            data: {
                dureeMoyenne: dureeMoyenne.rows,
                clientsFideles: clientsRenouvellements.rows,
                meilleursClients: ltvClients.rows,
                analyseRetention: retentionParPeriode.rows,
                segmentationAnciennete: segmentationAnciennete.rows,
                clientsForteValeur: clientsForteValeur.rows,
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
// 7. RISQUES ET ALERTES - CORRIGÉ
// ============================================

router.get('/analyse-risques', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Abonnements problématiques détaillés
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
                photo_abonne,
                heure_reservation,
                CASE 
                    WHEN date_fin IS NULL THEN 'DATE_FIN_MANQUANTE'
                    WHEN statut = 'actif' AND date_fin < $1 THEN 'STATUT_INCOHERENT'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'PHOTO_MANQUANTE'
                    WHEN prix_total <= 0 THEN 'PRIX_INVALIDE'
                    WHEN heure_reservation IS NULL AND statut = 'actif' AND date_fin >= $1 THEN 'NON_UTILISATEUR'
                    WHEN statut NOT IN ('actif', 'inactif', 'expire') THEN 'STATUT_INCONNU'
                    ELSE 'AUTRE'
                END as type_probleme,
                CASE 
                    WHEN date_fin IS NULL THEN 'URGENT'
                    WHEN statut = 'actif' AND date_fin < $1 THEN 'CRITIQUE'
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'HAUTE'
                    WHEN prix_total <= 0 THEN 'MOYENNE'
                    ELSE 'BASSE'
                END as niveau_risque,
                (EXTRACT(EPOCH FROM (CURRENT_DATE - COALESCE(date_fin, CURRENT_DATE))) / 86400)::INTEGER as jours_depuis_expiration
            FROM clients
            WHERE 
                date_fin IS NULL 
                OR (statut = 'actif' AND date_fin < $1)
                OR photo_abonne IS NULL 
                OR photo_abonne = ''
                OR prix_total <= 0
                OR (heure_reservation IS NULL AND statut = 'actif' AND date_fin >= $1)
                OR statut NOT IN ('actif', 'inactif', 'expire')
            ORDER BY 
                CASE niveau_risque
                    WHEN 'URGENT' THEN 1
                    WHEN 'CRITIQUE' THEN 2
                    WHEN 'HAUTE' THEN 3
                    WHEN 'MOYENNE' THEN 4
                    ELSE 5
                END,
                date_fin DESC
            LIMIT 50
        `, [today]);

        // Statistiques des problèmes
        const statsProblemes = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN date_fin IS NULL THEN 1 END) as sans_date_fin,
                COUNT(CASE WHEN statut = 'actif' AND date_fin < $1 THEN 1 END) as statut_incoherent,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as prix_invalide,
                COUNT(CASE WHEN heure_reservation IS NULL AND statut = 'actif' AND date_fin >= $1 THEN 1 END) as non_utilisateurs,
                COUNT(CASE WHEN statut NOT IN ('actif', 'inactif', 'expire') THEN 1 END) as statut_inconnu,
                ROUND(COUNT(CASE WHEN 
                    date_fin IS NULL 
                    OR (statut = 'actif' AND date_fin < $1)
                    OR photo_abonne IS NULL 
                    OR photo_abonne = ''
                    OR prix_total <= 0
                    OR (heure_reservation IS NULL AND statut = 'actif' AND date_fin >= $1)
                    OR statut NOT IN ('actif', 'inactif', 'expire')
                THEN 1 END) * 100.0 / COUNT(*), 2) as pourcentage_problemes
            FROM clients
        `, [today]);

        // Doublons potentiels
        const doublonsPotentiels = await db.query(`
            SELECT 
                email,
                COUNT(*) as occurrences,
                STRING_AGG(CONCAT(nom, ' ', prenom, ' (', statut, ')'), ' | ') as noms_statuts,
                STRING_AGG(type_abonnement, ', ') as types_abonnements,
                SUM(prix_total) as total_depense,
                MIN(date_debut) as premier_abonnement,
                MAX(date_fin) as dernier_abonnement
            FROM clients
            GROUP BY email
            HAVING COUNT(*) > 1
            ORDER BY occurrences DESC, total_depense DESC
            LIMIT 15
        `);

        // Abonnements sans activité récente
        const abonnementsInactifs = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                type_abonnement,
                date_debut,
                date_fin,
                statut,
                prix_total,
                (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER as jours_depuis_debut,
                (EXTRACT(EPOCH FROM (CURRENT_DATE - COALESCE(date_fin, CURRENT_DATE))) / 86400)::INTEGER as jours_depuis_fin
            FROM clients
            WHERE statut = 'actif'
            AND date_fin >= $1
            AND NOT EXISTS (
                SELECT 1 FROM clients c2
                WHERE c2.email = clients.email
                AND c2.heure_reservation IS NOT NULL
                AND c2.date_debut >= CURRENT_DATE - INTERVAL '60 days'
            )
            ORDER BY prix_total DESC
            LIMIT 20
        `, [today]);

        // Paiements problématiques
        const paiementsProblematiques = await db.query(`
            SELECT 
                mode_paiement,
                COUNT(*) as nombre_transactions,
                SUM(prix_total) as montant_total,
                AVG(prix_total) as montant_moyen,
                COUNT(CASE WHEN prix_total <= 0 THEN 1 END) as transactions_invalides,
                COUNT(CASE WHEN date_fin IS NULL THEN 1 END) as sans_date_fin
            FROM clients
            GROUP BY mode_paiement
            ORDER BY transactions_invalides DESC, sans_date_fin DESC
        `);

        // Score de risque global
        const scoreRisque = await db.query(`
            SELECT 
                ROUND(
                    (COUNT(CASE WHEN date_fin IS NULL THEN 1 END) * 3.0 +
                     COUNT(CASE WHEN statut = 'actif' AND date_fin < $1 THEN 1 END) * 5.0 +
                     COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) * 2.0 +
                     COUNT(CASE WHEN prix_total <= 0 THEN 1 END) * 4.0) / 
                    (COUNT(*) * 10) * 100, 2
                ) as score_risque_pourcentage
            FROM clients
        `, [today]);

        // Fonction pour déterminer le niveau de risque
        const getNiveauRisque = (score) => {
            if (score >= 80) return 'CRITIQUE';
            if (score >= 60) return 'ÉLEVÉ';
            if (score >= 40) return 'MOYEN';
            if (score >= 20) return 'FAIBLE';
            return 'MINIMAL';
        };

        res.json({
            success: true,
            data: {
                resumeProblemes: statsProblemes.rows[0] || {},
                detailsProblemes: abonnementsProblematiques.rows,
                doublons: doublonsPotentiels.rows,
                abonnementsInactifs: abonnementsInactifs.rows,
                paiementsProblematiques: paiementsProblematiques.rows,
                scoreRisque: parseFloat(scoreRisque.rows[0]?.score_risque_pourcentage || 0),
                niveauRisque: getNiveauRisque(parseFloat(scoreRisque.rows[0]?.score_risque_pourcentage || 0)),
                recommandations: []
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
// 10. ABONNÉS À RELANCER - CORRIGÉ
// ============================================

router.get('/abonnes-a-relancer', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture7 = getDateInFuture(7);
        const dateFuture30 = getDateInFuture(30);
        const datePast30 = getDateInPast(30);
        
        // 1. Abonnés dont l'abonnement expire dans 7 jours (URGENT)
        const expirent7jours = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                (EXTRACT(EPOCH FROM (date_fin - CURRENT_DATE)) / 86400)::INTEGER as jours_restants,
                'URGENT' as priorite,
                'Expire dans moins de 7 jours' as motif
            FROM clients
            WHERE date_fin BETWEEN $1 AND $2
            AND statut = 'actif'
            ORDER BY date_fin ASC
        `, [today, dateFuture7]);

        // 2. Abonnés dont l'abonnement expire dans 15-30 jours (MOYENNE)
        const expirent15a30jours = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                (EXTRACT(EPOCH FROM (date_fin - CURRENT_DATE)) / 86400)::INTEGER as jours_restants,
                'MOYENNE' as priorite,
                'Expire dans 15-30 jours' as motif
            FROM clients
            WHERE date_fin BETWEEN $1 AND $2
            AND statut = 'actif'
            ORDER BY date_fin ASC
        `, [dateFuture7, dateFuture30]);

        // 3. Abonnés dont l'abonnement a expiré récemment (HAUTE)
        const expiresRecemment = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                (EXTRACT(EPOCH FROM (CURRENT_DATE - date_fin)) / 86400)::INTEGER as jours_depuis_expiration,
                'HAUTE' as priorite,
                'A expiré récemment' as motif
            FROM clients
            WHERE date_fin BETWEEN $1 AND $2
            AND statut = 'actif'
            ORDER BY date_fin DESC
        `, [datePast30, today]);

        // 4. Abonnés inactifs depuis plus de 30 jours
        const inactifsLongueDuree = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                statut,
                (EXTRACT(EPOCH FROM (CURRENT_DATE - date_fin)) / 86400)::INTEGER as jours_depuis_inactivite,
                'MOYENNE' as priorite,
                'Inactif depuis plus de 30 jours' as motif
            FROM clients
            WHERE statut = 'inactif'
            AND date_fin < $1
            ORDER BY date_fin DESC
            LIMIT 50
        `, [datePast30]);

        // 5. Abonnés qui n'utilisent pas leur abonnement (dormants)
        const abonnesDormants = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER as jours_depuis_inscription,
                'BASSE' as priorite,
                'N\'utilise pas son abonnement' as motif
            FROM clients
            WHERE statut = 'actif'
            AND date_fin >= $1
            AND heure_reservation IS NULL
            AND (EXTRACT(EPOCH FROM (CURRENT_DATE - date_debut)) / 86400)::INTEGER > 30
            ORDER BY prix_total DESC
            LIMIT 30
        `, [today]);

        // 6. Abonnés à forte valeur à risque de perte
        const forteValeurARisque = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                (EXTRACT(EPOCH FROM (date_fin - CURRENT_DATE)) / 86400)::INTEGER as jours_restants,
                'HAUTE' as priorite,
                'Client à forte valeur - risque de perte' as motif
            FROM clients
            WHERE statut = 'actif'
            AND date_fin BETWEEN $1 AND $2
            AND prix_total > (SELECT AVG(prix_total) FROM clients WHERE statut = 'actif') * 1.5
            ORDER BY prix_total DESC, date_fin ASC
        `, [today, dateFuture30]);

        // Statistiques des relances
        const statsRelances = await db.query(`
            SELECT 
                COUNT(CASE WHEN date_fin BETWEEN $1 AND $2 AND statut = 'actif' THEN 1 END) as expirent_7j,
                COUNT(CASE WHEN date_fin BETWEEN $3 AND $4 AND statut = 'actif' THEN 1 END) as expirent_15a30j,
                COUNT(CASE WHEN date_fin BETWEEN $5 AND $1 AND statut = 'actif' THEN 1 END) as expires_recemment,
                COUNT(CASE WHEN statut = 'inactif' AND date_fin < $5 THEN 1 END) as inactifs_longue_duree,
                SUM(CASE WHEN date_fin BETWEEN $1 AND $4 AND statut = 'actif' THEN prix_total ELSE 0 END) as revenu_a_risque
            FROM clients
        `, [today, dateFuture7, dateFuture7, dateFuture30, datePast30]);

        res.json({
            success: true,
            data: {
                statsRelances: statsRelances.rows[0] || {},
                parPriorite: {
                    urgent: expirent7jours.rows || [],
                    haute: [...(expiresRecemment.rows || []), ...(forteValeurARisque.rows || [])],
                    moyenne: [...(expirent15a30jours.rows || []), ...(inactifsLongueDuree.rows || [])],
                    basse: abonnesDormants.rows || []
                },
                resumeParCategorie: {
                    expirent7jours: (expirent7jours.rows || []).length,
                    expirent15a30jours: (expirent15a30jours.rows || []).length,
                    expiresRecemment: (expiresRecemment.rows || []).length,
                    inactifsLongueDuree: (inactifsLongueDuree.rows || []).length,
                    abonnesDormants: (abonnesDormants.rows || []).length,
                    forteValeurARisque: (forteValeurARisque.rows || []).length
                },
                recommandationsRelances: []
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
// 12. SYSTÈME DE SANTÉ GLOBAL
// ============================================

router.get('/systeme-sante-global', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        
        // Collecte de toutes les métriques
        const metrics = await Promise.all([
            // Métriques de base
            db.query('SELECT COUNT(*) as total FROM clients'),
            db.query('SELECT COUNT(*) as actifs FROM clients WHERE statut = \'actif\' AND date_fin >= $1', [today]),
            db.query('SELECT COUNT(*) as inactifs FROM clients WHERE statut = \'inactif\''),
            
            // Métriques financières
            db.query('SELECT COALESCE(SUM(prix_total), 0) as revenu_total FROM clients'),
            db.query(`
                SELECT COALESCE(SUM(prix_total), 0) as revenu_mois 
                FROM clients 
                WHERE EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(YEAR FROM date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)
            `),
            
            // Métriques d'expiration
            db.query('SELECT COUNT(*) as expires FROM clients WHERE date_fin < $1 AND statut = \'actif\'', [today]),
            db.query('SELECT COUNT(*) as expirent_bientot FROM clients WHERE date_fin BETWEEN $1 AND $2 AND statut = \'actif\'', [today, dateFuture30]),
            
            // Métriques de qualité des données
            db.query('SELECT COUNT(*) as sans_photo FROM clients WHERE photo_abonne IS NULL OR photo_abonne = \'\''),
            db.query('SELECT COUNT(*) as sans_reservation FROM clients WHERE heure_reservation IS NULL AND statut = \'actif\' AND date_fin >= $1', [today]),
            
            // Métriques de fidélité
            db.query('SELECT COUNT(DISTINCT email) as clients_uniques FROM clients'),
            db.query(`
                SELECT AVG(nombre_abonnements) as frequence_moyenne
                FROM (
                    SELECT email, COUNT(*) as nombre_abonnements
                    FROM clients
                    GROUP BY email
                ) as stats
            `)
        ]);

        // Extraction des valeurs
        const total = parseInt(metrics[0].rows[0].total) || 0;
        const actifs = parseInt(metrics[1].rows[0].actifs) || 0;
        const inactifs = parseInt(metrics[2].rows[0].inactifs) || 0;
        const revenuTotal = parseFloat(metrics[3].rows[0].revenu_total) || 0;
        const revenuMois = parseFloat(metrics[4].rows[0].revenu_mois) || 0;
        const expires = parseInt(metrics[5].rows[0].expires) || 0;
        const expirentBientot = parseInt(metrics[6].rows[0].expirent_bientot) || 0;
        const sansPhoto = parseInt(metrics[7].rows[0].sans_photo) || 0;
        const sansReservation = parseInt(metrics[8].rows[0].sans_reservation) || 0;
        const clientsUniques = parseInt(metrics[9].rows[0].clients_uniques) || 0;
        const frequenceMoyenne = parseFloat(metrics[10].rows[0].frequence_moyenne) || 0;

        // Calcul des pourcentages
        const pourcentageActifs = total > 0 ? ((actifs / total) * 100).toFixed(2) : 0;
        const pourcentageInactifs = total > 0 ? ((inactifs / total) * 100).toFixed(2) : 0;
        const pourcentageExpires = total > 0 ? ((expires / total) * 100).toFixed(2) : 0;
        const pourcentagePhotoManquante = total > 0 ? ((sansPhoto / total) * 100).toFixed(2) : 0;
        const pourcentageSansReservation = actifs > 0 ? ((sansReservation / actifs) * 100).toFixed(2) : 0;
        const tauxRenouvellement = clientsUniques > 0 ? ((total / clientsUniques) * 100).toFixed(2) : 0;

        // Score de santé (0-100)
        let scoreSante = 100;
        
        // Pénalités basées sur les métriques
        if (parseFloat(pourcentageExpires) > 10) scoreSante -= 20;
        if (parseFloat(pourcentagePhotoManquante) > 20) scoreSante -= 15;
        if (parseFloat(pourcentageSansReservation) > 30) scoreSante -= 10;
        if (parseFloat(pourcentageActifs) < 50) scoreSante -= 25;
        if (expirentBientot > actifs * 0.3) scoreSante -= 10;
        if (frequenceMoyenne < 1.2) scoreSante -= 5;
        
        scoreSante = Math.max(0, Math.min(100, scoreSante));

        // Détermination du niveau de santé
        let niveauSante, couleur, icone;
        if (scoreSante >= 80) {
            niveauSante = 'EXCELLENT';
            couleur = '#10B981'; // Vert
            icone = '✅';
        } else if (scoreSante >= 60) {
            niveauSante = 'BON';
            couleur = '#3B82F6'; // Bleu
            icone = '👍';
        } else if (scoreSante >= 40) {
            niveauSante = 'MOYEN';
            couleur = '#F59E0B'; // Orange
            icone = '⚠️';
        } else if (scoreSante >= 20) {
            niveauSante = 'FAIBLE';
            couleur = '#EF4444'; // Rouge
            icone = '❌';
        } else {
            niveauSante = 'CRITIQUE';
            couleur = '#7C3AED'; // Violet
            icone = '🚨';
        }

        // Points forts et points faibles
        const pointsForts = [];
        const pointsFaibles = [];

        if (parseFloat(pourcentageActifs) > 70) pointsForts.push('Taux d\'activation élevé');
        if (parseFloat(pourcentagePhotoManquante) < 10) pointsForts.push('Photos complètes');
        if (expirentBientot < actifs * 0.1) pointsForts.push('Peu d\'expirations proches');
        if (frequenceMoyenne > 1.5) pointsForts.push('Fidélité client élevée');

        if (parseFloat(pourcentageExpires) > 15) pointsFaibles.push('Taux d\'expiration élevé');
        if (parseFloat(pourcentageSansReservation) > 40) pointsFaibles.push('Faible utilisation');
        if (parseFloat(pourcentagePhotoManquante) > 30) pointsFaibles.push('Photos manquantes');
        if (expirentBientot > actifs * 0.4) pointsFaibles.push('Risque de churn imminent');

        res.json({
            success: true,
            data: {
                resume: {
                    total,
                    actifs,
                    inactifs,
                    expires,
                    expirentBientot,
                    sansPhoto,
                    sansReservation,
                    revenuTotal,
                    revenuMois,
                    clientsUniques,
                    frequenceMoyenne: frequenceMoyenne.toFixed(2)
                },
                pourcentages: {
                    actifs: parseFloat(pourcentageActifs),
                    inactifs: parseFloat(pourcentageInactifs),
                    expires: parseFloat(pourcentageExpires),
                    photoManquante: parseFloat(pourcentagePhotoManquante),
                    sansReservation: parseFloat(pourcentageSansReservation),
                    tauxRenouvellement: parseFloat(tauxRenouvellement)
                },
                scoreSante: Math.round(scoreSante),
                niveauSante: niveauSante,
                couleur: couleur,
                icone: icone,
                pointsForts: pointsForts,
                pointsFaibles: pointsFaibles,
                recommendations: [],
                tendances: [],
                projections: []
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
// ANALYSE PAR TYPE D'ABONNEMENT
// ============================================

router.get('/analyse-par-type', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture30 = getDateInFuture(30);
        
        // Analyse détaillée par type d'abonnement
        const analyseParType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as actifs,
                COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as inactifs,
                COUNT(CASE WHEN statut = 'expire' THEN 1 END) as expires,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as prix_moyen,
                MIN(prix_total) as prix_min,
                MAX(prix_total) as prix_max,
                COUNT(heure_reservation) as reservations,
                ROUND(COUNT(heure_reservation) * 100.0 / COUNT(*), 2) as taux_utilisation,
                AVG((EXTRACT(EPOCH FROM (COALESCE(date_fin, CURRENT_DATE) - date_debut)) / 86400)::INTEGER) as duree_moyenne_jours,
                COUNT(DISTINCT mode_paiement) as modes_paiement_utilises,
                COUNT(CASE WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 1 END) as sans_photo,
                ROUND(AVG((EXTRACT(EPOCH FROM (date_fin - date_debut)) / 86400)::INTEGER), 1) as duree_contrat_moyenne_jours,
                COUNT(CASE WHEN date_fin BETWEEN $1 AND $2 THEN 1 END) as expirent_bientot
            FROM clients
            GROUP BY type_abonnement
            ORDER BY revenu_total DESC
        `, [today, dateFuture30]);

        // Distribution par type pour graphique
        const distributionType = await db.query(`
            SELECT 
                type_abonnement,
                COUNT(*) as nombre,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM clients), 2) as pourcentage_total,
                ROUND(SUM(prix_total) * 100.0 / (SELECT SUM(prix_total) FROM clients), 2) as pourcentage_revenu,
                ROUND(AVG(prix_total), 2) as valeur_moyenne,
                RANK() OVER (ORDER BY COUNT(*) DESC) as rang_popularite,
                RANK() OVER (ORDER BY SUM(prix_total) DESC) as rang_rentabilite
            FROM clients
            GROUP BY type_abonnement
            ORDER BY nombre DESC
        `);

        // Évolution des abonnements par type (derniers 6 mois)
        const evolutionParType = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                type_abonnement,
                COUNT(*) as nouveaux_abonnes,
                SUM(prix_total) as revenu_mois,
                ROUND(AVG(prix_total), 2) as panier_moyen_mois
            FROM clients
            WHERE date_debut >= CURRENT_DATE - INTERVAL '6 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM'), type_abonnement
            ORDER BY mois DESC, nouveaux_abonnes DESC
        `);

        // Rentabilité par type d'abonnement
        const rentabiliteParType = await db.query(`
            WITH stats_type AS (
                SELECT 
                    type_abonnement,
                    COUNT(*) as total_clients,
                    SUM(prix_total) as revenu_total,
                    AVG(prix_total) as prix_moyen,
                    COUNT(CASE WHEN heure_reservation IS NOT NULL THEN 1 END) as utilisateurs_actifs,
                    AVG((EXTRACT(EPOCH FROM (COALESCE(date_fin, CURRENT_DATE) - date_debut)) / 86400)::INTEGER) as duree_moyenne_jours
                FROM clients
                GROUP BY type_abonnement
            )
            SELECT 
                type_abonnement,
                total_clients,
                revenu_total,
                prix_moyen,
                utilisateurs_actifs,
                duree_moyenne_jours,
                ROUND(utilisateurs_actifs * 100.0 / total_clients, 2) as taux_activation,
                ROUND(revenu_total / NULLIF(total_clients, 0), 2) as revenu_par_client,
                ROUND(revenu_total / NULLIF(duree_moyenne_jours, 0), 2) as revenu_par_jour_moyen,
                RANK() OVER (ORDER BY revenu_total DESC) as rang_revenu,
                RANK() OVER (ORDER BY taux_activation DESC) as rang_activation
            FROM stats_type
            ORDER BY revenu_total DESC
        `);

        // Clients par type d'abonnement (top 10 par type)
        const clientsParType = await db.query(`
            WITH ranked_clients AS (
                SELECT 
                    type_abonnement,
                    nom,
                    prenom,
                    email,
                    prix_total,
                    date_debut,
                    date_fin,
                    statut,
                    (EXTRACT(EPOCH FROM (COALESCE(date_fin, CURRENT_DATE) - date_debut)) / 86400)::INTEGER as duree_abonnement_jours,
                    ROW_NUMBER() OVER (PARTITION BY type_abonnement ORDER BY prix_total DESC) as rang_prix
                FROM clients
            )
            SELECT * FROM ranked_clients WHERE rang_prix <= 10
            ORDER BY type_abonnement, prix_total DESC
        `);

        res.json({
            success: true,
            data: {
                analyseDetaillee: analyseParType.rows,
                distribution: distributionType.rows,
                evolution: evolutionParType.rows,
                rentabilite: rentabiliteParType.rows,
                topClientsParType: clientsParType.rows,
                recommandationsTypes: []
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
// STATISTIQUES GLOBALES
// ============================================

router.get('/stats-globales', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const [
            statsGeneralResult,
            statsFinancierResult,
            statsUtilisationResult,
            statsDemographieResult
        ] = await Promise.all([
            // Statistiques générales
            db.query(`
                SELECT 
                    COUNT(*) as total_clients,
                    COUNT(DISTINCT email) as clients_uniques,
                    COUNT(CASE WHEN statut = 'actif' AND date_fin >= $1 THEN 1 END) as abonnes_actifs,
                    COUNT(CASE WHEN statut = 'inactif' THEN 1 END) as abonnes_inactifs,
                    COUNT(CASE WHEN statut = 'expire' THEN 1 END) as abonnes_expires,
                    COUNT(DISTINCT type_abonnement) as types_abonnement_differents,
                    COUNT(DISTINCT mode_paiement) as modes_paiement_differents,
                    ROUND(AVG((EXTRACT(EPOCH FROM (COALESCE(date_fin, CURRENT_DATE) - date_debut)) / 86400)::INTEGER), 1) as duree_moyenne_jours
                FROM clients
            `, [today]),
            
            // Statistiques financières
            db.query(`
                SELECT 
                    COALESCE(SUM(prix_total), 0) as revenu_total,
                    COALESCE(AVG(prix_total), 0) as panier_moyen,
                    MIN(prix_total) as prix_min,
                    MAX(prix_total) as prix_max,
                    COUNT(CASE WHEN prix_total < 100 THEN 1 END) as abonnements_bas_prix,
                    COUNT(CASE WHEN prix_total BETWEEN 100 AND 500 THEN 1 END) as abonnements_moyen_prix,
                    COUNT(CASE WHEN prix_total > 500 THEN 1 END) as abonnements_haut_prix,
                    ROUND(STDDEV(prix_total), 2) as ecart_type_prix
                FROM clients
            `),
            
            // Statistiques d'utilisation
            db.query(`
                SELECT 
                    COUNT(heure_reservation) as reservations_totales,
                    COUNT(DISTINCT EXTRACT(HOUR FROM heure_reservation)::INTEGER) as creneaux_utilises,
                    COUNT(DISTINCT email) as abonnes_actifs_utilisateurs,
                    ROUND(COUNT(heure_reservation) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_utilisation_global,
                    ROUND(AVG(EXTRACT(HOUR FROM heure_reservation)), 1) as heure_moyenne_reservation,
                    MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM heure_reservation)::INTEGER) as heure_la_plus_frequente
                FROM clients
                WHERE statut = 'actif'
            `),
            
            // Démographie des abonnés
            db.query(`
                SELECT 
                    COUNT(CASE WHEN type_abonnement LIKE '%premium%' OR type_abonnement LIKE '%VIP%' THEN 1 END) as abonnes_premium,
                    COUNT(CASE WHEN type_abonnement LIKE '%standard%' OR type_abonnement LIKE '%basique%' THEN 1 END) as abonnes_standard,
                    COUNT(CASE WHEN type_abonnement LIKE '%essai%' OR type_abonnement LIKE '%test%' THEN 1 END) as abonnes_essai,
                    COUNT(CASE WHEN mode_paiement LIKE '%cash%' OR mode_paiement LIKE '%espèces%' THEN 1 END) as paiements_cash,
                    COUNT(CASE WHEN mode_paiement LIKE '%carte%' OR mode_paiement LIKE '%credit%' THEN 1 END) as paiements_carte,
                    COUNT(CASE WHEN mode_paiement LIKE '%mobile%' OR mode_paiement LIKE '%momo%' THEN 1 END) as paiements_mobile,
                    COUNT(CASE WHEN EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE) THEN 1 END) as nouveaux_ce_mois
                FROM clients
            `)
        ]);

        // Tendances temporelles
        const tendancesTemporelles = await db.query(`
            SELECT 
                TO_CHAR(date_debut, 'YYYY-MM') as mois,
                COUNT(*) as nouveaux_abonnes,
                SUM(prix_total) as revenu_mois,
                ROUND(AVG(prix_total), 2) as panier_moyen_mois,
                COUNT(CASE WHEN statut = 'actif' AND date_fin >= CURRENT_DATE THEN 1 END) as actifs_mois,
                COUNT(DISTINCT email) as clients_uniques_mois
            FROM clients
            WHERE date_debut >= CURRENT_DATE - INTERVAL '6 months'
            GROUP BY TO_CHAR(date_debut, 'YYYY-MM')
            ORDER BY mois DESC
        `);

        // Distribution géographique
        const distributionGeographique = await db.query(`
            SELECT 
                CASE 
                    WHEN telephone LIKE '+221%' OR telephone LIKE '77%' OR telephone LIKE '78%' THEN 'Sénégal'
                    WHEN telephone LIKE '+33%' OR telephone LIKE '06%' OR telephone LIKE '07%' THEN 'France'
                    WHEN telephone LIKE '+1%' THEN 'Amérique du Nord'
                    WHEN telephone LIKE '+44%' THEN 'Royaume-Uni'
                    ELSE 'Autre'
                END as pays,
                COUNT(*) as nombre_clients,
                SUM(prix_total) as revenu_pays,
                ROUND(AVG(prix_total), 2) as panier_moyen_pays,
                COUNT(DISTINCT type_abonnement) as types_abonnement_pays
            FROM clients
            WHERE telephone IS NOT NULL
            GROUP BY 
                CASE 
                    WHEN telephone LIKE '+221%' OR telephone LIKE '77%' OR telephone LIKE '78%' THEN 'Sénégal'
                    WHEN telephone LIKE '+33%' OR telephone LIKE '06%' OR telephone LIKE '07%' THEN 'France'
                    WHEN telephone LIKE '+1%' THEN 'Amérique du Nord'
                    WHEN telephone LIKE '+44%' THEN 'Royaume-Uni'
                    ELSE 'Autre'
                END
            ORDER BY nombre_clients DESC
        `);

        // Métriques avancées
        const metriquesAvancees = await db.query(`
            WITH stats_avancees AS (
                SELECT 
                    -- Churn rate (approximatif)
                    COUNT(CASE WHEN statut = 'inactif' AND date_debut >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(CASE WHEN date_debut >= CURRENT_DATE - INTERVAL '60 days' THEN 1 END), 0) as churn_rate_30j,
                    
                    -- Customer Lifetime Value (CLV) moyen
                    AVG(total_revenu) as clv_moyen,
                    
                    -- Taux de rétention
                    COUNT(CASE WHEN nombre_abonnements > 1 THEN 1 END) * 100.0 / 
                    NULLIF(COUNT(*), 0) as taux_retention
                FROM (
                    SELECT 
                        email,
                        COUNT(*) as nombre_abonnements,
                        SUM(prix_total) as total_revenu
                    FROM clients
                    GROUP BY email
                ) as stats_clients
            )
            SELECT 
                ROUND(COALESCE(churn_rate_30j, 0), 2) as churn_rate_30j,
                ROUND(COALESCE(clv_moyen, 0), 2) as clv_moyen,
                ROUND(COALESCE(taux_retention, 0), 2) as taux_retention
            FROM stats_avancees
        `);

        res.json({
            success: true,
            data: {
                general: statsGeneralResult.rows[0] || {},
                financier: statsFinancierResult.rows[0] || {},
                utilisation: statsUtilisationResult.rows[0] || {},
                demographie: statsDemographieResult.rows[0] || {},
                tendancesTemporelles: tendancesTemporelles.rows,
                distributionGeographique: distributionGeographique.rows,
                metriquesAvancees: metriquesAvancees.rows[0] || {}
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

export default router;