import express from 'express';
import moment from 'moment';
const router = express.Router();
import db from '../db.js';

// ============================
// 1. SANTÉ DES ABONNEMENTS
// ============================

// Route pour la santé globale des abonnements
router.get('/sante-globale', async (req, res) => {
    try {
        const sql = `
            SELECT 
                COUNT(*) as total_abonnes,
                SUM(CASE WHEN statut = 'actif' AND date_fin >= CURRENT_DATE THEN 1 ELSE 0 END) as abonnes_actifs,
                SUM(CASE WHEN statut = 'inactif' OR date_fin < CURRENT_DATE THEN 1 ELSE 0 END) as abonnes_inactifs,
                SUM(CASE WHEN date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days' THEN 1 ELSE 0 END) as fin_prochaine_30j,
                SUM(CASE WHEN date_fin < CURRENT_DATE - INTERVAL '30 days' THEN 1 ELSE 0 END) as expires_non_renouveles,
                ROUND(100.0 * SUM(CASE WHEN statut = 'actif' AND date_fin >= CURRENT_DATE THEN 1 ELSE 0 END) / COUNT(*), 2) as pourcentage_actifs,
                ROUND(100.0 * SUM(CASE WHEN statut = 'inactif' OR date_fin < CURRENT_DATE THEN 1 ELSE 0 END) / COUNT(*), 2) as pourcentage_inactifs
            FROM creneaux_clients
        `;

        const result = await db.query(sql);
        
        res.json({
            success: true,
            data: {
                total_abonnes: parseInt(result.rows[0].total_abonnes),
                abonnes_actifs: parseInt(result.rows[0].abonnes_actifs),
                abonnes_inactifs: parseInt(result.rows[0].abonnes_inactifs),
                fin_prochaine_30j: parseInt(result.rows[0].fin_prochaine_30j),
                expires_non_renouveles: parseInt(result.rows[0].expires_non_renouveles),
                pourcentage_actifs: parseFloat(result.rows[0].pourcentage_actifs),
                pourcentage_inactifs: parseFloat(result.rows[0].pourcentage_inactifs),
                taux_churn: parseFloat(result.rows[0].pourcentage_inactifs)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// Route pour les abonnements arrivant à expiration
router.get('/expirations-prochaines', async (req, res) => {
    try {
        const { jours = 30 } = req.query;
        
        const sql = `
            SELECT 
                nom, 
                prenom, 
                email, 
                telephone,
                type_abonnement,
                date_fin,
                prix_total,
                mode_paiement,
                DATEDIFF(date_fin, CURRENT_DATE) as jours_restants
            FROM creneaux_clients
            WHERE date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL $1 DAYS
                AND statut = 'actif'
            ORDER BY date_fin ASC
        `;

        const result = await db.query(sql, [jours]);
        
        // Grouper par périodes
        const groupes = {
            '7_jours': result.rows.filter(r => r.jours_restants <= 7),
            '15_jours': result.rows.filter(r => r.jours_restants > 7 && r.jours_restants <= 15),
            '30_jours': result.rows.filter(r => r.jours_restants > 15 && r.jours_restants <= 30)
        };

        res.json({
            success: true,
            data: {
                total: result.rows.length,
                groupes,
                details: result.rows
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// ============================
// 2. ANALYSE FINANCIÈRE
// ============================

// Revenu total et par type d'abonnement
router.get('/revenus', async (req, res) => {
    try {
        const { periode = 'mois' } = req.query;
        
        let conditionPeriode = '';
        if (periode === 'mois') {
            conditionPeriode = "WHERE EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)";
        } else if (periode === 'annee') {
            conditionPeriode = "WHERE EXTRACT(YEAR FROM date_debut) = EXTRACT(YEAR FROM CURRENT_DATE)";
        }

        const sql = `
            SELECT 
                type_abonnement,
                COUNT(*) as nombre_abonnes,
                SUM(prix_total) as revenu_total,
                AVG(prix_total) as prix_moyen,
                mode_paiement,
                ROUND(100.0 * SUM(prix_total) / (SELECT SUM(prix_total) FROM creneaux_clients ${conditionPeriode}), 2) as pourcentage_revenu
            FROM creneaux_clients
            ${conditionPeriode}
            GROUP BY type_abonnement, mode_paiement
            ORDER BY revenu_total DESC
        `;

        const result = await db.query(sql);
        
        // Calcul du revenu total
        const revenuTotal = result.rows.reduce((sum, row) => sum + parseFloat(row.revenu_total), 0);
        
        res.json({
            success: true,
            data: {
                revenu_total: revenuTotal,
                par_type_abonnement: result.rows,
                statistiques: {
                    nombre_types_differents: result.rows.length,
                    type_plus_rentable: result.rows[0] || null,
                    revenu_moyen_par_abonne: revenuTotal / result.rows.reduce((sum, row) => sum + parseInt(row.nombre_abonnes), 0) || 0
                }
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// ============================
// 3. COMPORTEMENT DES ABONNÉS
// ============================

// Analyse des heures de réservation
router.get('/comportement-reservations', async (req, res) => {
    try {
        const sql = `
            SELECT 
                EXTRACT(HOUR FROM heure_reservation) as heure,
                COUNT(*) as nombre_reservations,
                type_abonnement,
                ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pourcentage_total
            FROM creneaux_clients
            WHERE heure_reservation IS NOT NULL
            GROUP BY EXTRACT(HOUR FROM heure_reservation), type_abonnement
            ORDER BY heure, nombre_reservations DESC
        `;

        const result = await db.query(sql);
        
        // Créer une heatmap par heure
        const heatmap = {};
        result.rows.forEach(row => {
            const heure = row.heure;
            if (!heatmap[heure]) heatmap[heure] = [];
            heatmap[heure].push({
                type_abonnement: row.type_abonnement,
                nombre_reservations: parseInt(row.nombre_reservations),
                pourcentage: parseFloat(row.pourcentage_total)
            });
        });

        // Trouver les heures de pointe
        const heuresPointe = Object.entries(heatmap)
            .map(([heure, data]) => ({
                heure: parseInt(heure),
                total_reservations: data.reduce((sum, d) => sum + d.nombre_reservations, 0)
            }))
            .sort((a, b) => b.total_reservations - a.total_reservations)
            .slice(0, 3);

        res.json({
            success: true,
            data: {
                heatmap,
                heures_pointe: heuresPointe,
                statistiques: {
                    heure_plus_frequente: heuresPointe[0] || null,
                    distribution_par_type: result.rows
                }
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// Abonnés sous-utilisateurs (paient mais n'utilisent pas)
router.get('/sous-utilisateurs', async (req, res) => {
    try {
        const sql = `
            SELECT 
                nom, 
                prenom, 
                email, 
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                heure_reservation,
                CASE 
                    WHEN heure_reservation IS NULL THEN 'Jamais utilisé'
                    ELSE 'Peu utilisé'
                END as statut_utilisation,
                DATEDIFF(CURRENT_DATE, date_debut) as jours_abonnement
            FROM creneaux_clients
            WHERE statut = 'actif' 
                AND (heure_reservation IS NULL OR DATEDIFF(CURRENT_DATE, date_debut) > 30)
            ORDER BY prix_total DESC, jours_abonnement DESC
        `;

        const result = await db.query(sql);
        
        const analyse = {
            total_sous_utilisateurs: result.rows.length,
            valeur_perdue_totale: result.rows.reduce((sum, row) => sum + parseFloat(row.prix_total), 0),
            par_type_abonnement: {},
            liste_prioritaire: result.rows.slice(0, 20) // Top 20 à relancer
        };

        // Grouper par type d'abonnement
        result.rows.forEach(row => {
            const type = row.type_abonnement;
            if (!analyse.par_type_abonnement[type]) {
                analyse.par_type_abonnement[type] = {
                    count: 0,
                    revenu_perdu: 0
                };
            }
            analyse.par_type_abonnement[type].count++;
            analyse.par_type_abonnement[type].revenu_perdu += parseFloat(row.prix_total);
        });

        res.json({
            success: true,
            data: analyse
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// ============================
// 4. FIDÉLITÉ & LTV (Lifetime Value)
// ============================

// Analyse de la fidélité des clients
router.get('/fidelite-ltv', async (req, res) => {
    try {
        const sql = `
            SELECT 
                email,
                nom, 
                prenom,
                COUNT(*) as nombre_renouvellements,
                MIN(date_debut) as premiere_inscription,
                MAX(date_fin) as dernier_renouvellement,
                SUM(prix_total) as ltv_total,
                AVG(prix_total) as valeur_moyenne_par_abonnement,
                DATEDIFF(MAX(date_fin), MIN(date_debut)) as duree_totale_jours,
                type_abonnement,
                mode_paiement
            FROM creneaux_clients
            GROUP BY email, nom, prenom, type_abonnement, mode_paiement
            HAVING COUNT(*) > 1
            ORDER BY ltv_total DESC, nombre_renouvellements DESC
        `;

        const result = await db.query(sql);
        
        // Catégoriser les clients par LTV
        const categories = {
            vip: result.rows.filter(r => parseFloat(r.ltv_total) > 1000),
            fidelise: result.rows.filter(r => parseFloat(r.ltv_total) > 500 && parseFloat(r.ltv_total) <= 1000),
            regulier: result.rows.filter(r => parseFloat(r.ltv_total) > 100 && parseFloat(r.ltv_total) <= 500),
            nouveau: result.rows.filter(r => parseFloat(r.ltv_total) <= 100)
        };

        const statistiques = {
            total_clients_fideles: result.rows.length,
            ltv_moyen: result.rows.reduce((sum, r) => sum + parseFloat(r.ltv_total), 0) / result.rows.length || 0,
            renouvellement_moyen: result.rows.reduce((sum, r) => sum + parseInt(r.nombre_renouvellements), 0) / result.rows.length || 0,
            duree_moyenne_jours: result.rows.reduce((sum, r) => sum + parseInt(r.duree_totale_jours), 0) / result.rows.length || 0
        };

        res.json({
            success: true,
            data: {
                categories,
                statistiques,
                top_10_clients: result.rows.slice(0, 10)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// ============================
// 5. RISQUES & ALERTES
// ============================

// Détection des risques
router.get('/risques-alertes', async (req, res) => {
    try {
        const alerts = await Promise.all([
            // Abonnements sans date de fin
            db.query(`
                SELECT COUNT(*) as count 
                FROM creneaux_clients 
                WHERE date_fin IS NULL OR date_fin = ''
            `),
            
            // Abonnés sans photo
            db.query(`
                SELECT COUNT(*) as count 
                FROM creneaux_clients 
                WHERE photo_abonne IS NULL OR photo_abonne = ''
            `),
            
            // Incohérences de dates
            db.query(`
                SELECT COUNT(*) as count 
                FROM creneaux_clients 
                WHERE date_debut > date_fin
            `),
            
            // Paiements manquants
            db.query(`
                SELECT COUNT(*) as count 
                FROM creneaux_clients 
                WHERE mode_paiement IS NULL OR mode_paiement = ''
            `),
            
            // Statut actif mais date fin passée
            db.query(`
                SELECT COUNT(*) as count 
                FROM creneaux_clients 
                WHERE statut = 'actif' AND date_fin < CURRENT_DATE
            `)
        ]);

        const details = await Promise.all([
            db.query(`
                SELECT nom, prenom, email, date_debut, date_fin 
                FROM creneaux_clients 
                WHERE date_fin IS NULL OR date_fin = ''
                LIMIT 10
            `),
            
            db.query(`
                SELECT nom, prenom, email 
                FROM creneaux_clients 
                WHERE photo_abonne IS NULL OR photo_abonne = ''
                LIMIT 10
            `),
            
            db.query(`
                SELECT nom, prenom, email, date_debut, date_fin 
                FROM creneaux_clients 
                WHERE statut = 'actif' AND date_fin < CURRENT_DATE
                LIMIT 10
            `)
        ]);

        const alertes = {
            sans_date_fin: parseInt(alerts[0].rows[0].count),
            sans_photo: parseInt(alerts[1].rows[0].count),
            incoherence_dates: parseInt(alerts[2].rows[0].count),
            paiements_manquants: parseInt(alerts[3].rows[0].count),
            actifs_expires: parseInt(alerts[4].rows[0].count),
            total_risques: alerts.reduce((sum, alert, idx) => sum + parseInt(alert.rows[0].count), 0),
            details: {
                liste_sans_date_fin: details[0].rows,
                liste_sans_photo: details[1].rows,
                liste_actifs_expires: details[2].rows
            }
        };

        res.json({
            success: true,
            data: alertes,
            recommendations: [
                "Nettoyer les abonnements sans date de fin",
                "Compléter les photos manquantes",
                "Corriger les statuts incohérents",
                "Mettre à jour les modes de paiement"
            ]
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// ============================
// 6. SÉCURITÉ & CONTRÔLE
// ============================

// Vérification des photos et sécurité
router.get('/securite-controle', async (req, res) => {
    try {
        const sql = `
            SELECT 
                email,
                nom, 
                prenom,
                CASE 
                    WHEN photo_abonne IS NULL OR photo_abonne = '' THEN 'MANQUANTE'
                    WHEN LENGTH(photo_abonne) < 100 THEN 'INCOMPLETE'
                    ELSE 'VALIDE'
                END as statut_photo,
                type_abonnement,
                date_debut,
                date_fin,
                heure_reservation
            FROM creneaux_clients
            ORDER BY statut_photo, date_debut DESC
        `;

        const result = await db.query(sql);
        
        const analyse = {
            total_verifies: result.rows.length,
            par_statut_photo: {
                valide: result.rows.filter(r => r.statut_photo === 'VALIDE').length,
                incomplete: result.rows.filter(r => r.statut_photo === 'INCOMPLETE').length,
                manquante: result.rows.filter(r => r.statut_photo === 'MANQUANTE').length
            },
            photos_manquantes: result.rows.filter(r => r.statut_photo !== 'VALIDE'),
            pourcentage_conformite: (result.rows.filter(r => r.statut_photo === 'VALIDE').length / result.rows.length * 100).toFixed(2)
        };

        res.json({
            success: true,
            data: analyse,
            actions_recommandees: [
                "Relancer les abonnés sans photo",
                "Vérifier la qualité des photos existantes",
                "Mettre en place un processus de vérification photo à l'entrée"
            ]
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// ============================
// 7. DASHBOARD COMPLET (BOSS VIEW)
// ============================

// Vue globale pour le dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const [
            santeGlobale,
            revenusMois,
            expirations,
            comportement,
            risques,
            fidelite,
            securite
        ] = await Promise.all([
            // 1. Santé globale
            db.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN statut = 'actif' AND date_fin >= CURRENT_DATE THEN 1 ELSE 0 END) as actifs,
                    SUM(CASE WHEN statut = 'inactif' OR date_fin < CURRENT_DATE THEN 1 ELSE 0 END) as inactifs
                FROM creneaux_clients
            `),
            
            // 2. Revenus du mois
            db.query(`
                SELECT 
                    SUM(prix_total) as revenu_mois,
                    COUNT(*) as nouveaux_abonnements
                FROM creneaux_clients
                WHERE EXTRACT(MONTH FROM date_debut) = EXTRACT(MONTH FROM CURRENT_DATE)
            `),
            
            // 3. Expirations prochaines
            db.query(`
                SELECT 
                    COUNT(*) as expirations_30j,
                    SUM(CASE WHEN DATEDIFF(date_fin, CURRENT_DATE) <= 7 THEN 1 ELSE 0 END) as expirations_7j
                FROM creneaux_clients
                WHERE date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
                    AND statut = 'actif'
            `),
            
            // 4. Taux d'utilisation
            db.query(`
                SELECT 
                    ROUND(100.0 * SUM(CASE WHEN heure_reservation IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as taux_utilisation
                FROM creneaux_clients
                WHERE statut = 'actif'
            `),
            
            // 5. Top 3 types d'abonnement
            db.query(`
                SELECT 
                    type_abonnement,
                    COUNT(*) as nombre,
                    SUM(prix_total) as revenu
                FROM creneaux_clients
                GROUP BY type_abonnement
                ORDER BY revenu DESC
                LIMIT 3
            `),
            
            // 6. Taux de renouvellement
            db.query(`
                SELECT 
                    COUNT(DISTINCT email) as clients_fideles,
                    AVG(nombre_renouvellements) as renouvellement_moyen
                FROM (
                    SELECT email, COUNT(*) as nombre_renouvellements
                    FROM creneaux_clients
                    GROUP BY email
                    HAVING COUNT(*) > 1
                ) as subquery
            `),
            
            // 7. Problèmes de sécurité
            db.query(`
                SELECT 
                    COUNT(*) as problemes_securite
                FROM creneaux_clients
                WHERE photo_abonne IS NULL 
                    OR photo_abonne = ''
                    OR date_fin IS NULL
            `)
        ]);

        const dashboard = {
            kpis: {
                total_abonnes: parseInt(santeGlobale.rows[0].total),
                abonnes_actifs: parseInt(santeGlobale.rows[0].actifs),
                taux_activite: ((parseInt(santeGlobale.rows[0].actifs) / parseInt(santeGlobale.rows[0].total)) * 100).toFixed(1),
                revenu_mois: parseFloat(revenusMois.rows[0].revenu_mois) || 0,
                nouveaux_abonnements: parseInt(revenusMois.rows[0].nouveaux_abonnements),
                expirations_30j: parseInt(expirations.rows[0].expirations_30j),
                expirations_7j: parseInt(expirations.rows[0].expirations_7j),
                taux_utilisation: parseFloat(comportement.rows[0].taux_utilisation),
                problemes_securite: parseInt(securite.rows[0].problemes_securite)
            },
            top_abonnements: risques.rows,
            fidelite: {
                clients_fideles: parseInt(fidelite.rows[0].clients_fideles) || 0,
                renouvellement_moyen: parseFloat(fidelite.rows[0].renouvellement_moyen) || 0
            },
            alertes: {
                priorite_haute: expirations.rows[0].expirations_7j > 10,
                priorite_moyenne: securite.rows[0].problemes_securite > 5,
                priorite_basse: comportement.rows[0].taux_utilisation < 50
            }
        };

        res.json({
            success: true,
            data: dashboard,
            dernier_maj: new Date().toISOString()
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// ============================
// ANALYSES COMPLÉMENTAIRES
// ============================

// Prévision des revenus
router.get('/previsions-revenus', async (req, res) => {
    try {
        const sql = `
            SELECT 
                EXTRACT(MONTH FROM date_debut) as mois,
                EXTRACT(YEAR FROM date_debut) as annee,
                COUNT(*) as nouveaux_abonnes,
                SUM(prix_total) as revenu_mensuel,
                AVG(prix_total) as valeur_moyenne,
                type_abonnement
            FROM creneaux_clients
            WHERE date_debut >= CURRENT_DATE - INTERVAL '12 months'
            GROUP BY EXTRACT(MONTH FROM date_debut), EXTRACT(YEAR FROM date_debut), type_abonnement
            ORDER BY annee DESC, mois DESC
        `;

        const result = await db.query(sql);
        
        // Calcul des tendances
        const derniersMois = result.rows.slice(0, 3);
        const moyenneRevenu = derniersMois.reduce((sum, r) => sum + parseFloat(r.revenu_mensuel), 0) / derniersMois.length;
        
        // Prévision pour le mois prochain
        const tauxCroissance = derniersMois.length >= 2 ? 
            ((parseFloat(derniersMois[0].revenu_mensuel) - parseFloat(derniersMois[1].revenu_mensuel)) / parseFloat(derniersMois[1].revenu_mensuel)) * 100 : 0;

        const previsions = {
            historique: result.rows,
            statistiques: {
                revenu_moyen_12mois: moyenneRevenu,
                taux_croissance: tauxCroissance.toFixed(2),
                mois_meilleur_performance: result.rows.reduce((max, r) => 
                    parseFloat(r.revenu_mensuel) > parseFloat(max.revenu_mensuel) ? r : max
                , result.rows[0]),
                tendance: tauxCroissance > 5 ? 'HAUSSE' : tauxCroissance < -5 ? 'BAISSE' : 'STABLE'
            },
            prediction_mois_prochain: {
                revenu_estime: moyenneRevenu * (1 + tauxCroissance/100),
                nouveaux_abonnes_estimes: derniersMois.reduce((sum, r) => sum + parseInt(r.nouveaux_abonnes), 0) / derniersMois.length
            }
        };

        res.json({
            success: true,
            data: previsions
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// Analyse des canaux de paiement
router.get('/analyse-paiements', async (req, res) => {
    try {
        const sql = `
            SELECT 
                mode_paiement,
                COUNT(*) as nombre_transactions,
                SUM(prix_total) as montant_total,
                AVG(prix_total) as montant_moyen,
                MIN(date_debut) as premiere_utilisation,
                MAX(date_debut) as derniere_utilisation,
                COUNT(DISTINCT email) as clients_uniques,
                ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as pourcentage_utilisation
            FROM creneaux_clients
            WHERE mode_paiement IS NOT NULL AND mode_paiement != ''
            GROUP BY mode_paiement
            ORDER BY montant_total DESC
        `;

        const result = await db.query(sql);
        
        const analyse = {
            canaux_paiement: result.rows,
            statistiques: {
                canal_plus_populaire: result.rows[0] || null,
                canal_plus_rentable: result.rows.reduce((max, r) => 
                    parseFloat(r.montant_moyen) > parseFloat(max.montant_moyen) ? r : max
                , result.rows[0]),
                diversite_canaux: result.rows.length,
                taux_utilisation_mobile: result.rows.filter(r => 
                    r.mode_paiement.toLowerCase().includes('mobile')
                ).reduce((sum, r) => sum + parseFloat(r.pourcentage_utilisation), 0)
            },
            recommendations: result.rows.map(r => ({
                canal: r.mode_paiement,
                action: r.pourcentage_utilisation < 10 ? 'Promouvoir' : 'Maintenir',
                raison: `Utilisé par ${r.pourcentage_utilisation}% des clients`
            }))
        };

        res.json({
            success: true,
            data: analyse
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// Export des données pour reporting
router.get('/export-analytics', async (req, res) => {
    try {
        const { format = 'json' } = req.query;
        
        // Récupérer toutes les données d'analyse
        const [
            sante,
            revenus,
            comportement,
            risques,
            fidelite
        ] = await Promise.all([
            db.query('SELECT * FROM creneaux_clients'),
            db.query(`SELECT type_abonnement, SUM(prix_total) as revenu FROM creneaux_clients GROUP BY type_abonnement`),
            db.query(`SELECT EXTRACT(HOUR FROM heure_reservation) as heure, COUNT(*) as reservations FROM creneaux_clients GROUP BY EXTRACT(HOUR FROM heure_reservation)`),
            db.query(`SELECT statut, COUNT(*) as count FROM creneaux_clients GROUP BY statut`),
            db.query(`SELECT email, COUNT(*) as renouvellements FROM creneaux_clients GROUP BY email HAVING COUNT(*) > 1`)
        ]);

        const analyticsData = {
            metadata: {
                generate_le: new Date().toISOString(),
                periode_couverte: 'toutes_donnees',
                nombre_total_enregistrements: sante.rows.length
            },
            resume_executif: {
                total_abonnes: sante.rows.length,
                revenu_total: revenus.rows.reduce((sum, r) => sum + parseFloat(r.revenu), 0),
                heure_plus_frequente: comportement.rows.reduce((max, r) => 
                    parseInt(r.reservations) > parseInt(max.reservations) ? r : max
                , comportement.rows[0]),
                clients_fideles: fidelite.rows.length,
                risques_detectes: risques.rows.filter(r => r.statut === 'inactif').length
            },
            donnees_detaillees: {
                sante_abonnements: sante.rows,
                revenus_par_type: revenus.rows,
                comportement_reservations: comportement.rows,
                distribution_statuts: risques.rows,
                clientele_fidele: fidelite.rows
            }
        };

        if (format === 'csv') {
            // Convertir en CSV (simplifié)
            const csv = convertToCSV(analyticsData);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=analytics-abonnements.csv');
            return res.send(csv);
        }

        res.json({
            success: true,
            data: analyticsData
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// Fonction utilitaire pour conversion CSV
function convertToCSV(data) {
    const headers = ['Section', 'Metrique', 'Valeur'];
    const rows = [];
    
    // Ajouter les métriques principales
    Object.entries(data.resume_executif).forEach(([key, value]) => {
        rows.push(['Resume Executif', key, value]);
    });
    
    // Ajouter les données détaillées
    Object.entries(data.donnees_detaillees).forEach(([section, items]) => {
        if (Array.isArray(items) && items.length > 0) {
            items.forEach(item => {
                Object.entries(item).forEach(([key, value]) => {
                    rows.push([section, key, value]);
                });
            });
        }
    });
    
    return [headers, ...rows.map(row => row.join(','))].join('\n');
}

export default router;