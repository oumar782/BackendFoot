import express from 'express';
const router = express.Router();
import db from '../db.js';

// ============================================
// 1. ANALYSE DE CONVERSION & PERFORMANCE COMMERCIALE
// ============================================

// Taux de conversion global et par statut
router.get('/analytics/conversion-rate', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                COUNT(*) as total_demandes,
                SUM(CASE WHEN statut = 'En attente' THEN 1 ELSE 0 END) as en_attente,
                SUM(CASE WHEN statut = 'Confirmé' THEN 1 ELSE 0 END) as confirmes,
                SUM(CASE WHEN statut = 'Réalisé' THEN 1 ELSE 0 END) as realises,
                SUM(CASE WHEN statut = 'Annulé' THEN 1 ELSE 0 END) as annules,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion_global,
                ROUND(CAST(SUM(CASE WHEN statut = 'Réalisé' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(SUM(CASE WHEN statut = 'Confirmé' THEN 1 ELSE 0 END), 0) * 100, 2) as taux_realisation_apres_confirmation
            FROM demonstration
        `);
        
        res.json({
            success: true,
            data: result.rows[0],
            message: "Analyse de conversion récupérée avec succès"
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de conversion',
            error: err.message 
        });
    }
});

// Taux de conversion par nombre de terrains (segmentation)
router.get('/analytics/conversion-by-terrains', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                CASE 
                    WHEN nombreterrains <= 2 THEN 'Petit (1-2 terrains)'
                    WHEN nombreterrains <= 5 THEN 'Moyen (3-5 terrains)'
                    WHEN nombreterrains <= 10 THEN 'Grand (6-10 terrains)'
                    ELSE 'Très grand (10+ terrains)'
                END as segment,
                COUNT(*) as total,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as convertis,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion,
                AVG(nombreterrains) as avg_terrains
            FROM demonstration
            GROUP BY 
                CASE 
                    WHEN nombreterrains <= 2 THEN 'Petit (1-2 terrains)'
                    WHEN nombreterrains <= 5 THEN 'Moyen (3-5 terrains)'
                    WHEN nombreterrains <= 10 THEN 'Grand (6-10 terrains)'
                    ELSE 'Très grand (10+ terrains)'
                END
            ORDER BY MIN(nombreterrains)
        `);
        
        res.json({
            success: true,
            data: result.rows,
            message: "Analyse par segment de terrains récupérée"
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
// 2. ANALYSE DE L'ENTONNOIR DE CONVERSION (FUNNEL)
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
                ROUND(CAST(realise AS DECIMAL) / NULLIF(total_demandes, 0) * 100, 2) as tx_global_realise,
                ROUND(CAST(annule AS DECIMAL) / NULLIF(total_demandes, 0) * 100, 2) as tx_abandon
            FROM stats
        `);
        
        // Ajout des données de funnel étape par étape
        const funnel = [
            { etape: "Demandes reçues", valeur: result.rows[0].total_demandes, pourcentage: 100 },
            { etape: "En attente", valeur: result.rows[0].en_attente, pourcentage: result.rows[0].tx_attente_to_confirme },
            { etape: "Confirmées", valeur: result.rows[0].confirme, pourcentage: result.rows[0].tx_attente_to_confirme },
            { etape: "Réalisées", valeur: result.rows[0].realise, pourcentage: result.rows[0].tx_confirme_to_realise }
        ];
        
        res.json({
            success: true,
            data: {
                synthese: result.rows[0],
                funnel: funnel,
                points_attention: {
                    point_fuite_principal: result.rows[0].tx_attente_to_confirme < 50 ? "Taux de confirmation bas" : "Taux de réalisation à améliorer",
                    taux_abandon_critique: result.rows[0].tx_abandon > 30
                }
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
// 3. ANALYSE TEMPORELLE (SÉRIES CHRONOLOGIQUES)
// ============================================

// Analyse par période (jour, semaine, mois)
router.get('/analytics/temporal/:period', async (req, res) => {
    const { period } = req.params; // day, week, month
    let dateFormat;
    
    switch(period) {
        case 'day':
            dateFormat = 'YYYY-MM-DD';
            break;
        case 'week':
            dateFormat = 'IYYY-IW'; // Année-semaine
            break;
        case 'month':
            dateFormat = 'YYYY-MM';
            break;
        default:
            return res.status(400).json({ success: false, message: 'Période invalide. Utilisez day, week ou month' });
    }
    
    try {
        const result = await db.query(`
            SELECT 
                TO_CHAR(date_demande, '${dateFormat}') as periode,
                COUNT(*) as total_demandes,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as converties,
                SUM(CASE WHEN statut = 'Annulé' THEN 1 ELSE 0 END) as annulees,
                ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - date_demande)) / 86400), 1) as avg_age_jours,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_conversion
            FROM demonstration
            WHERE date_demande >= NOW() - INTERVAL '3 months'
            GROUP BY TO_CHAR(date_demande, '${dateFormat}')
            ORDER BY MIN(date_demande) DESC
            LIMIT 12
        `);
        
        // Calcul de la tendance
        const valeurs = result.rows.map(r => parseFloat(r.taux_conversion));
        let tendance = "stable";
        if (valeurs.length >= 2) {
            const derniere = valeurs[0];
            const precedente = valeurs[1];
            if (derniere > precedente * 1.1) tendance = "hausse";
            else if (derniere < precedente * 0.9) tendance = "baisse";
        }
        
        res.json({
            success: true,
            data: {
                periodes: result.rows,
                tendance: tendance,
                moyenne_conversion: (valeurs.reduce((a,b) => a + b, 0) / valeurs.length).toFixed(2)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse temporelle',
            error: err.message 
        });
    }
});

// Délais de traitement
router.get('/analytics/treatment-delays', async (req, res) => {
    try {
        const result = await db.query(`
            WITH traitement_stats AS (
                SELECT 
                    EXTRACT(EPOCH FROM (date_traitement - date_demande)) / 86400 as delai_jours
                FROM demonstration
                WHERE statut IN ('Confirmé', 'Réalisé', 'Annulé')
                AND date_traitement IS NOT NULL
            )
            SELECT 
                ROUND(AVG(delai_jours), 1) as delai_moyen_jours,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delai_jours), 1) as delai_median_jours,
                ROUND(MIN(delai_jours), 1) as delai_min_jours,
                ROUND(MAX(delai_jours), 1) as delai_max_jours,
                ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY delai_jours), 1) as delai_percentile_90,
                COUNT(CASE WHEN delai_jours > 7 THEN 1 END) as nb_traitement_lent,
                COUNT(*) as total_traites
            FROM traitement_stats
        `);
        
        // Seuils d'alerte
        const alertes = [];
        if (result.rows[0].delai_moyen_jours > 5) alertes.push("Délai moyen trop élevé (>5 jours)");
        if (result.rows[0].delai_percentile_90 > 10) alertes.push("10% des traitements prennent plus de 10 jours");
        
        res.json({
            success: true,
            data: {
                ...result.rows[0],
                alertes: alertes,
                evaluation: result.rows[0].delai_moyen_jours <= 3 ? "Excellent" : result.rows[0].delai_moyen_jours <= 5 ? "Correct" : "À améliorer"
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
// 4. ANALYSE PRÉDICTIVE (SCORING DES LEADS)
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
                -- Calcul du score
                (
                    -- Score nombre de terrains (max 40 pts)
                    CASE 
                        WHEN nombreterrains >= 10 THEN 40
                        WHEN nombreterrains >= 6 THEN 35
                        WHEN nombreterrains >= 3 THEN 25
                        WHEN nombreterrains >= 1 THEN 15
                        ELSE 0
                    END
                    +
                    -- Score longueur du message (max 25 pts)
                    CASE 
                        WHEN LENGTH(message) > 500 THEN 25
                        WHEN LENGTH(message) > 200 THEN 18
                        WHEN LENGTH(message) > 100 THEN 10
                        WHEN LENGTH(message) > 50 THEN 5
                        ELSE 0
                    END
                    +
                    -- Score domaine email (max 20 pts)
                    CASE 
                        WHEN email LIKE '%.com' THEN 20
                        WHEN email LIKE '%.fr' THEN 15
                        WHEN email LIKE '%.org' THEN 10
                        ELSE 5
                    END
                    +
                    -- Score ancienneté (moins une demande est vieille, plus on perd des points) (max 15 pts)
                    GREATEST(0, 15 - EXTRACT(EPOCH FROM (NOW() - date_demande)) / 86400)
                ) as score_potentiel,
                
                -- Niveau de priorité
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
                        +
                        CASE 
                            WHEN email LIKE '%.com' THEN 20
                            WHEN email LIKE '%.fr' THEN 15
                            WHEN email LIKE '%.org' THEN 10
                            ELSE 5
                        END
                    ) >= 70 THEN 'CRITICAL'
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
                        +
                        CASE 
                            WHEN email LIKE '%.com' THEN 20
                            WHEN email LIKE '%.fr' THEN 15
                            WHEN email LIKE '%.org' THEN 10
                            ELSE 5
                        END
                    ) >= 50 THEN 'HIGH'
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
                        +
                        CASE 
                            WHEN email LIKE '%.com' THEN 20
                            WHEN email LIKE '%.fr' THEN 15
                            WHEN email LIKE '%.org' THEN 10
                            ELSE 5
                        END
                    ) >= 30 THEN 'MEDIUM'
                    ELSE 'LOW'
                END as priorite
            FROM demonstration
            WHERE statut = 'En attente'
            ORDER BY score_potentiel DESC
        `);
        
        // Recommandations basées sur les scores
        const recommandations = {
            CRITICAL: "🔴 PRIORITÉ ABSOLUE - Contacter sous 24h, proposition commerciale prioritaire",
            HIGH: "🟠 PRIORITÉ HAUTE - Contacter sous 48h, démonstration rapide",
            MEDIUM: "🟡 PRIORITÉ MOYENNE - Contacter sous 72h, suivi automatisé",
            LOW: "🟢 PRIORITÉ BASSE - Newsletter + relance dans 15 jours"
        };
        
        res.json({
            success: true,
            data: {
                leads_a_traiter: result.rows,
                resume: {
                    total: result.rows.length,
                    critical: result.rows.filter(r => r.priorite === 'CRITICAL').length,
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
            message: 'Erreur lors du scoring des leads',
            error: err.message 
        });
    }
});

// ============================================
// 5. ANALYSE DE SATISFACTION & QUALITÉ
// ============================================

router.get('/analytics/quality-metrics', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                -- Taux d'abandon
                ROUND(CAST(SUM(CASE WHEN statut = 'Annulé' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_abandon,
                ROUND(CAST(SUM(CASE WHEN statut = 'En attente' AND date_demande < NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_stagnation_7j,
                
                -- Qualité des demandes
                ROUND(AVG(LENGTH(message)), 0) as longueur_moyenne_message,
                COUNT(CASE WHEN LENGTH(message) < 50 THEN 1 END) as demandes_pauvres,
                COUNT(CASE WHEN LENGTH(message) > 300 THEN 1 END) as demandes_riches,
                
                -- Segmentation des annulations
                SUM(CASE WHEN statut = 'Annulé' AND EXTRACT(EPOCH FROM (NOW() - date_demande)) / 86400 <= 3 THEN 1 ELSE 0 END) as annulations_precoces,
                SUM(CASE WHEN statut = 'Annulé' AND EXTRACT(EPOCH FROM (NOW() - date_demande)) / 86400 > 7 THEN 1 ELSE 0 END) as annulations_tardives
            FROM demonstration
        `);
        
        // Diagnostics
        const diagnostics = [];
        if (result.rows[0].taux_abandon > 30) diagnostics.push("⚠️ Taux d'abandon élevé (>30%) - Revoir le processus de confirmation");
        if (result.rows[0].taux_stagnation_7j > 20) diagnostics.push("⚠️ Trop de demandes stagnent depuis plus de 7 jours");
        if (result.rows[0].demandes_pauvres > result.rows[0].demandes_riches) diagnostics.push("📝 Majorité de messages courts - Peut indiquer des leads peu qualifiés");
        
        res.json({
            success: true,
            data: {
                ...result.rows[0],
                qualite_demandes: {
                    note: result.rows[0].longueur_moyenne_message > 150 ? "Bonne" : result.rows[0].longueur_moyenne_message > 80 ? "Moyenne" : "Faible",
                    recommandation: result.rows[0].longueur_moyenne_message < 100 ? "Encourager les prospects à détailler leur besoin" : null
                },
                diagnostics: diagnostics
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse qualité',
            error: err.message 
        });
    }
});

// ============================================
// 6. TABLEAU DE BORD DÉCISIONNEL (QUOTIDIEN)
// ============================================

router.get('/analytics/daily-decision-board', async (req, res) => {
    try {
        // Demandes en retard
        const demandesRetard = await db.query(`
            SELECT COUNT(*) as nb_demandes_en_retard
            FROM demonstration
            WHERE statut = 'En attente' 
            AND date_demande < NOW() - INTERVAL '3 days'
        `);
        
        // Conversion semaine en cours
        const conversionSemaine = await db.query(`
            SELECT 
                COUNT(*) as total_semaine,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as convertis_semaine,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_conversion_semaine
            FROM demonstration
            WHERE date_demande >= DATE_TRUNC('week', NOW())
        `);
        
        // Conversion mois précédent pour comparaison
        const conversionMoisPrec = await db.query(`
            SELECT 
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_conversion_mois_prec
            FROM demonstration
            WHERE date_demande >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
            AND date_demande < DATE_TRUNC('month', NOW())
        `);
        
        // Démonstrations prévues aujourd'hui
        const demosAujourdhui = await db.query(`
            SELECT COUNT(*) as nb_demos_aujourdhui
            FROM demonstration
            WHERE statut = 'Confirmé'
            AND DATE(date_demande) = CURRENT_DATE
        `);
        
        // Top entreprises à fort potentiel
        const topEntreprises = await db.query(`
            SELECT entreprise, COUNT(*) as nb_demandes, 
                   SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as nb_conversions
            FROM demonstration
            GROUP BY entreprise
            HAVING COUNT(*) >= 2
            ORDER BY nb_conversions DESC
            LIMIT 5
        `);
        
        // Évolution vs objectif
        const objectifMensuel = 50; // Objectif à configurer
        const progressionObjectif = await db.query(`
            SELECT COUNT(*) as realisations_mois
            FROM demonstration
            WHERE statut = 'Réalisé'
            AND date_demande >= DATE_TRUNC('month', NOW())
        `);
        
        const tauxProgression = (progressionObjectif.rows[0].realisations_mois / objectifMensuel * 100).toFixed(1);
        
        res.json({
            success: true,
            data: {
                alertes: {
                    demandes_en_retard: demandesRetard.rows[0].nb_demandes_en_retard,
                    seuil_critique: demandesRetard.rows[0].nb_demandes_en_retard > 5
                },
                performance: {
                    conversion_semaine: conversionSemaine.rows[0].tx_conversion_semaine,
                    evolution_vs_mois_prec: (conversionSemaine.rows[0].tx_conversion_semaine - (conversionMoisPrec.rows[0]?.tx_conversion_mois_prec || 0)).toFixed(1),
                    tendance: conversionSemaine.rows[0].tx_conversion_semaine > (conversionMoisPrec.rows[0]?.tx_conversion_mois_prec || 0) ? "positive" : "negative"
                },
                planning: {
                    demos_aujourdhui: demosAujourdhui.rows[0].nb_demos_aujourdhui,
                    recommandation: demosAujourdhui.rows[0].nb_demos_aujourdhui > 0 ? "Préparer les équipes pour les démos du jour" : "Journée calme - Profiter pour traiter les leads en attente"
                },
                objectifs: {
                    mensuel: objectifMensuel,
                    realisations: progressionObjectif.rows[0].realisations_mois,
                    progression: tauxProgression,
                    statut: tauxProgression >= 100 ? "Objectif atteint !" : tauxProgression >= 75 ? "Bonne progression" : tauxProgression >= 50 ? "Progression modérée" : "Retard significatif"
                },
                top_entreprises: topEntreprises.rows,
                actions_prioritaires: [
                    demandesRetard.rows[0].nb_demandes_en_retard > 0 ? `📞 Contacter ${demandesRetard.rows[0].nb_demandes_en_retard} demande(s) en attente depuis +72h` : null,
                    conversionSemaine.rows[0].tx_conversion_semaine < 30 ? "📈 Améliorer le taux de conversion de la semaine (<30%)" : null,
                    "🎯 Prioriser les leads CRITICAL du scoring"
                ].filter(a => a !== null)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la génération du tableau de bord',
            error: err.message 
        });
    }
});

// ============================================
// 7. TABLEAU DE BORD EXÉCUTIF (VISION STRATÉGIQUE)
// ============================================

router.get('/analytics/executive-dashboard', async (req, res) => {
    try {
        // Vue globale sur 12 mois
        const vueGlobale = await db.query(`
            SELECT 
                DATE_TRUNC('month', date_demande) as mois,
                COUNT(*) as demandes,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as conversions,
                ROUND(CAST(SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as tx_conversion
            FROM demonstration
            WHERE date_demande >= NOW() - INTERVAL '12 months'
            GROUP BY DATE_TRUNC('month', date_demande)
            ORDER BY mois DESC
        `);
        
        // Analyse comparative
        const comparatif = await db.query(`
            SELECT 
                SUM(CASE WHEN date_demande >= DATE_TRUNC('month', NOW()) THEN 1 ELSE 0 END) as demandes_mois_cours,
                SUM(CASE WHEN date_demande >= DATE_TRUNC('month', NOW() - INTERVAL '1 month') 
                         AND date_demande < DATE_TRUNC('month', NOW()) THEN 1 ELSE 0 END) as demandes_mois_prec,
                SUM(CASE WHEN date_demande >= DATE_TRUNC('month', NOW()) 
                         AND statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as conversions_mois_cours,
                SUM(CASE WHEN date_demande >= DATE_TRUNC('month', NOW() - INTERVAL '1 month') 
                         AND date_demande < DATE_TRUNC('month', NOW())
                         AND statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as conversions_mois_prec
            FROM demonstration
        `);
        
        const evolutionDemandes = comparatif.rows[0].demandes_mois_cours - comparatif.rows[0].demandes_mois_prec;
        const evolutionConversions = comparatif.rows[0].conversions_mois_cours - comparatif.rows[0].conversions_mois_prec;
        
        // KPIs stratégiques
        const kpis = await db.query(`
            SELECT 
                ROUND(AVG(EXTRACT(EPOCH FROM (date_traitement - date_demande)) / 86400), 1) as avg_time_to_convert,
                ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (date_traitement - date_demande)) / 86400), 1) as median_time_to_convert,
                COUNT(CASE WHEN statut = 'Réalisé' AND date_demande >= DATE_TRUNC('quarter', NOW()) THEN 1 END) as realisations_trimestre,
                COUNT(CASE WHEN statut = 'Réalisé' AND date_demande >= DATE_TRUNC('year', NOW()) THEN 1 END) as realisations_annee
            FROM demonstration
            WHERE statut IN ('Confirmé', 'Réalisé')
        `);
        
        res.json({
            success: true,
            data: {
                synthese_mensuelle: {
                    mois: new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' }),
                    demandes: comparatif.rows[0].demandes_mois_cours,
                    conversions: comparatif.rows[0].conversions_mois_cours,
                    evolution_demandes: evolutionDemandes,
                    evolution_conversions: evolutionConversions,
                    tendance_globale: evolutionDemandes > 0 && evolutionConversions > 0 ? "Croissance" : evolutionDemandes < 0 && evolutionConversions < 0 ? "Décroissance" : "Mixte"
                },
                historique_12_mois: vueGlobale.rows,
                kpis_strategiques: {
                    delai_moyen_conversion: `${kpis.rows[0].avg_time_to_convert} jours`,
                    delai_median_conversion: `${kpis.rows[0].median_time_to_convert} jours`,
                    realisations_trimestre: kpis.rows[0].realisations_trimestre,
                    realisations_annee: kpis.rows[0].realisations_annee,
                    projection_annuelle: Math.round(kpis.rows[0].realisations_trimestre * 4)
                },
                recommandations_strategiques: [
                    evolutionDemandes < 0 ? "📉 Baisse des demandes - Intensifier les actions marketing" : null,
                    evolutionConversions < 0 ? "⚠️ Baisse des conversions - Revoir le process commercial" : null,
                    kpis.rows[0].avg_time_to_convert > 5 ? "⏱️ Délai de conversion trop long - Optimiser le cycle de vente" : null
                ].filter(r => r !== null)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la génération du dashboard exécutif',
            error: err.message 
        });
    }
});

// ============================================
// 8. PRÉVISIONS & PROJECTIONS
// ============================================

router.get('/analytics/forecast', async (req, res) => {
    try {
        // Moyenne mobile des 3 derniers mois
        const historique = await db.query(`
            SELECT 
                DATE_TRUNC('month', date_demande) as mois,
                COUNT(*) as demandes,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as conversions
            FROM demonstration
            WHERE date_demande >= NOW() - INTERVAL '3 months'
            GROUP BY DATE_TRUNC('month', date_demande)
            ORDER BY mois DESC
        `);
        
        const moyennes = {
            demandes: historique.rows.reduce((sum, row) => sum + parseInt(row.demandes), 0) / historique.rows.length,
            conversions: historique.rows.reduce((sum, row) => sum + parseInt(row.conversions), 0) / historique.rows.length
        };
        
        // Projection mois prochain
        const joursRestantsMois = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
        const rythmeActuel = await db.query(`
            SELECT 
                COUNT(*) as demandes_jour,
                SUM(CASE WHEN statut IN ('Confirmé', 'Réalisé') THEN 1 ELSE 0 END) as conversions_jour
            FROM demonstration
            WHERE date_demande >= DATE_TRUNC('month', NOW())
        `);
        
        const joursEcoules = new Date().getDate();
        const rythmeQuotidien = {
            demandes: rythmeActuel.rows[0].demandes_jour / joursEcoules,
            conversions: rythmeActuel.rows[0].conversions_jour / joursEcoules
        };
        
        res.json({
            success: true,
            data: {
                projection_mois_prochain: {
                    demandes_prevues: Math.round(rythmeQuotidien.demandes * 30),
                    conversions_prevues: Math.round(rythmeQuotidien.conversions * 30),
                    niveau_confiance: historique.rows.length >= 3 ? "Élevé" : "Moyen"
                },
                objectif_recommandation: {
                    demandes_hebdo: Math.round(rythmeQuotidien.demandes * 7),
                    conversions_hebdo: Math.round(rythmeQuotidien.conversions * 7),
                    seuil_croissance: Math.round(rythmeQuotidien.demandes * 7 * 1.2)
                },
                tendances: {
                    moyenne_3mois_demandes: Math.round(moyennes.demandes),
                    moyenne_3mois_conversions: Math.round(moyennes.conversions),
                    rythme_actuel_demandes: Math.round(rythmeQuotidien.demandes),
                    ecart_tendance: ((rythmeQuotidien.demandes - moyennes.demandes / 30) / (moyennes.demandes / 30) * 100).toFixed(1)
                }
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors des prévisions',
            error: err.message 
        });
    }
});

export default router;