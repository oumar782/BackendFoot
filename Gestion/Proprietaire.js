import express from 'express';
const router = express.Router();
import db from '../db.js';

// ============================================
// 1. GESTION DES SOUMISSIONS DU FORMULAIRE
// ============================================

// Soumettre une nouvelle réponse au formulaire
router.post('/submissions', async (req, res) => {
    try {
        const { phone, extra_comment, answers, multi_answers, language } = req.body;
        
        const submissionId = crypto.randomUUID();
        
        // Insertion dans la table principale
        await db.query(
            `INSERT INTO terrain_form_responses 
             (submission_id, phone, extra_comment, submitted_at, language) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)`,
            [submissionId, phone, extra_comment, language || 'fr']
        );
        
        // Insertion des réponses simples (text et single)
        for (const [questionId, answer] of Object.entries(answers || {})) {
            await db.query(
                `INSERT INTO terrain_form_answers 
                 (submission_id, question_id, answer_value, answer_type, section_id) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [submissionId, questionId, answer, 'single', getSectionFromQuestion(questionId)]
            );
        }
        
        // Insertion des réponses multi-choix
        for (const [questionId, selections] of Object.entries(multi_answers || {})) {
            for (const selection of selections) {
                await db.query(
                    `INSERT INTO terrain_form_answers_multi 
                     (submission_id, question_id, answer_selected, section_id) 
                     VALUES ($1, $2, $3, $4)`,
                    [submissionId, questionId, selection, getSectionFromQuestion(questionId)]
                );
            }
        }
        
        // Log de la soumission
        await db.query(
            `INSERT INTO terrain_form_submission_logs 
             (submission_id, action, ip_address, user_agent) 
             VALUES ($1, $2, $3, $4)`,
            [submissionId, 'submit', req.ip, req.headers['user-agent']]
        );
        
        res.status(201).json({
            success: true,
            message: 'Formulaire soumis avec succès',
            submission_id: submissionId
        });
    } catch (err) {
        console.error('Erreur soumission:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Récupérer toutes les soumissions
router.get('/submissions', async (req, res) => {
    try {
        const { status, date_start, date_end, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = `
            SELECT 
                r.*,
                a.status as admin_status,
                a.notes as admin_notes,
                a.contacted_at,
                (
                    SELECT COUNT(*) FROM terrain_form_answers ans 
                    WHERE ans.submission_id = r.submission_id
                ) as simple_answers_count,
                (
                    SELECT COUNT(*) FROM terrain_form_answers_multi multi 
                    WHERE multi.submission_id = r.submission_id
                ) as multi_answers_count
            FROM terrain_form_responses r
            LEFT JOIN terrain_form_admin a ON r.submission_id = a.submission_id
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (status) {
            query += ` AND a.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        if (date_start) {
            query += ` AND r.submitted_at >= $${paramIndex}`;
            params.push(date_start);
            paramIndex++;
        }
        
        if (date_fin) {
            query += ` AND r.submitted_at <= $${paramIndex}`;
            params.push(date_fin);
            paramIndex++;
        }
        
        query += ` ORDER BY r.submitted_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        
        // Récupérer les réponses détaillées pour chaque submission
        const submissions = await Promise.all(result.rows.map(async (sub) => {
            const answers = await db.query(
                `SELECT question_id, answer_value, answer_type FROM terrain_form_answers 
                 WHERE submission_id = $1`,
                [sub.submission_id]
            );
            
            const multiAnswers = await db.query(
                `SELECT question_id, answer_selected FROM terrain_form_answers_multi 
                 WHERE submission_id = $1`,
                [sub.submission_id]
            );
            
            return {
                ...sub,
                simple_answers: answers.rows,
                multi_answers: multiAnswers.rows
            };
        }));
        
        res.json({
            success: true,
            data: submissions,
            pagination: { page, limit }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Récupérer une soumission spécifique
router.get('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const submission = await db.query(
            `SELECT r.*, a.status, a.notes, a.contacted_by, a.contacted_at
             FROM terrain_form_responses r
             LEFT JOIN terrain_form_admin a ON r.submission_id = a.submission_id
             WHERE r.submission_id = $1`,
            [id]
        );
        
        if (submission.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Soumission non trouvée' });
        }
        
        const answers = await db.query(
            `SELECT * FROM terrain_form_answers WHERE submission_id = $1`,
            [id]
        );
        
        const multiAnswers = await db.query(
            `SELECT * FROM terrain_form_answers_multi WHERE submission_id = $1`,
            [id]
        );
        
        const logs = await db.query(
            `SELECT * FROM terrain_form_submission_logs WHERE submission_id = $1 ORDER BY created_at DESC`,
            [id]
        );
        
        res.json({
            success: true,
            data: {
                ...submission.rows[0],
                simple_answers: answers.rows,
                multi_answers: multiAnswers.rows,
                logs: logs.rows
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Mettre à jour le statut admin d'une soumission
router.patch('/submissions/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes, contacted_by } = req.body;
        
        const result = await db.query(
            `INSERT INTO terrain_form_admin (submission_id, status, notes, contacted_by, contacted_at, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (submission_id) 
             DO UPDATE SET status = $2, notes = $3, contacted_by = $4, updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [id, status, notes, contacted_by]
        );
        
        await db.query(
            `INSERT INTO terrain_form_submission_logs (submission_id, action, performed_by)
             VALUES ($1, $2, $3)`,
            [id, `status_update_to_${status}`, contacted_by || 'admin']
        );
        
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 2. ANALYSE STATISTIQUE DU MARCHÉ
// ============================================

// Analyse globale du marché
router.get('/market/overview', async (req, res) => {
    try {
        const { period = 'all' } = req.query;
        let dateFilter = '';
        
        if (period === '30d') {
            dateFilter = "AND submitted_at >= CURRENT_DATE - INTERVAL '30 days'";
        } else if (period === '90d') {
            dateFilter = "AND submitted_at >= CURRENT_DATE - INTERVAL '90 days'";
        }
        
        // Statistiques de base
        const basicStats = await db.query(`
            SELECT 
                COUNT(*) as total_submissions,
                COUNT(DISTINCT submission_id) as unique_submissions,
                AVG(completion_rate) as avg_completion_rate,
                MIN(submitted_at) as first_submission,
                MAX(submitted_at) as last_submission
            FROM (
                SELECT 
                    r.submission_id,
                    r.submitted_at,
                    (
                        SELECT COUNT(*) FROM terrain_form_answers a 
                        WHERE a.submission_id = r.submission_id
                    ) as answers_count,
                    (
                        SELECT COUNT(*) FROM terrain_form_answers_multi m 
                        WHERE m.submission_id = r.submission_id
                    ) as multi_count,
                    (
                        (SELECT COUNT(*) FROM terrain_form_answers a WHERE a.submission_id = r.submission_id) +
                        (SELECT COUNT(*) FROM terrain_form_answers_multi m WHERE m.submission_id = r.submission_id)
                    ) as total_answers
                FROM terrain_form_responses r
                WHERE 1=1 ${dateFilter}
            ) stats
        `);
        
        // Distribution par section
        const sectionDistribution = await db.query(`
            SELECT 
                'Section ' || section_id as section,
                COUNT(*) as total_responses,
                COUNT(DISTINCT submission_id) as unique_submissions,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM terrain_form_answers WHERE 1=1 ${dateFilter}), 2) as percentage
            FROM terrain_form_answers
            WHERE 1=1 ${dateFilter}
            GROUP BY section_id
            ORDER BY section_id
        `);
        
        // Top réponses par question
        const topAnswers = await db.query(`
            SELECT 
                question_id,
                answer_value as answer,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY question_id), 2) as percentage
            FROM terrain_form_answers
            WHERE answer_type = 'single' AND answer_value IS NOT NULL AND answer_value != ''
            ${dateFilter}
            GROUP BY question_id, answer_value
            ORDER BY question_id, count DESC
        `);
        
        // Analyse des multi-choices
        const multiChoiceAnalysis = await db.query(`
            SELECT 
                question_id,
                answer_selected as answer,
                COUNT(*) as frequency,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_responses WHERE 1=1 ${dateFilter}), 2) as response_rate
            FROM terrain_form_answers_multi
            WHERE 1=1 ${dateFilter}
            GROUP BY question_id, answer_selected
            ORDER BY question_id, frequency DESC
        `);
        
        // Tendance temporelle des soumissions
        const submissionsTrend = await db.query(`
            SELECT 
                DATE_TRUNC('day', submitted_at) as date,
                COUNT(*) as daily_submissions,
                COUNT(DISTINCT submission_id) as unique_submissions,
                SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) as phone_provided
            FROM terrain_form_responses
            WHERE submitted_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('day', submitted_at)
            ORDER BY date DESC
        `);
        
        res.json({
            success: true,
            data: {
                basic_statistics: basicStats.rows[0],
                section_distribution: sectionDistribution.rows,
                top_answers: topAnswers.rows,
                multi_choice_analysis: multiChoiceAnalysis.rows,
                submissions_trend: submissionsTrend.rows,
                insights: generateOverviewInsights(basicStats.rows[0], sectionDistribution.rows, topAnswers.rows)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse détaillée par question
router.get('/market/question-analysis/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        
        // Récupérer les réponses simples
        const simpleAnswers = await db.query(`
            SELECT 
                answer_value,
                COUNT(*) as frequency,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
                STRING_AGG(DISTINCT submission_id::text, ', ') as sample_submissions
            FROM terrain_form_answers
            WHERE question_id = $1 AND answer_value IS NOT NULL AND answer_value != ''
            GROUP BY answer_value
            ORDER BY frequency DESC
        `, [questionId]);
        
        // Récupérer les réponses multi
        const multiAnswers = await db.query(`
            SELECT 
                answer_selected,
                COUNT(*) as frequency,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = $1), 2) as selection_rate
            FROM terrain_form_answers_multi
            WHERE question_id = $1
            GROUP BY answer_selected
            ORDER BY frequency DESC
        `, [questionId]);
        
        // Corrélations avec d'autres questions
        const correlations = await db.query(`
            WITH main_answers AS (
                SELECT submission_id, answer_value as main_answer
                FROM terrain_form_answers
                WHERE question_id = $1 AND answer_value IS NOT NULL
            )
            SELECT 
                a.question_id,
                a.answer_value as correlated_answer,
                COUNT(*) as correlation_count,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM main_answers), 2) as correlation_rate
            FROM terrain_form_answers a
            JOIN main_answers m ON a.submission_id = m.submission_id
            WHERE a.question_id != $1 AND a.answer_value IS NOT NULL
            GROUP BY a.question_id, a.answer_value
            ORDER BY correlation_count DESC
            LIMIT 20
        `, [questionId]);
        
        res.json({
            success: true,
            data: {
                question_id: questionId,
                simple_answers: simpleAnswers.rows,
                multi_answers: multiAnswers.rows,
                correlations: correlations.rows,
                total_responses: simpleAnswers.rows.reduce((sum, r) => sum + parseInt(r.frequency), 0) + 
                               multiAnswers.rows.reduce((sum, r) => sum + parseInt(r.frequency), 0)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse segmentée par caractéristiques
router.get('/market/segmentation', async (req, res) => {
    try {
        // Segmentation par type de propriétaire
        const ownerSegments = await db.query(`
            SELECT 
                CASE 
                    WHEN a.answer_value LIKE '%propriétaire%' THEN 'Propriétaire'
                    WHEN a.answer_value LIKE '%gestionnaire%' THEN 'Gestionnaire'
                    WHEN a.answer_value LIKE '%investisseur%' THEN 'Investisseur'
                    ELSE 'Autre'
                END as owner_type,
                COUNT(DISTINCT a.submission_id) as count,
                ROUND(COUNT(DISTINCT a.submission_id) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers WHERE question_id = 'q1'), 2) as percentage
            FROM terrain_form_answers a
            WHERE a.question_id = 'q1'
            GROUP BY owner_type
        `);
        
        // Segmentation par expérience
        const experienceSegments = await db.query(`
            SELECT 
                answer_value as experience_level,
                COUNT(DISTINCT submission_id) as respondents,
                ROUND(COUNT(DISTINCT submission_id) * 100.0 / SUM(COUNT(DISTINCT submission_id)) OVER (), 2) as percentage
            FROM terrain_form_answers
            WHERE question_id = 'q2'
            GROUP BY answer_value
            ORDER BY respondents DESC
        `);
        
        // Profil croisé expérience vs propriétaire
        const crossProfile = await db.query(`
            SELECT 
                own.answer_value as owner_type,
                exp.answer_value as experience_level,
                COUNT(DISTINCT own.submission_id) as count
            FROM terrain_form_answers own
            JOIN terrain_form_answers exp ON own.submission_id = exp.submission_id
            WHERE own.question_id = 'q1' AND exp.question_id = 'q2'
            GROUP BY own.answer_value, exp.answer_value
            ORDER BY count DESC
        `);
        
        // Segmentation géographique (si disponible via phone)
        const geographicSegments = await db.query(`
            SELECT 
                LEFT(phone, 2) as phone_prefix,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM terrain_form_responses WHERE phone IS NOT NULL AND phone != ''), 2) as percentage
            FROM terrain_form_responses
            WHERE phone IS NOT NULL AND phone != '' AND phone ~ '^[0-9]{10,}$'
            GROUP BY LEFT(phone, 2)
            ORDER BY count DESC
        `);
        
        res.json({
            success: true,
            data: {
                owner_segments: ownerSegments.rows,
                experience_segments: experienceSegments.rows,
                cross_profile: crossProfile.rows,
                geographic_segments: geographicSegments.rows,
                segment_insights: generateSegmentInsights(ownerSegments.rows, experienceSegments.rows, crossProfile.rows)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse des besoins et douleurs
router.get('/market/needs-analysis', async (req, res) => {
    try {
        // Principales difficultés rencontrées
        const mainDifficulties = await db.query(`
            SELECT 
                answer_selected as difficulty,
                COUNT(DISTINCT submission_id) as affected_users,
                ROUND(COUNT(DISTINCT submission_id) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = 'q5'), 2) as impact_percentage
            FROM terrain_form_answers_multi
            WHERE question_id = 'q5'
            GROUP BY answer_selected
            ORDER BY affected_users DESC
        `);
        
        // Fonctionnalités les plus demandées
        const requestedFeatures = await db.query(`
            SELECT 
                answer_selected as feature,
                COUNT(DISTINCT submission_id) as requests,
                ROUND(COUNT(DISTINCT submission_id) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = 'q6'), 2) as demand_rate
            FROM terrain_form_answers_multi
            WHERE question_id = 'q6'
            GROUP BY answer_selected
            ORDER BY requests DESC
        `);
        
        // Investissement potentiel
        const investmentReadiness = await db.query(`
            SELECT 
                answer_value as investment_level,
                COUNT(*) as respondents,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
                CASE 
                    WHEN answer_value LIKE '%oui%' OR answer_value LIKE '%intéressé%' THEN 'High'
                    WHEN answer_value LIKE '%peut-être%' OR answer_value LIKE '%étudier%' THEN 'Medium'
                    ELSE 'Low'
                END as readiness_level
            FROM terrain_form_answers
            WHERE question_id = 'q4' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY respondents DESC
        `);
        
        // Pain points prioritaires
        const priorityPainPoints = await db.query(`
            WITH difficulties AS (
                SELECT 
                    submission_id,
                    answer_selected as difficulty,
                    ROW_NUMBER() OVER (PARTITION BY submission_id) as priority_order
                FROM terrain_form_answers_multi
                WHERE question_id = 'q5'
            ),
            important_features AS (
                SELECT 
                    submission_id,
                    answer_selected as feature,
                    ROW_NUMBER() OVER (PARTITION BY submission_id) as priority_order
                FROM terrain_form_answers_multi
                WHERE question_id = 'q6'
            )
            SELECT 
                d.difficulty as pain_point,
                COUNT(DISTINCT d.submission_id) as occurrence,
                COUNT(DISTINCT f.submission_id) as linked_feature_requests,
                ROUND(AVG(CASE WHEN d.priority_order = 1 THEN 3 WHEN d.priority_order = 2 THEN 2 ELSE 1 END), 2) as avg_priority_score
            FROM difficulties d
            LEFT JOIN important_features f ON d.submission_id = f.submission_id
            GROUP BY d.difficulty
            ORDER BY avg_priority_score DESC, occurrence DESC
        `);
        
        res.json({
            success: true,
            data: {
                main_difficulties: mainDifficulties.rows,
                requested_features: requestedFeatures.rows,
                investment_readiness: investmentReadiness.rows,
                priority_pain_points: priorityPainPoints.rows,
                market_opportunity_score: calculateMarketOpportunity(mainDifficulties.rows, requestedFeatures.rows, investmentReadiness.rows),
                recommendations: generateNeedBasedRecommendations(mainDifficulties.rows, requestedFeatures.rows, priorityPainPoints.rows)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse concurrentielle et positionnement
router.get('/market/competitive-analysis', async (req, res) => {
    try {
        // Solutions actuelles utilisées
        const currentSolutions = await db.query(`
            SELECT 
                answer_selected as solution,
                COUNT(DISTINCT submission_id) as users,
                ROUND(COUNT(DISTINCT submission_id) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = 'q10'), 2) as market_share
            FROM terrain_form_answers_multi
            WHERE question_id = 'q10'
            GROUP BY answer_selected
            ORDER BY users DESC
        `);
        
        // Critères de sélection importants
        const selectionCriteria = await db.query(`
            SELECT 
                answer_selected as criteria,
                COUNT(DISTINCT submission_id) as importance_count,
                ROUND(COUNT(DISTINCT submission_id) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = 'q11'), 2) as importance_rate
            FROM terrain_form_answers_multi
            WHERE question_id = 'q11'
            GROUP BY answer_selected
            ORDER BY importance_count DESC
        `);
        
        // Budget moyen
        const budgetAnalysis = await db.query(`
            SELECT 
                answer_value as budget_range,
                COUNT(*) as respondents,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
                CASE 
                    WHEN answer_value LIKE '%50-100%' THEN 75
                    WHEN answer_value LIKE '%100-200%' THEN 150
                    WHEN answer_value LIKE '%200-500%' THEN 350
                    WHEN answer_value LIKE '%500+%' THEN 750
                    ELSE 0
                END as avg_budget
            FROM terrain_form_answers
            WHERE question_id = 'q12' AND answer_value IS NOT NULL
            GROUP BY answer_value
        `);
        
        // Satisfaction actuelle
        const satisfactionLevels = await db.query(`
            SELECT 
                answer_value as satisfaction,
                COUNT(*) as respondents,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
            FROM terrain_form_answers
            WHERE question_id = 'q13' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY 
                CASE answer_value
                    WHEN 'Très satisfait' THEN 1
                    WHEN 'Satisfait' THEN 2
                    WHEN 'Neutre' THEN 3
                    WHEN 'Insatisfait' THEN 4
                    WHEN 'Très insatisfait' THEN 5
                END
        `);
        
        // Switching intent
        const switchingIntent = await db.query(`
            SELECT 
                answer_value as intent,
                COUNT(*) as respondents,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
            FROM terrain_form_answers
            WHERE question_id = 'q14' AND answer_value IS NOT NULL
            GROUP BY answer_value
        `);
        
        res.json({
            success: true,
            data: {
                current_solutions: currentSolutions.rows,
                selection_criteria: selectionCriteria.rows,
                budget_analysis: budgetAnalysis.rows,
                satisfaction_levels: satisfactionLevels.rows,
                switching_intent: switchingIntent.rows,
                market_positioning: calculateMarketPositioning(currentSolutions.rows, satisfactionLevels.rows, switchingIntent.rows),
                competitive_advantages: identifyCompetitiveAdvantages(selectionCriteria.rows, satisfactionLevels.rows)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse des prix et ROI
router.get('/market/pricing-analysis', async (req, res) => {
    try {
        // Prix acceptable
        const acceptablePricing = await db.query(`
            SELECT 
                answer_value as price_range,
                COUNT(*) as respondents,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage,
                CASE 
                    WHEN answer_value LIKE '%<500%' THEN 'Entry'
                    WHEN answer_value LIKE '%500-1000%' THEN 'Standard'
                    WHEN answer_value LIKE '%1000-2000%' THEN 'Premium'
                    WHEN answer_value LIKE '%>2000%' THEN 'Enterprise'
                    ELSE 'Unknown'
                END as tier
            FROM terrain_form_answers
            WHERE question_id = 'q15' AND answer_value IS NOT NULL
            GROUP BY answer_value
        `);
        
        // Modèle de paiement préféré
        const preferredPaymentModels = await db.query(`
            SELECT 
                answer_selected as payment_model,
                COUNT(DISTINCT submission_id) as preferences,
                ROUND(COUNT(DISTINCT submission_id) * 100.0 / (SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = 'q16'), 2) as preference_rate
            FROM terrain_form_answers_multi
            WHERE question_id = 'q16'
            GROUP BY answer_selected
            ORDER BY preferences DESC
        `);
        
        // ROI attendu
        const expectedROI = await db.query(`
            SELECT 
                answer_value as roi_expectation,
                COUNT(*) as respondents,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
            FROM terrain_form_answers
            WHERE question_id = 'q17' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY 
                CASE answer_value
                    WHEN '< 6 mois' THEN 1
                    WHEN '6-12 mois' THEN 2
                    WHEN '12-24 mois' THEN 3
                    WHEN '> 24 mois' THEN 4
                END
        `);
        
        // Price sensitivity
        const priceSensitivity = await db.query(`
            SELECT 
                answer_value as sensitivity,
                COUNT(*) as respondents,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
            FROM terrain_form_answers
            WHERE question_id = 'q18' AND answer_value IS NOT NULL
            GROUP BY answer_value
        `);
        
        res.json({
            success: true,
            data: {
                acceptable_pricing: acceptablePricing.rows,
                preferred_payment_models: preferredPaymentModels.rows,
                expected_roi: expectedROI.rows,
                price_sensitivity: priceSensitivity.rows,
                pricing_strategy: recommendPricingStrategy(acceptablePricing.rows, preferredPaymentModels.rows, expectedROI.rows),
                revenue_potential: calculateRevenuePotential(acceptablePricing.rows, preferredPaymentModels.rows)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 3. EXPORT ET REPORTING
// ============================================

// Exporter les données au format CSV
router.get('/export/csv', async (req, res) => {
    try {
        const submissions = await db.query(`
            SELECT 
                r.submission_id,
                r.phone,
                r.extra_comment,
                r.submitted_at,
                r.language,
                a.status,
                a.notes,
                (
                    SELECT json_agg(json_build_object('question_id', question_id, 'answer', answer_value))
                    FROM terrain_form_answers
                    WHERE submission_id = r.submission_id
                ) as simple_answers,
                (
                    SELECT json_agg(json_build_object('question_id', question_id, 'answer', answer_selected))
                    FROM terrain_form_answers_multi
                    WHERE submission_id = r.submission_id
                ) as multi_answers
            FROM terrain_form_responses r
            LEFT JOIN terrain_form_admin a ON r.submission_id = a.submission_id
            ORDER BY r.submitted_at DESC
        `);
        
        res.json({
            success: true,
            data: submissions.rows,
            export_date: new Date().toISOString(),
            total_records: submissions.rows.length
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Dashboard d'analyse executive
router.get('/dashboard/executive', async (req, res) => {
    try {
        // KPIs principaux
        const keyMetrics = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM terrain_form_responses) as total_submissions,
                (SELECT COUNT(*) FROM terrain_form_responses WHERE phone IS NOT NULL AND phone != '') as leads_generated,
                (SELECT ROUND(AVG(completion_rate), 2) FROM (
                    SELECT 
                        submission_id,
                        COUNT(*) * 100.0 / 18 as completion_rate
                    FROM (
                        SELECT submission_id FROM terrain_form_answers
                        UNION ALL
                        SELECT submission_id FROM terrain_form_answers_multi
                    ) all_answers
                    GROUP BY submission_id
                ) rates) as avg_completion_rate,
                (SELECT COUNT(*) FROM terrain_form_admin WHERE status = 'contacted') as contacted_leads,
                (SELECT COUNT(*) FROM terrain_form_admin WHERE status = 'completed') as converted_leads
        `);
        
        // Top insights
        const topInsights = await db.query(`
            SELECT 
                'Principale difficulté' as insight_type,
                answer_selected as value,
                COUNT(*) as mentions
            FROM terrain_form_answers_multi
            WHERE question_id = 'q5'
            GROUP BY answer_selected
            ORDER BY mentions DESC
            LIMIT 1
            UNION ALL
            SELECT 
                'Fonctionnalité la plus demandée' as insight_type,
                answer_selected as value,
                COUNT(*) as mentions
            FROM terrain_form_answers_multi
            WHERE question_id = 'q6'
            GROUP BY answer_selected
            ORDER BY mentions DESC
            LIMIT 1
            UNION ALL
            SELECT 
                'Budget moyen' as insight_type,
                answer_value as value,
                COUNT(*) as mentions
            FROM terrain_form_answers
            WHERE question_id = 'q12'
            GROUP BY answer_value
            ORDER BY mentions DESC
            LIMIT 1
        `);
        
        // Growth trend
        const growthTrend = await db.query(`
            SELECT 
                DATE_TRUNC('week', submitted_at) as week,
                COUNT(*) as submissions,
                COUNT(*) - LAG(COUNT(*), 1) OVER (ORDER BY DATE_TRUNC('week', submitted_at)) as growth
            FROM terrain_form_responses
            WHERE submitted_at >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY DATE_TRUNC('week', submitted_at)
            ORDER BY week DESC
        `);
        
        res.json({
            success: true,
            data: {
                key_metrics: keyMetrics.rows[0],
                top_insights: topInsights.rows,
                growth_trend: growthTrend.rows,
                recommendations: generateExecutiveRecommendations(keyMetrics.rows[0], topInsights.rows),
                risk_factors: identifyRiskFactors(growthTrend.rows, topInsights.rows)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

function getSectionFromQuestion(questionId) {
    const mapping = {
        'q1': 's1', 'q2': 's1', 'q3': 's1', 'q4': 's1',
        'q5': 's2', 'q6': 's2', 'q7': 's2', 'q8': 's2', 'q9': 's2',
        'q10': 's3', 'q11': 's3', 'q12': 's3', 'q13': 's3',
        'q14': 's4', 'q15': 's4', 'q16': 's4', 'q17': 's4',
        'q18': 's5', 'q19': 's5', 'q20': 's5', 'q21': 's5',
        'q22': 's6', 'q23': 's6', 'q24': 's6'
    };
    return mapping[questionId] || 'unknown';
}

function generateOverviewInsights(basicStats, sectionDistribution, topAnswers) {
    const insights = [];
    
    if (basicStats?.avg_completion_rate > 70) {
        insights.push("Fort taux de complétion du formulaire, indiquant un intérêt marqué du marché");
    }
    
    if (sectionDistribution?.length > 0) {
        const mostCompleted = sectionDistribution.reduce((max, s) => 
            parseFloat(s.percentage) > parseFloat(max.percentage) ? s : max
        );
        insights.push(`La section ${mostCompleted.section} suscite le plus d'intérêt (${mostCompleted.percentage}% des réponses)`);
    }
    
    if (topAnswers?.length > 0) {
        insights.push(`Les répondants montrent une préférence marquée pour certaines options, suggérant des opportunités de marché ciblées`);
    }
    
    insights.push(`Période d'analyse: ${basicStats?.first_submission ? new Date(basicStats.first_submission).toLocaleDateString() : 'N/A'} - ${basicStats?.last_submission ? new Date(basicStats.last_submission).toLocaleDateString() : 'N/A'}`);
    
    return insights;
}

function generateSegmentInsights(ownerSegments, experienceSegments, crossProfile) {
    return {
        target_segments: ownerSegments.filter(s => s.percentage > 20).map(s => s.owner_type),
        experience_distribution: experienceSegments,
        best_cross_sell: crossProfile.slice(0, 3),
        market_maturity: experienceSegments.some(e => e.experience_level === 'Expert' && e.percentage > 30) ? 
            "Marché mature avec des experts" : "Marché en développement avec des novices"
    };
}

function calculateMarketOpportunity(difficulties, features, investment) {
    const problemScore = difficulties.reduce((sum, d) => sum + (d.impact_percentage || 0), 0) / difficulties.length;
    const featureScore = features.reduce((sum, f) => sum + (f.demand_rate || 0), 0) / features.length;
    const investmentScore = investment.reduce((sum, i) => {
        if (i.readiness_level === 'High') return sum + 100;
        if (i.readiness_level === 'Medium') return sum + 50;
        return sum;
    }, 0) / (investment.length || 1);
    
    return {
        score: (problemScore * 0.4 + featureScore * 0.3 + investmentScore * 0.3),
        level: (problemScore * 0.4 + featureScore * 0.3 + investmentScore * 0.3) > 70 ? "Haute" : 
               (problemScore * 0.4 + featureScore * 0.3 + investmentScore * 0.3) > 40 ? "Moyenne" : "Basse",
        components: { problemScore, featureScore, investmentScore }
    };
}

function generateNeedBasedRecommendations(difficulties, features, painPoints) {
    const recommendations = [];
    
    if (difficulties[0]?.difficulty === "Gestion des réservations") {
        recommendations.push("Priorité #1: Développer un système de réservation intelligent et automatisé");
    }
    
    if (features[0]?.feature === "Application mobile") {
        recommendations.push("Investir dans une application mobile native avec notifications push");
    }
    
    if (painPoints[0]?.avg_priority_score > 2) {
        recommendations.push(`Solutionner en priorité: ${painPoints[0].pain_point} (score d'urgence: ${painPoints[0].avg_priority_score})`);
    }
    
    recommendations.push("MVP recommandé: Système de réservation + Paiement intégré + Dashboard analytics");
    
    return recommendations;
}

function calculateMarketPositioning(currentSolutions, satisfaction, switchingIntent) {
    const unsatisfiedRate = satisfaction.find(s => s.satisfaction === 'Insatisfait' || s.satisfaction === 'Très insatisfait')?.percentage || 0;
    const switchingRate = switchingIntent.find(s => s.intent.includes('Oui'))?.percentage || 0;
    
    return {
        market_gap: unsatisfiedRate > 30 ? "Opportunité majeure - Marché insatisfait" : "Opportunité modérée",
        switching_potential: switchingRate,
        recommendation: switchingRate > 40 ? "Campagne agressive d'acquisition" : "Stratégie de différenciation progressive"
    };
}

function identifyCompetitiveAdvantages(criteria, satisfaction) {
    const topCriteria = criteria.slice(0, 3).map(c => c.criteria);
    const satisfactionGaps = satisfaction.filter(s => s.satisfaction.includes('Insatisfait'));
    
    return {
        key_differentiators: topCriteria,
        pain_points_to_address: satisfactionGaps,
        value_proposition: `Solution qui ${topCriteria.join(', ')} mieux que la concurrence`
    };
}

function recommendPricingStrategy(pricing, paymentModels, roi) {
    const preferredModel = paymentModels[0]?.payment_model || 'Mensuel';
    const avgBudget = pricing.reduce((sum, p) => sum + (p.avg_budget || 0), 0) / pricing.length;
    const roiExpectation = roi[0]?.roi_expectation || '12-24 mois';
    
    return {
        recommended_model: preferredModel,
        price_point: avgBudget,
        roi_expectation: roiExpectation,
        strategy: avgBudget > 500 ? "Premium avec support dédié" : "Volume avec freemium",
        tiers: [
            { name: "Essentiel", price: Math.round(avgBudget * 0.5), features: ["Réservation", "Calendar"] },
            { name: "Professionnel", price: Math.round(avgBudget), features: ["Analytics", "Paiement", "Support"] },
            { name: "Enterprise", price: Math.round(avgBudget * 2), features: ["API", "Dédié", "SLA"] }
        ]
    };
}

function calculateRevenuePotential(pricing, paymentModels) {
    const avgPrice = pricing.reduce((sum, p) => sum + (p.avg_budget || 0), 0) / pricing.length;
    const marketSize = 1000; // Taille estimée du marché
    const adoptionRate = 0.15; // Taux d'adoption estimé
    
    const monthlyRevenue = avgPrice * marketSize * adoptionRate;
    const yearlyRevenue = monthlyRevenue * 12;
    
    return {
        market_size_estimate: marketSize,
        adoption_target: `${(adoptionRate * 100)}%`,
        monthly_revenue_potential: monthlyRevenue,
        yearly_revenue_potential: yearlyRevenue,
        break_even_months: 8 // Estimation
    };
}

function generateExecutiveRecommendations(metrics, insights) {
    const recommendations = [];
    
    if (metrics.total_submissions < 100) {
        recommendations.push("Augmenter l'acquisition de leads: Campagne Facebook Ads + SEO local");
    }
    
    if (metrics.leads_generated / metrics.total_submissions < 0.5) {
        recommendations.push("Optimiser le formulaire pour augmenter le taux de conversion lead");
    }
    
    if (metrics.converted_leads / metrics.contacted_leads < 0.3) {
        recommendations.push("Améliorer le processus de vente et qualification des leads");
    }
    
    recommendations.push(`Focus prioritaire sur: ${insights[0]?.value || 'solution de réservation'}`);
    recommendations.push("Objectif Q1: 200 leads qualifiés avec 30% de conversion");
    
    return recommendations;
}

function identifyRiskFactors(growthTrend, insights) {
    const risks = [];
    
    if (growthTrend.length > 4 && growthTrend[0]?.growth < 0) {
        risks.push("Décroissance des soumissions - Revoir stratégie d'acquisition");
    }
    
    if (insights.some(i => i.insight_type === 'Budget moyen' && i.value.includes('<500'))) {
        risks.push("Budget moyen bas - Risque sur la rentabilité");
    }
    
    risks.push("Concurrence sur le marché des réservations sportives");
    
    return risks;
}

export default router;