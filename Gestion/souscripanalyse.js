import express from 'express';
const router = express.Router();
import db from '../db.js';

// ============================================
// ANALYSE COMPLÈTE DES SOUSCRIPTIONS
// ============================================

// 1. Dashboard principal - Vue d'ensemble complète
router.get('/dashboard', async (req, res) => {
    try {
        const [totalSubs, activeSubs, pendingSubs, cancelledSubs, expiredSubs] = await Promise.all([
            db.query('SELECT COUNT(*) as total FROM souscriptions'),
            db.query('SELECT COUNT(*) as total FROM souscriptions WHERE statut = $1', ['active']),
            db.query('SELECT COUNT(*) as total FROM souscriptions WHERE statut = $1', ['en_attente']),
            db.query('SELECT COUNT(*) as total FROM souscriptions WHERE statut = $1', ['annulee']),
            db.query('SELECT COUNT(*) as total FROM souscriptions WHERE statut = $1', ['expiree'])
        ]);

        // Revenus générés
        const revenues = await db.query(`
            SELECT 
                SUM(CASE WHEN statut = 'active' AND type_facturation = 'mensuel' THEN prix_paye ELSE 0 END) as revenus_mensuels_actifs,
                SUM(CASE WHEN statut = 'active' AND type_facturation = 'annuel' THEN prix_paye * 12 ELSE 0 END) as revenus_annuels_actifs,
                SUM(CASE WHEN statut = 'active' THEN 
                    CASE WHEN type_facturation = 'mensuel' THEN prix_paye ELSE prix_paye * 12 END 
                ELSE 0 END) as revenus_total_actifs,
                SUM(CASE WHEN statut IN ('active', 'en_attente') THEN 
                    CASE WHEN type_facturation = 'mensuel' THEN prix_paye ELSE prix_paye * 12 END 
                ELSE 0 END) as revenus_potentiels
            FROM souscriptions
        `);

        // Souscriptions par plan
        const byPlan = await db.query(`
            SELECT 
                plan,
                COUNT(*) as total,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as en_attente,
                SUM(CASE WHEN type_facturation = 'mensuel' THEN prix_paye ELSE 0 END) as revenus_mensuels,
                SUM(CASE WHEN type_facturation = 'annuel' THEN prix_paye * 12 ELSE 0 END) as revenus_annuels
            FROM souscriptions
            GROUP BY plan
        `);

        // Souscriptions par statut
        const byStatus = await db.query(`
            SELECT 
                statut,
                COUNT(*) as total,
                SUM(CASE WHEN type_facturation = 'mensuel' THEN prix_paye ELSE 0 END) as revenus_mensuels,
                SUM(CASE WHEN type_facturation = 'annuel' THEN prix_paye * 12 ELSE 0 END) as revenus_annuels
            FROM souscriptions
            GROUP BY statut
        `);

        // Souscriptions par mode de paiement
        const byPaymentMode = await db.query(`
            SELECT 
                mode_paiement,
                COUNT(*) as total,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives,
                SUM(prix_paye) as montant_total,
                AVG(prix_paye) as montant_moyen
            FROM souscriptions
            GROUP BY mode_paiement
        `);

        // Souscriptions par type de facturation (AJOUTÉ)
        const byBillingType = await db.query(`
            SELECT 
                type_facturation,
                COUNT(*) as total,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as en_attente,
                SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulees,
                SUM(CASE WHEN statut = 'expiree' THEN 1 ELSE 0 END) as expirees,
                SUM(prix_paye) as ca_mensuel,
                SUM(CASE WHEN statut = 'active' THEN 
                    CASE WHEN type_facturation = 'mensuel' THEN prix_paye ELSE prix_paye * 12 END 
                ELSE 0 END) as ca_annuel_projete,
                ROUND(AVG(prix_paye), 2) as prix_moyen
            FROM souscriptions
            GROUP BY type_facturation
        `);

        // Évolution mensuelle des souscriptions (6 derniers mois)
        const monthlyEvolution = await db.query(`
            SELECT 
                DATE_TRUNC('month', created_at) as mois,
                COUNT(*) as nouvelles_souscriptions,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives,
                SUM(prix_paye) as ca_generé
            FROM souscriptions
            WHERE created_at >= NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY mois DESC
        `);

        // Taux de conversion par plan
        const conversionRate = await db.query(`
            SELECT 
                plan,
                COUNT(*) as total,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as converties,
                ROUND(SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion
            FROM souscriptions
            GROUP BY plan
        `);

        // Statistiques par type de facturation (AJOUTÉ - synthèse)
        const billingTypeStats = await db.query(`
            SELECT 
                type_facturation,
                COUNT(*) as nombre_souscriptions,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives,
                ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM souscriptions) * 100, 2) as pourcentage
            FROM souscriptions
            GROUP BY type_facturation
        `);

        res.json({
            success: true,
            data: {
                synthese: {
                    total_souscriptions: parseInt(totalSubs.rows[0].total),
                    actives: parseInt(activeSubs.rows[0].total),
                    en_attente: parseInt(pendingSubs.rows[0].total),
                    annulees: parseInt(cancelledSubs.rows[0].total),
                    expirees: parseInt(expiredSubs.rows[0].total),
                    taux_activation: parseFloat((activeSubs.rows[0].total / totalSubs.rows[0].total * 100).toFixed(2))
                },
                revenus: {
                    mensuels_actifs: parseFloat(revenues.rows[0].revenus_mensuels_actifs) || 0,
                    annuels_actifs: parseFloat(revenues.rows[0].revenus_annuels_actifs) || 0,
                    total_actifs: parseFloat(revenues.rows[0].revenus_total_actifs) || 0,
                    potentiels: parseFloat(revenues.rows[0].revenus_potentiels) || 0
                },
                repartition: {
                    par_plan: byPlan.rows,
                    par_statut: byStatus.rows,
                    par_mode_paiement: byPaymentMode.rows,
                    par_type_facturation: byBillingType.rows
                },
                evolution: monthlyEvolution.rows,
                conversion: conversionRate.rows,
                // Nouvelle section pour les statistiques par type de facturation
                statistiques_facturation: {
                    par_type: billingTypeStats.rows,
                    total_mensuel: billingTypeStats.rows.find(r => r.type_facturation === 'mensuel')?.nombre_souscriptions || 0,
                    total_annuel: billingTypeStats.rows.find(r => r.type_facturation === 'annuel')?.nombre_souscriptions || 0,
                    pourcentage_mensuel: billingTypeStats.rows.find(r => r.type_facturation === 'mensuel')?.pourcentage || 0,
                    pourcentage_annuel: billingTypeStats.rows.find(r => r.type_facturation === 'annuel')?.pourcentage || 0
                }
            }
        });
    } catch (err) {
        console.error('Erreur dashboard:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
    }
});

// 2. Analyse des revenus détaillée
router.get('/revenue-analysis', async (req, res) => {
    try {
        // Revenus par mois sur l'année
        const monthlyRevenue = await db.query(`
            SELECT 
                EXTRACT(YEAR FROM date_debut) as annee,
                EXTRACT(MONTH FROM date_debut) as mois,
                COUNT(*) as nb_souscriptions,
                SUM(CASE WHEN type_facturation = 'mensuel' THEN prix_paye ELSE 0 END) as revenus_mensuels,
                SUM(CASE WHEN type_facturation = 'annuel' THEN prix_paye * 12 ELSE 0 END) as revenus_annuels,
                SUM(CASE 
                    WHEN type_facturation = 'mensuel' THEN prix_paye 
                    ELSE prix_paye * 12 
                END) as revenus_totaux
            FROM souscriptions
            WHERE statut = 'active'
            GROUP BY EXTRACT(YEAR FROM date_debut), EXTRACT(MONTH FROM date_debut)
            ORDER BY annee DESC, mois DESC
            LIMIT 12
        `);

        // Revenus par plan
        const revenueByPlan = await db.query(`
            SELECT 
                plan,
                COUNT(*) as nb_clients,
                AVG(prix_paye) as panier_moyen,
                SUM(CASE WHEN type_facturation = 'mensuel' THEN prix_paye ELSE prix_paye * 12 END) as ca_total,
                MIN(prix_paye) as prix_min,
                MAX(prix_paye) as prix_max
            FROM souscriptions
            WHERE statut = 'active'
            GROUP BY plan
        `);

        // Projection des revenus (12 mois)
        const revenueProjection = await db.query(`
            SELECT 
                plan,
                type_facturation,
                COUNT(*) as nb_actifs,
                SUM(CASE 
                    WHEN type_facturation = 'mensuel' THEN prix_paye * 12 
                    ELSE prix_paye * 12 
                END) as ca_annuel_projete
            FROM souscriptions
            WHERE statut = 'active'
            GROUP BY plan, type_facturation
        `);

        // Churn rate (taux de résiliation)
        const churnRate = await db.query(`
            WITH last_6_months AS (
                SELECT 
                    DATE_TRUNC('month', date_fin) as mois_fin,
                    COUNT(*) as annulations
                FROM souscriptions
                WHERE statut IN ('annulee', 'expiree')
                    AND date_fin >= NOW() - INTERVAL '6 months'
                GROUP BY DATE_TRUNC('month', date_fin)
            ),
            active_6_months AS (
                SELECT 
                    DATE_TRUNC('month', date_debut) as mois_debut,
                    COUNT(*) as nouvelles
                FROM souscriptions
                WHERE date_debut >= NOW() - INTERVAL '6 months'
                GROUP BY DATE_TRUNC('month', date_debut)
            )
            SELECT 
                COALESCE(annulations, 0) as annulations,
                COALESCE(nouvelles, 0) as nouvelles_actives,
                ROUND(COALESCE(annulations, 0)::numeric / NULLIF(COALESCE(nouvelles, 0), 0) * 100, 2) as taux_churn
            FROM last_6_months l
            FULL OUTER JOIN active_6_months a ON l.mois_fin = a.mois_debut
            ORDER BY COALESCE(l.mois_fin, a.mois_debut) DESC
            LIMIT 6
        `);

        res.json({
            success: true,
            data: {
                revenus_mensuels: monthlyRevenue.rows,
                analyse_par_plan: revenueByPlan.rows,
                projection_annuelle: revenueProjection.rows,
                churn_rate: churnRate.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse revenus:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// 3. Analyse comportementale des clients
router.get('/customer-behavior', async (req, res) => {
    try {
        // Durée moyenne d'abonnement
        const avgDuration = await db.query(`
            SELECT 
                plan,
                AVG(date_fin - date_debut) as duree_moyenne_jours,
                AVG(prix_paye) as prix_moyen,
                COUNT(*) as nb_clients
            FROM souscriptions
            WHERE statut = 'active' OR statut = 'expiree'
            GROUP BY plan
        `);

        // Top clients par dépense
        const topClients = await db.query(`
            SELECT 
                nom,
                prenom,
                email,
                plan,
                type_facturation,
                prix_paye,
                date_debut,
                CASE 
                    WHEN type_facturation = 'mensuel' THEN prix_paye * 12
                    ELSE prix_paye * 12
                END as valeur_annuelle
            FROM souscriptions
            WHERE statut = 'active'
            ORDER BY prix_paye DESC
            LIMIT 10
        `);

        // Distribution des plans
        const planDistribution = await db.query(`
            SELECT 
                plan,
                COUNT(*) as total,
                ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM souscriptions) * 100, 2) as pourcentage
            FROM souscriptions
            GROUP BY plan
            ORDER BY total DESC
        `);

        // Rétention clients (mois par mois)
        const retention = await db.query(`
            WITH months AS (
                SELECT generate_series(1, 12) as mois
            )
            SELECT 
                m.mois,
                COUNT(DISTINCT s.id) as clients_actifs,
                ROUND(COUNT(DISTINCT s.id)::numeric / NULLIF((SELECT COUNT(*) FROM souscriptions WHERE date_debut >= NOW() - INTERVAL '12 months'), 0) * 100, 2) as taux_retention
            FROM months m
            LEFT JOIN souscriptions s ON 
                s.statut = 'active' 
                AND s.date_debut + (m.mois || ' months')::interval <= CURRENT_DATE
            GROUP BY m.mois
            ORDER BY m.mois
        `);

        res.json({
            success: true,
            data: {
                duree_moyenne: avgDuration.rows,
                top_clients: topClients.rows,
                distribution_plans: planDistribution.rows,
                retention_clients: retention.rows
            }
        });
    } catch (err) {
        console.error('Erreur analyse comportement:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// 4. Analyse des performances par plan
router.get('/plan-performance', async (req, res) => {
    try {
        const performance = await db.query(`
            SELECT 
                plan,
                COUNT(*) as total_ventes,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as ventes_actives,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as ventes_attente,
                SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as ventes_annulees,
                AVG(prix_paye) as panier_moyen,
                MIN(prix_paye) as prix_min,
                MAX(prix_paye) as prix_max,
                SUM(CASE 
                    WHEN statut = 'active' AND type_facturation = 'mensuel' THEN prix_paye * 12
                    WHEN statut = 'active' AND type_facturation = 'annuel' THEN prix_paye * 12
                    ELSE 0
                END) as ca_potentiel_annuel,
                MODE() WITHIN GROUP (ORDER BY mode_paiement) as mode_paiement_prefere
            FROM souscriptions
            GROUP BY plan
            ORDER BY total_ventes DESC
        `);

        // Cross-sell / Up-sell potentiel
        const upgradePotential = await db.query(`
            SELECT 
                COUNT(*) as clients_potentiels,
                'Starter vers Pro' as upgrade_path
            FROM souscriptions
            WHERE plan = 'starter' AND statut = 'active'
            UNION ALL
            SELECT 
                COUNT(*) as clients_potentiels,
                'Pro vers Enterprise' as upgrade_path
            FROM souscriptions
            WHERE plan = 'pro' AND statut = 'active'
        `);

        res.json({
            success: true,
            data: {
                performance_plans: performance.rows,
                potentiel_upgrade: upgradePotential.rows
            }
        });
    } catch (err) {
        console.error('Erreur performance plans:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// 5. Analyse géographique (si vous avez la colonne ville/pays)
router.get('/geographic-analysis', async (req, res) => {
    try {
        // Si vous n'avez pas de colonne ville, cette requête peut être adaptée
        const byRegion = await db.query(`
            SELECT 
                'Non renseigné' as region,
                COUNT(*) as total,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives
            FROM souscriptions
            GROUP BY region
        `);

        res.json({
            success: true,
            data: {
                repartition_geographique: byRegion.rows,
                message: "Ajoutez une colonne 'ville' ou 'region' pour des analyses géographiques détaillées"
            }
        });
    } catch (err) {
        res.json({
            success: true,
            data: {
                message: "Pour l'analyse géographique, ajoutez les champs 'ville', 'code_postal', 'pays' à votre table"
            }
        });
    }
});

// 6. Alertes et recommandations
router.get('/alerts-recommendations', async (req, res) => {
    try {
        // Souscriptions sur le point d'expirer (30 jours)
        const expiringSoon = await db.query(`
            SELECT 
                id,
                nom,
                prenom,
                email,
                plan,
                date_fin,
                (date_fin - CURRENT_DATE) as jours_restants
            FROM souscriptions
            WHERE statut = 'active' 
                AND date_fin BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            ORDER BY jours_restants ASC
        `);

        // Taux de conversion faible
        const lowConversion = await db.query(`
            SELECT 
                plan,
                COUNT(*) as total,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives,
                ROUND(SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion
            FROM souscriptions
            GROUP BY plan
            HAVING ROUND(SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) * 100, 2) < 50
        `);

        // Recommandations commerciales
        const recommendations = [];
        
        if (expiringSoon.rows.length > 0) {
            recommendations.push({
                type: "warning",
                title: "Souscriptions expirant bientôt",
                message: `${expiringSoon.rows.length} clients vont expirer dans les 30 jours`,
                action: "Lancer une campagne de relance",
                clients: expiringSoon.rows
            });
        }

        if (lowConversion.rows.length > 0) {
            recommendations.push({
                type: "alert",
                title: "Taux de conversion faible",
                message: "Certains plans ont un taux de conversion inférieur à 50%",
                action: "Revoir l'offre ou le processus de souscription",
                plans: lowConversion.rows
            });
        }

        res.json({
            success: true,
            data: {
                alertes: {
                    expirations_proches: expiringSoon.rows,
                    taux_conversion_faible: lowConversion.rows
                },
                recommandations: recommendations
            }
        });
    } catch (err) {
        console.error('Erreur alertes:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// 7. Export CSV des données d'analyse
router.get('/export/csv', async (req, res) => {
    try {
        const data = await db.query(`
            SELECT 
                id,
                nom,
                prenom,
                email,
                telephone,
                plan,
                type_facturation,
                prix_paye,
                mode_paiement,
                date_debut,
                date_fin,
                statut,
                created_at
            FROM souscriptions
            ORDER BY created_at DESC
        `);

        const csvRows = [];
        const headers = ['ID', 'Nom', 'Prénom', 'Email', 'Téléphone', 'Plan', 'Facturation', 'Prix', 'Paiement', 'Date Début', 'Date Fin', 'Statut', 'Date Création'];
        csvRows.push(headers.join(','));

        for (const row of data.rows) {
            const values = [
                row.id,
                `"${row.nom}"`,
                `"${row.prenom}"`,
                `"${row.email}"`,
                `"${row.telephone}"`,
                row.plan,
                row.type_facturation,
                row.prix_paye,
                row.mode_paiement,
                row.date_debut,
                row.date_fin,
                row.statut,
                row.created_at
            ];
            csvRows.push(values.join(','));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=souscriptions_export.csv');
        res.send(csvRows.join('\n'));
    } catch (err) {
        console.error('Erreur export CSV:', err);
        res.status(500).json({ success: false, message: 'Erreur export' });
    }
});

// 8. KPI Cards (Indicateurs clés)
router.get('/kpi-cards', async (req, res) => {
    try {
        const kpis = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as clients_actifs,
                ROUND(AVG(CASE WHEN statut = 'active' THEN prix_paye ELSE NULL END), 2) as panier_moyen_actif,
                SUM(CASE 
                    WHEN statut = 'active' AND type_facturation = 'mensuel' THEN prix_paye
                    WHEN statut = 'active' AND type_facturation = 'annuel' THEN prix_paye * 12
                    ELSE 0
                END) as ca_mensuel_recurrent,
                SUM(CASE 
                    WHEN statut = 'active' AND type_facturation = 'mensuel' THEN prix_paye * 12
                    WHEN statut = 'active' AND type_facturation = 'annuel' THEN prix_paye * 12
                    ELSE 0
                END) as ca_annual_recurrent,
                ROUND(SUM(CASE WHEN statut = 'active' AND type_facturation = 'mensuel' THEN prix_paye ELSE 0 END)::numeric / 
                    NULLIF(SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END), 0), 2) as revenu_moyen_par_client
            FROM souscriptions
        `);

        // Taux de croissance
        const growth = await db.query(`
            WITH monthly_new AS (
                SELECT 
                    DATE_TRUNC('month', created_at) as mois,
                    COUNT(*) as nouvelles
                FROM souscriptions
                WHERE created_at >= NOW() - INTERVAL '3 months'
                GROUP BY DATE_TRUNC('month', created_at)
                ORDER BY mois DESC
                LIMIT 2
            )
            SELECT 
                MAX(CASE WHEN row_number = 1 THEN nouvelles ELSE 0 END) as mois_courant,
                MAX(CASE WHEN row_number = 2 THEN nouvelles ELSE 0 END) as mois_precedent,
                ROUND(((MAX(CASE WHEN row_number = 1 THEN nouvelles ELSE 0 END) - 
                    MAX(CASE WHEN row_number = 2 THEN nouvelles ELSE 0 END))::numeric / 
                    NULLIF(MAX(CASE WHEN row_number = 2 THEN nouvelles ELSE 0 END), 0) * 100), 2) as taux_croissance
            FROM (
                SELECT 
                    nouvelles,
                    ROW_NUMBER() OVER (ORDER BY mois DESC) as row_number
                FROM monthly_new
            ) as ranked
        `);

        res.json({
            success: true,
            data: {
                kpis: kpis.rows[0],
                croissance: growth.rows[0]
            }
        });
    } catch (err) {
        console.error('Erreur KPI:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// 9. ROUTE SPÉCIFIQUE: Nombre de souscriptions par type de facturation
router.get('/billing-type-stats', async (req, res) => {
    try {
        const stats = await db.query(`
            SELECT 
                type_facturation,
                COUNT(*) as nombre_souscriptions,
                SUM(CASE WHEN statut = 'active' THEN 1 ELSE 0 END) as actives,
                SUM(CASE WHEN statut = 'en_attente' THEN 1 ELSE 0 END) as en_attente,
                SUM(CASE WHEN statut = 'annulee' THEN 1 ELSE 0 END) as annulees,
                SUM(CASE WHEN statut = 'expiree' THEN 1 ELSE 0 END) as expirees,
                ROUND(COUNT(*)::numeric / (SELECT COUNT(*) FROM souscriptions) * 100, 2) as pourcentage,
                ROUND(AVG(prix_paye), 2) as prix_moyen,
                SUM(prix_paye) as revenu_total
            FROM souscriptions
            GROUP BY type_facturation
            ORDER BY type_facturation
        `);

        const total = await db.query('SELECT COUNT(*) as total FROM souscriptions');
        
        res.json({
            success: true,
            data: {
                mensuel: stats.rows.find(r => r.type_facturation === 'mensuel') || {
                    type_facturation: 'mensuel',
                    nombre_souscriptions: 0,
                    actives: 0,
                    en_attente: 0,
                    annulees: 0,
                    expirees: 0,
                    pourcentage: 0,
                    prix_moyen: 0,
                    revenu_total: 0
                },
                annuel: stats.rows.find(r => r.type_facturation === 'annuel') || {
                    type_facturation: 'annuel',
                    nombre_souscriptions: 0,
                    actives: 0,
                    en_attente: 0,
                    annulees: 0,
                    expirees: 0,
                    pourcentage: 0,
                    prix_moyen: 0,
                    revenu_total: 0
                },
                total_souscriptions: parseInt(total.rows[0].total)
            }
        });
    } catch (err) {
        console.error('Erreur billing type stats:', err);
        res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
    }
});

export default router;