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
            WHERE entreprise IS NOT NULL AND entreprise != ''
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
                nombreterrains::integer as nombreterrains,
                COUNT(*) as nb_demandes,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as nb_conversions,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion
            FROM demonstration
            WHERE nombreterrains IS NOT NULL
            GROUP BY nombreterrains::integer
            ORDER BY nombreterrains::integer ASC
        `);
        
        // Ajout d'une segmentation par catégorie
        const categories = {
            'Petit projet (1-2 terrains)': { min: 1, max: 2, total: 0, conversions: 0 },
            'Projet moyen (3-5 terrains)': { min: 3, max: 5, total: 0, conversions: 0 },
            'Grand projet (6-10 terrains)': { min: 6, max: 10, total: 0, conversions: 0 },
            'Très grand projet (10+ terrains)': { min: 11, max: 999999, total: 0, conversions: 0 }
        };
        
        result.rows.forEach(row => {
            const terrains = parseInt(row.nombreterrains);
            if (terrains <= 2) {
                categories['Petit projet (1-2 terrains)'].total += parseInt(row.nb_demandes);
                categories['Petit projet (1-2 terrains)'].conversions += parseInt(row.nb_conversions);
            } else if (terrains <= 5) {
                categories['Projet moyen (3-5 terrains)'].total += parseInt(row.nb_demandes);
                categories['Projet moyen (3-5 terrains)'].conversions += parseInt(row.nb_conversions);
            } else if (terrains <= 10) {
                categories['Grand projet (6-10 terrains)'].total += parseInt(row.nb_demandes);
                categories['Grand projet (6-10 terrains)'].conversions += parseInt(row.nb_conversions);
            } else {
                categories['Très grand projet (10+ terrains)'].total += parseInt(row.nb_demandes);
                categories['Très grand projet (10+ terrains)'].conversions += parseInt(row.nb_conversions);
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
            SELECT 
                COUNT(*) as total_demandes,
                SUM(CASE WHEN statut = 'En attente' THEN 1 ELSE 0 END) as en_attente,
                SUM(CASE WHEN statut = 'Confirmé' THEN 1 ELSE 0 END) as confirme,
                SUM(CASE WHEN statut = 'Réalisé' THEN 1 ELSE 0 END) as realise,
                SUM(CASE WHEN statut = 'Annulé' THEN 1 ELSE 0 END) as annule,
                ROUND(CAST(SUM(CASE WHEN statut = 'Confirmé' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_attente_to_confirme,
                ROUND(CAST(SUM(CASE WHEN statut = 'Réalisé' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(SUM(CASE WHEN statut = 'Confirmé' THEN 1 ELSE 0 END), 0) * 100, 2) as tx_confirme_to_realise,
                ROUND(CAST(SUM(CASE WHEN statut = 'Réalisé' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_global_realise
            FROM demonstration
        `);
        
        const total = parseInt(result.rows[0].total_demandes) || 0;
        const confirme = parseInt(result.rows[0].confirme) || 0;
        const realise = parseInt(result.rows[0].realise) || 0;
        
        const funnel = [
            { etape: "Demandes reçues", valeur: total, pourcentage: 100 },
            { etape: "Confirmées", valeur: confirme, pourcentage: parseFloat(result.rows[0].tx_attente_to_confirme) || 0 },
            { etape: "Réalisées", valeur: realise, pourcentage: parseFloat(result.rows[0].tx_global_realise) || 0 }
        ];
        
        res.json({
            success: true,
            data: {
                synthese: {
                    total_demandes: total,
                    en_attente: parseInt(result.rows[0].en_attente) || 0,
                    confirme: confirme,
                    realise: realise,
                    annule: parseInt(result.rows[0].annule) || 0,
                    tx_attente_to_confirme: parseFloat(result.rows[0].tx_attente_to_confirme) || 0,
                    tx_confirme_to_realise: parseFloat(result.rows[0].tx_confirme_to_realise) || 0,
                    tx_global_realise: parseFloat(result.rows[0].tx_global_realise) || 0,
                    tx_abandon: 100 - (parseFloat(result.rows[0].tx_global_realise) || 0)
                },
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
// 5. ÉVOLUTION TEMPORELLE
// ============================================

router.get('/analytics/evolution', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                COUNT(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', CURRENT_DATE) THEN 1 END) as demandes_mois_cours,
                COUNT(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') THEN 1 END) as demandes_mois_prec,
                COUNT(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', CURRENT_DATE) AND statut IN ('Confirmé', 'Réalisé') THEN 1 END) as conversions_mois_cours,
                COUNT(CASE WHEN DATE_TRUNC('month', date_demande) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND statut IN ('Confirmé', 'Réalisé') THEN 1 END) as conversions_mois_prec
            FROM demonstration
            WHERE date_demande >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        `);
        
        const demandesMoisCours = parseInt(result.rows[0].demandes_mois_cours) || 0;
        const demandesMoisPrec = parseInt(result.rows[0].demandes_mois_prec) || 0;
        const conversionsMoisCours = parseInt(result.rows[0].conversions_mois_cours) || 0;
        const conversionsMoisPrec = parseInt(result.rows[0].conversions_mois_prec) || 0;
        
        const evolution = {
            demandes: {
                valeur: demandesMoisCours,
                evolution: demandesMoisCours - demandesMoisPrec,
                pourcentage: demandesMoisPrec > 0 
                    ? ((demandesMoisCours - demandesMoisPrec) / demandesMoisPrec * 100).toFixed(1)
                    : demandesMoisCours > 0 ? 100 : 0
            },
            conversions: {
                valeur: conversionsMoisCours,
                evolution: conversionsMoisCours - conversionsMoisPrec,
                pourcentage: conversionsMoisPrec > 0
                    ? ((conversionsMoisCours - conversionsMoisPrec) / conversionsMoisPrec * 100).toFixed(1)
                    : conversionsMoisCours > 0 ? 100 : 0
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
// 6. SCORING DES LEADS
// ============================================

router.get('/analytics/lead-scoring', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                id_demonstration,
                nom,
                email,
                entreprise,
                nombreterrains::integer as nombreterrains,
                message,
                statut,
                date_demande,
                (COALESCE(nombreterrains::integer, 0) * 5 + LENGTH(COALESCE(message, '')) / 20) as score_potentiel,
                CASE 
                    WHEN COALESCE(nombreterrains::integer, 0) >= 6 THEN 'HIGH'
                    WHEN COALESCE(nombreterrains::integer, 0) >= 3 THEN 'MEDIUM'
                    ELSE 'LOW'
                END as priorite
            FROM demonstration
            WHERE statut = 'En attente'
            ORDER BY score_potentiel DESC
        `);
        
        const leads = result.rows.map(row => ({
            ...row,
            score_potentiel: Math.min(Math.round(row.score_potentiel), 100),
            nombreterrains: parseInt(row.nombreterrains) || 0
        }));
        
        const resume = {
            total: leads.length,
            high: leads.filter(r => r.priorite === 'HIGH').length,
            medium: leads.filter(r => r.priorite === 'MEDIUM').length,
            low: leads.filter(r => r.priorite === 'LOW').length
        };
        
        const recommandations = {
            HIGH: "🔴 PRIORITÉ HAUTE - Contacter sous 24h",
            MEDIUM: "🟡 PRIORITÉ MOYENNE - Contacter sous 72h",
            LOW: "🟢 PRIORITÉ BASSE - Relance dans 15 jours"
        };
        
        res.json({
            success: true,
            data: {
                leads: leads,
                resume: resume,
                recommandations: recommandations
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors du scoring des leads',
            error: err.message 
        });
    }
});

// ============================================
// 7. DÉLAI DE TRAITEMENT
// ============================================

router.get('/analytics/delais-traitement', async (req, res) => {
    try {
        const result = await db.query(`
            WITH traites AS (
                SELECT 
                    EXTRACT(EPOCH FROM (COALESCE(date_traitement, NOW()) - date_demande)) / 86400 as delai
                FROM demonstration
                WHERE statut IN ('Confirmé', 'Réalisé', 'Annulé')
            )
            SELECT 
                ROUND(COALESCE(AVG(delai), 0), 1) as delai_moyen_jours,
                COUNT(CASE WHEN statut = 'En attente' AND date_demande < NOW() - INTERVAL '3 days' THEN 1 END) as demandes_en_retard,
                COUNT(CASE WHEN statut IN ('Confirmé', 'Réalisé') AND EXTRACT(EPOCH FROM (COALESCE(date_traitement, NOW()) - date_demande)) / 86400 <= 2 THEN 1 END) as traitees_rapidement
            FROM demonstration
            LEFT JOIN traites ON true
            GROUP BY 1,2
        `);
        
        res.json({
            success: true,
            data: {
                delai_moyen_jours: parseFloat(result.rows[0]?.delai_moyen_jours) || 0,
                demandes_en_retard: parseInt(result.rows[0]?.demandes_en_retard) || 0,
                traitees_rapidement: parseInt(result.rows[0]?.traitees_rapidement) || 0
            }
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
// 8. TABLEAU DE BORD RAPIDE (CORRIGÉ)
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
        
        // Demandes en attente critiques (corrigé)
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
            WHERE entreprise IS NOT NULL AND entreprise != ''
            GROUP BY entreprise
            ORDER BY nb_demandes DESC
            LIMIT 5
        `);
        
        // Répartition par taille de projet (corrigé - conversion explicite)
        const repartition = await db.query(`
            SELECT 
                CASE 
                    WHEN nombreterrains::integer <= 2 THEN 'Petit projet'
                    WHEN nombreterrains::integer <= 5 THEN 'Projet moyen'
                    WHEN nombreterrains::integer <= 10 THEN 'Grand projet'
                    ELSE 'Très grand projet'
                END as taille,
                COUNT(*) as nb_demandes,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_conversion
            FROM demonstration
            WHERE nombreterrains IS NOT NULL
            GROUP BY 
                CASE 
                    WHEN nombreterrains::integer <= 2 THEN 'Petit projet'
                    WHEN nombreterrains::integer <= 5 THEN 'Projet moyen'
                    WHEN nombreterrains::integer <= 10 THEN 'Grand projet'
                    ELSE 'Très grand projet'
                END
            ORDER BY MIN(nombreterrains::integer)
        `);
        
        res.json({
            success: true,
            data: {
                synthese: {
                    total_demandes: parseInt(stats.rows[0]?.total) || 0,
                    taux_conversion: parseFloat(stats.rows[0]?.tx_conversion) || 0,
                    demandes_urgentes: parseInt(urgent.rows[0]?.urgentes) || 0
                },
                top_entreprises: topEntreprises.rows || [],
                repartition_projets: repartition.rows || []
            }
        });
    } catch (err) {
        console.error('Erreur détaillée:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la génération du dashboard',
            error: err.message 
        });
    }
});

export default router;