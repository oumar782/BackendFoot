import express from 'express';
const router = express.Router();
import db from '../db.js';

// ============================================
// 1. STATISTIQUES GÉNÉRALES & CONVERSION
// ============================================

router.get('/analytics/stats', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                COUNT(*) as total_demandes,
                SUM(CASE WHEN statut = 'En attente' THEN 1 ELSE 0 END) as en_attente,
                SUM(CASE WHEN statut = 'Confirmé' THEN 1 ELSE 0 END) as confirmes,
                SUM(CASE WHEN statut = 'Réalisé' THEN 1 ELSE 0 END) as realises,
                SUM(CASE WHEN statut = 'Annulé' THEN 1 ELSE 0 END) as annules,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion
            FROM demonstration
        `);
        
        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors des statistiques',
            error: err.message 
        });
    }
});

// ============================================
// 2. NOMBRE DE DEMANDES PAR ENTREPRISE
// ============================================

router.get('/analytics/demandes-par-entreprise', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                entreprise,
                COUNT(*) as nb_demandes,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as nb_conversions,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion,
                STRING_AGG(DISTINCT statut, ', ') as statuts
            FROM demonstration
            GROUP BY entreprise
            ORDER BY nb_demandes DESC
            LIMIT 20
        `);
        
        res.json({
            success: true,
            data: result.rows,
            total_entreprises: result.rows.length
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la récupération des données par entreprise',
            error: err.message 
        });
    }
});

// ============================================
// 3. NOMBRE DE DEMANDES PAR NOMBRE DE TERRAINS
// ============================================

router.get('/analytics/demandes-par-terrains', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                nombreterrains,
                COUNT(*) as nb_demandes,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as nb_conversions,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion
            FROM demonstration
            GROUP BY nombreterrains
            ORDER BY nombreterrains ASC
        `);
        
        // Ajout d'une segmentation par catégorie
        const categories = {
            'Petit (1-2)': { min: 1, max: 2, total: 0, conversions: 0 },
            'Moyen (3-5)': { min: 3, max: 5, total: 0, conversions: 0 },
            'Grand (6-10)': { min: 6, max: 10, total: 0, conversions: 0 },
            'Très grand (10+)': { min: 11, max: 9999, total: 0, conversions: 0 }
        };
        
        result.rows.forEach(row => {
            const terrains = row.nombreterrains;
            if (terrains <= 2) {
                categories['Petit (1-2)'].total += parseInt(row.nb_demandes);
                categories['Petit (1-2)'].conversions += parseInt(row.nb_conversions);
            } else if (terrains <= 5) {
                categories['Moyen (3-5)'].total += parseInt(row.nb_demandes);
                categories['Moyen (3-5)'].conversions += parseInt(row.nb_conversions);
            } else if (terrains <= 10) {
                categories['Grand (6-10)'].total += parseInt(row.nb_demandes);
                categories['Grand (6-10)'].conversions += parseInt(row.nb_conversions);
            } else {
                categories['Très grand (10+)'].total += parseInt(row.nb_demandes);
                categories['Très grand (10+)'].conversions += parseInt(row.nb_conversions);
            }
        });
        
        const categoriesArray = Object.entries(categories).map(([nom, data]) => ({
            categorie: nom,
            nb_demandes: data.total,
            nb_conversions: data.conversions,
            taux_conversion: data.total > 0 ? (data.conversions / data.total * 100).toFixed(2) : 0
        }));
        
        res.json({
            success: true,
            data: {
                par_terrain: result.rows,
                par_categorie: categoriesArray
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse par terrains',
            error: err.message 
        });
    }
});

// ============================================
// 4. ENTONNOIR DE CONVERSION (FUNNEL)
// ============================================

router.get('/analytics/funnel', async (req, res) => {
    try {
        const result = await db.query(`
            WITH stats AS (
                SELECT 
                    COUNT(*) as total_demandes,
                    SUM(CASE WHEN statut = 'En attente' THEN 1 ELSE 0 END) as en_attente,
                    SUM(CASE WHEN statut = 'Confirmé' THEN 1 ELSE 0 END) as confirme,
                    SUM(CASE WHEN statut = 'Réalisé' THEN 1 ELSE 0 END) as realise,
                    SUM(CASE WHEN statut = 'Annulé' THEN 1 ELSE 0 END) as annule
                FROM demonstration
            )
            SELECT 
                total_demandes,
                en_attente,
                confirme,
                realise,
                annule,
                ROUND(CAST(confirme AS DECIMAL) / NULLIF(total_demandes, 0) * 100, 2) as tx_attente_to_confirme,
                ROUND(CAST(realise AS DECIMAL) / NULLIF(confirme, 0) * 100, 2) as tx_confirme_to_realise,
                ROUND(CAST(realise AS DECIMAL) / NULLIF(total_demandes, 0) * 100, 2) as tx_global_realise
            FROM stats
        `);
        
        const funnel = [
            { etape: "Demandes reçues", valeur: parseInt(result.rows[0].total_demandes), pourcentage: 100 },
            { etape: "Confirmées", valeur: parseInt(result.rows[0].confirme), pourcentage: parseFloat(result.rows[0].tx_attente_to_confirme) },
            { etape: "Réalisées", valeur: parseInt(result.rows[0].realise), pourcentage: parseFloat(result.rows[0].tx_confirme_to_realise) }
        ];
        
        res.json({
            success: true,
            data: {
                synthese: result.rows[0],
                funnel: funnel
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse du funnel',
            error: err.message 
        });
    }
});

// ============================================
// 5. ÉVOLUTION TEMPORELLE (Mois en cours vs précédent)
// ============================================

router.get('/analytics/evolution', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                SUM(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', NOW()) THEN 1 ELSE 0 END) as demandes_mois_cours,
                SUM(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', NOW() - INTERVAL '1 month') THEN 1 ELSE 0 END) as demandes_mois_prec,
                SUM(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', NOW()) AND statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as conversions_mois_cours,
                SUM(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', NOW() - INTERVAL '1 month') AND statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as conversions_mois_prec
            FROM demonstration
            WHERE date_demande >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        `);
        
        const evolution = {
            demandes: {
                valeur: result.rows[0].demandes_mois_cours,
                evolution: result.rows[0].demandes_mois_cours - result.rows[0].demandes_mois_prec,
                pourcentage: result.rows[0].demandes_mois_prec > 0 
                    ? ((result.rows[0].demandes_mois_cours - result.rows[0].demandes_mois_prec) / result.rows[0].demandes_mois_prec * 100).toFixed(1)
                    : 100
            },
            conversions: {
                valeur: result.rows[0].conversions_mois_cours,
                evolution: result.rows[0].conversions_mois_cours - result.rows[0].conversions_mois_prec,
                pourcentage: result.rows[0].conversions_mois_prec > 0
                    ? ((result.rows[0].conversions_mois_cours - result.rows[0].conversions_mois_prec) / result.rows[0].conversions_mois_prec * 100).toFixed(1)
                    : 100
            }
        };
        
        res.json({
            success: true,
            data: evolution
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de l\'évolution',
            error: err.message 
        });
    }
});

// ============================================
// 6. SCORING DES LEADS (PRIORITÉS)
// ============================================

router.get('/analytics/lead-scoring', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                id_demonstration,
                nom,
                email,
                entreprise,
                nombreterrains,
                message,
                statut,
                date_demande,
                (
                    CASE 
                        WHEN nombreterrains >= 10 THEN 40
                        WHEN nombreterrains >= 6 THEN 35
                        WHEN nombreterrains >= 3 THEN 25
                        WHEN nombreterrains >= 1 THEN 15
                        ELSE 0
                    END
                    +
                    CASE 
                        WHEN LENGTH(message) > 500 THEN 25
                        WHEN LENGTH(message) > 200 THEN 18
                        WHEN LENGTH(message) > 100 THEN 10
                        WHEN LENGTH(message) > 50 THEN 5
                        ELSE 0
                    END
                ) as score_potentiel,
                CASE 
                    WHEN (
                        CASE 
                            WHEN nombreterrains >= 10 THEN 40
                            WHEN nombreterrains >= 6 THEN 35
                            WHEN nombreterrains >= 3 THEN 25
                            WHEN nombreterrains >= 1 THEN 15
                            ELSE 0
                        END
                        +
                        CASE 
                            WHEN LENGTH(message) > 500 THEN 25
                            WHEN LENGTH(message) > 200 THEN 18
                            WHEN LENGTH(message) > 100 THEN 10
                            WHEN LENGTH(message) > 50 THEN 5
                            ELSE 0
                        END
                    ) >= 60 THEN 'HIGH'
                    WHEN (
                        CASE 
                            WHEN nombreterrains >= 10 THEN 40
                            WHEN nombreterrains >= 6 THEN 35
                            WHEN nombreterrains >= 3 THEN 25
                            WHEN nombreterrains >= 1 THEN 15
                            ELSE 0
                        END
                        +
                        CASE 
                            WHEN LENGTH(message) > 500 THEN 25
                            WHEN LENGTH(message) > 200 THEN 18
                            WHEN LENGTH(message) > 100 THEN 10
                            WHEN LENGTH(message) > 50 THEN 5
                            ELSE 0
                        END
                    ) >= 35 THEN 'MEDIUM'
                    ELSE 'LOW'
                END as priorite
            FROM demonstration
            WHERE statut = 'En attente'
            ORDER BY score_potentiel DESC
        `);
        
        const recommandations = {
            HIGH: "🔴 PRIORITÉ HAUTE - Contacter sous 24h",
            MEDIUM: "🟡 PRIORITÉ MOYENNE - Contacter sous 72h",
            LOW: "🟢 PRIORITÉ BASSE - Relance dans 15 jours"
        };
        
        res.json({
            success: true,
            data: {
                leads: result.rows,
                resume: {
                    total: result.rows.length,
                    high: result.rows.filter(r => r.priorite === 'HIGH').length,
                    medium: result.rows.filter(r => r.priorite === 'MEDIUM').length,
                    low: result.rows.filter(r => r.priorite === 'LOW').length
                },
                recommandations: recommandations
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du scoring',
            error: err.message 
        });
    }
});

// ============================================
// 7. DÉLAI DE TRAITEMENT MOYEN
// ============================================

router.get('/analytics/delais-traitement', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                ROUND(AVG(EXTRACT(EPOCH FROM (date_traitement - date_demande)) / 86400), 1) as delai_moyen_jours,
                COUNT(CASE WHEN date_traitement IS NULL AND statut = 'En attente' AND date_demande < NOW() - INTERVAL '3 days' THEN 1 END) as demandes_en_retard,
                COUNT(CASE WHEN date_traitement IS NOT NULL AND EXTRACT(EPOCH FROM (date_traitement - date_demande)) / 86400 <= 2 THEN 1 END) as traitees_rapidement
            FROM demonstration
            WHERE statut IN ('Confirmé', 'Réalisé', 'Annulé') OR (statut = 'En attente' AND date_demande < NOW() - INTERVAL '3 days')
        `);
        
        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse des délais',
            error: err.message 
        });
    }
});

// ============================================
// 8. TABLEAU DE BORD RAPIDE (ESSENTIEL)
// ============================================

router.get('/analytics/dashboard', async (req, res) => {
    try {
        // Statistiques générales
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as converties,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_conversion
            FROM demonstration
        `);
        
        // Demandes en attente critiques
        const urgent = await db.query(`
            SELECT COUNT(*) as urgentes
            FROM demonstration
            WHERE statut = 'En attente' 
            AND date_demande < NOW() - INTERVAL '3 days'
        `);
        
        // Top 5 entreprises
        const topEntreprises = await db.query(`
            SELECT entreprise, COUNT(*) as nb_demandes
            FROM demonstration
            GROUP BY entreprise
            ORDER BY nb_demandes DESC
            LIMIT 5
        `);
        
        // Répartition par taille de projet
        const repartition = await db.query(`
            SELECT 
                CASE 
                    WHEN nombreterrains <= 2 THEN 'Petit projet'
                    WHEN nombreterrains <= 5 THEN 'Projet moyen'
                    WHEN nombreterrains <= 10 THEN 'Grand projet'
                    ELSE 'Très grand projet'
                END as taille,
                COUNT(*) as nb_demandes,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_conversion
            FROM demonstration
            GROUP BY 
                CASE 
                    WHEN nombreterrains <= 2 THEN 'Petit projet'
                    WHEN nombreterrains <= 5 THEN 'Projet moyen'
                    WHEN nombreterrains <= 10 THEN 'Grand projet'
                    ELSE 'Très grand projet'
                END
            ORDER BY MIN(nombreterrains)
        `);
        
        res.json({
            success: true,
            data: {
                synthese: {
                    total_demandes: stats.rows[0].total,
                    taux_conversion: stats.rows[0].tx_conversion,
                    demandes_urgentes: urgent.rows[0].urgentes
                },
                top_entreprises: topEntreprises.rows,
                repartition_projets: repartition.rows
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la génération du dashboard',
            error: err.message 
        });
    }
});

export default router;