import express from 'express';
const router = express.Router();
import db from '../db.js';
import crypto from 'crypto';

// ============================================
// 1. GESTION DES SOUMISSIONS DU FORMULAIRE
// ============================================

// Soumettre une nouvelle réponse au formulaire
router.post('/submissions', async (req, res) => {
    try {
        const { phone, extra_comment, answers, multi_answers } = req.body;
        
        const submissionId = crypto.randomUUID();
        
        // Insertion dans la table principale (SANS language)
        await db.query(
            `INSERT INTO terrain_form_responses 
             (submission_id, phone, extra_comment, submitted_at) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
            [submissionId, phone || null, extra_comment || null]
        );
        
        // Insertion des réponses simples (text et single)
        for (const [questionId, answer] of Object.entries(answers || {})) {
            if (answer && answer.trim && answer.trim() !== '') {
                await db.query(
                    `INSERT INTO terrain_form_answers 
                     (submission_id, question_id, answer_value, answer_type, section_id) 
                     VALUES ($1, $2, $3, $4, $5)`,
                    [submissionId, questionId, answer, 'single', getSectionFromQuestion(questionId)]
                );
            }
        }
        
        // Insertion des réponses multi-choix
        for (const [questionId, selections] of Object.entries(multi_answers || {})) {
            if (Array.isArray(selections) && selections.length > 0) {
                for (const selection of selections) {
                    await db.query(
                        `INSERT INTO terrain_form_answers_multi 
                         (submission_id, question_id, answer_selected, section_id) 
                         VALUES ($1, $2, $3, $4)`,
                        [submissionId, questionId, selection, getSectionFromQuestion(questionId)]
                    );
                }
            }
        }
        
        // Log de la soumission
        await db.query(
            `INSERT INTO terrain_form_submission_logs 
             (submission_id, action, ip_address, user_agent) 
             VALUES ($1, $2, $3, $4)`,
            [submissionId, 'submit', req.ip || null, req.headers['user-agent'] || null]
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
        const { status, date_start, page = 1, limit = 50 } = req.query;
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
            pagination: { page, limit, total: submissions.length }
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
// 2. ANALYSE STATISTIQUE DU MARCHÉ (VERSION ULTRA COMPLÈTE)
// ============================================

// Analyse globale du marché - Version ultra détaillée
router.get('/market/overview', async (req, res) => {
    try {
        const { period = 'all', segment_by = null } = req.query;
        let dateFilter = '';
        
        if (period === '30d') {
            dateFilter = "AND submitted_at >= CURRENT_DATE - INTERVAL '30 days'";
        } else if (period === '90d') {
            dateFilter = "AND submitted_at >= CURRENT_DATE - INTERVAL '90 days'";
        } else if (period === 'year') {
            dateFilter = "AND submitted_at >= CURRENT_DATE - INTERVAL '1 year'";
        }
        
        // 1. STATISTIQUES DE BASE AVANCÉES
        const basicStats = await db.query(`
            SELECT 
                COUNT(*) as total_submissions,
                COUNT(DISTINCT submission_id) as unique_submissions,
                COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as phone_provided_count,
                ROUND(COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as phone_provided_rate,
                AVG(LENGTH(extra_comment)) as avg_comment_length,
                COUNT(CASE WHEN extra_comment IS NOT NULL AND extra_comment != '' THEN 1 END) as comments_provided,
                MIN(submitted_at) as first_submission,
                MAX(submitted_at) as last_submission,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM submitted_at)) as median_hour,
                MODE() WITHIN GROUP (ORDER BY EXTRACT(DOW FROM submitted_at)) as most_common_weekday
            FROM terrain_form_responses
            WHERE 1=1 ${dateFilter}
        `);
        
        // 2. TAUX DE COMPLÉTION PAR QUESTION
        const completionRates = await db.query(`
            WITH questions_list AS (
                SELECT unnest(ARRAY['q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12','q13','q14','q15','q16','q17','q18','q19','q20','q21','q22','q23','q24']) as qid
            ),
            answers_count AS (
                SELECT question_id, COUNT(DISTINCT submission_id) as answered_count
                FROM terrain_form_answers
                WHERE 1=1 ${dateFilter.replace('submitted_at', 'created_at')}
                GROUP BY question_id
            )
            SELECT 
                q.qid as question_id,
                COALESCE(ac.answered_count, 0) as answered_count,
                ${period === 'all' ? '(SELECT COUNT(*) FROM terrain_form_responses)' : 
                  '(SELECT COUNT(*) FROM terrain_form_responses WHERE submitted_at >= CURRENT_DATE - INTERVAL \'30 days\')'} as total_submissions,
                ROUND(COALESCE(ac.answered_count, 0)::NUMERIC / NULLIF(${period === 'all' ? '(SELECT COUNT(*) FROM terrain_form_responses)' : 
                  '(SELECT COUNT(*) FROM terrain_form_responses WHERE submitted_at >= CURRENT_DATE - INTERVAL \'30 days\')'}, 0) * 100, 2) as completion_rate
            FROM questions_list q
            LEFT JOIN answers_count ac ON q.qid = ac.question_id
            ORDER BY completion_rate DESC
        `);
        
        // 3. ANALYSE DE L'ENGAGEMENT PAR SECTION
        const sectionEngagement = await db.query(`
            SELECT 
                section_id,
                COUNT(DISTINCT submission_id) as unique_respondents,
                COUNT(*) as total_responses,
                ROUND(AVG(CASE WHEN answer_value != '' THEN 1 ELSE 0 END) * 100, 2) as engagement_score,
                COUNT(DISTINCT question_id) as questions_in_section
            FROM terrain_form_answers
            WHERE 1=1 ${dateFilter.replace('submitted_at', 'created_at')}
            GROUP BY section_id
            ORDER BY section_id
        `);
        
        // 4. DISTRIBUTION DÉTAILLÉE PAR SECTION
        const sectionDistribution = await db.query(`
            SELECT 
                CASE 
                    WHEN section_id = 's1' THEN 'Section 1 - Profil du répondant'
                    WHEN section_id = 's2' THEN 'Section 2 - Usage actuel'
                    WHEN section_id = 's3' THEN 'Section 3 - Équipement'
                    WHEN section_id = 's4' THEN 'Section 4 - Organisation'
                    WHEN section_id = 's5' THEN 'Section 5 - Problématiques'
                    WHEN section_id = 's6' THEN 'Section 6 - Besoins futurs'
                    ELSE 'Section ' || section_id
                END as section_name,
                section_id,
                COUNT(*) as total_responses,
                COUNT(DISTINCT submission_id) as unique_submissions,
                COUNT(DISTINCT question_id) as unique_questions,
                ROUND(COUNT(*)::NUMERIC / NULLIF(COUNT(DISTINCT submission_id), 0), 2) as avg_responses_per_user
            FROM terrain_form_answers
            WHERE 1=1 ${dateFilter.replace('submitted_at', 'created_at')}
            GROUP BY section_id
            ORDER BY section_id
        `);
        
        // 5. TOP RÉPONSES PAR QUESTION (plus détaillé)
        const topAnswers = await db.query(`
            WITH ranked_answers AS (
                SELECT 
                    question_id,
                    answer_value as answer,
                    COUNT(*) as count,
                    COUNT(DISTINCT submission_id) as unique_users,
                    ROUND(COUNT(*)::NUMERIC / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY question_id), 0) * 100, 2) as percentage,
                    ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY COUNT(*) DESC) as rank
                FROM terrain_form_answers
                WHERE answer_type = 'single' 
                    AND answer_value IS NOT NULL 
                    AND answer_value != ''
                    ${dateFilter.replace('submitted_at', 'created_at')}
                GROUP BY question_id, answer_value
            )
            SELECT 
                question_id,
                answer,
                count as frequency,
                unique_users,
                percentage,
                rank
            FROM ranked_answers
            WHERE rank <= 5
            ORDER BY question_id, rank
        `);
        
        // 6. ANALYSE DES MULTI-CHOICES (heatmap)
        const multiChoiceHeatmap = await db.query(`
            SELECT 
                question_id,
                answer_selected as answer,
                COUNT(*) as frequency,
                COUNT(DISTINCT submission_id) as unique_selections,
                ROUND(COUNT(*)::NUMERIC / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY question_id), 0) * 100, 2) as selection_rate,
                STRING_AGG(DISTINCT LEFT(submission_id::text, 8), ', ') as sample_ids
            FROM terrain_form_answers_multi
            WHERE 1=1 ${dateFilter.replace('submitted_at', 'created_at')}
            GROUP BY question_id, answer_selected
            ORDER BY question_id, frequency DESC
        `);
        
        // 7. CORRÉLATIONS ENTRE QUESTIONS
        const correlations = await db.query(`
            WITH q1_answers AS (
                SELECT submission_id, answer_value as q1_answer
                FROM terrain_form_answers
                WHERE question_id = 'q1'
            ),
            q2_answers AS (
                SELECT submission_id, answer_value as q2_answer
                FROM terrain_form_answers
                WHERE question_id = 'q2'
            ),
            cross_tab AS (
                SELECT 
                    q1_answer,
                    q2_answer,
                    COUNT(*) as count
                FROM q1_answers q1
                JOIN q2_answers q2 ON q1.submission_id = q2.submission_id
                GROUP BY q1_answer, q2_answer
            )
            SELECT 
                q1_answer,
                json_agg(json_build_object('response', q2_answer, 'count', count)) as correlations
            FROM cross_tab
            GROUP BY q1_answer
        `);
        
        // 8. TENDANCE TEMPORELLE (heure par heure, jour par jour)
        const hourlyPattern = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM submitted_at) as hour,
                COUNT(*) as submissions,
                COUNT(DISTINCT submission_id) as unique_submissions
            FROM terrain_form_responses
            WHERE submitted_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY EXTRACT(HOUR FROM submitted_at)
            ORDER BY hour
        `);
        
        const weeklyPattern = await db.query(`
            SELECT 
                EXTRACT(DOW FROM submitted_at) as weekday,
                TO_CHAR(submitted_at, 'Day') as day_name,
                COUNT(*) as submissions,
                AVG(COUNT(*)) OVER () as avg_daily
            FROM terrain_form_responses
            WHERE submitted_at >= CURRENT_DATE - INTERVAL '90 days'
            GROUP BY EXTRACT(DOW FROM submitted_at), TO_CHAR(submitted_at, 'Day')
            ORDER BY weekday
        `);
        
        const submissionsTrend = await db.query(`
            SELECT 
                DATE_TRUNC('day', submitted_at) as date,
                COUNT(*) as daily_submissions,
                COUNT(DISTINCT submission_id) as unique_submissions,
                SUM(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 ELSE 0 END) as phone_provided,
                LAG(COUNT(*), 1) OVER (ORDER BY DATE_TRUNC('day', submitted_at)) as prev_day_count,
                CASE 
                    WHEN LAG(COUNT(*), 1) OVER (ORDER BY DATE_TRUNC('day', submitted_at)) IS NULL THEN NULL
                    ELSE ROUND((COUNT(*) - LAG(COUNT(*), 1) OVER (ORDER BY DATE_TRUNC('day', submitted_at)))::NUMERIC / 
                         NULLIF(LAG(COUNT(*), 1) OVER (ORDER BY DATE_TRUNC('day', submitted_at)), 0) * 100, 2)
                END as day_over_day_growth
            FROM terrain_form_responses
            WHERE submitted_at >= CURRENT_DATE - INTERVAL '60 days'
            GROUP BY DATE_TRUNC('day', submitted_at)
            ORDER BY date DESC
        `);
        
        res.json({
            success: true,
            data: {
                period_analyzed: period,
                analysis_date: new Date().toISOString(),
                basic_statistics: basicStats.rows[0],
                completion_rates: completionRates.rows,
                section_engagement: sectionEngagement.rows,
                section_distribution: sectionDistribution.rows,
                top_answers_by_question: topAnswers.rows,
                multi_choice_heatmap: multiChoiceHeatmap.rows,
                cross_question_correlations: correlations.rows,
                temporal_patterns: {
                    hourly_distribution: hourlyPattern.rows,
                    weekly_distribution: weeklyPattern.rows,
                    daily_trend: submissionsTrend.rows
                }
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse détaillée par question avec insights avancés
router.get('/market/question-analysis/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        const { segment_by, compare_with } = req.query;
        
        // Récupérer les métadonnées de la question
        const questionMeta = await db.query(`
            SELECT 
                question_id,
                answer_type,
                COUNT(DISTINCT submission_id) as total_respondents,
                MIN(created_at) as first_response,
                MAX(created_at) as last_response
            FROM terrain_form_answers
            WHERE question_id = $1
            GROUP BY question_id, answer_type
        `, [questionId]);
        
        // Analyse des réponses simples
        const simpleAnswers = await db.query(`
            WITH answer_stats AS (
                SELECT 
                    answer_value,
                    COUNT(*) as frequency,
                    COUNT(DISTINCT submission_id) as unique_submissions,
                    ROUND(COUNT(*)::NUMERIC / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 2) as percentage,
                    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as rank
                FROM terrain_form_answers
                WHERE question_id = $1 
                    AND answer_value IS NOT NULL 
                    AND answer_value != ''
                GROUP BY answer_value
            ),
            total_respondents AS (
                SELECT COUNT(DISTINCT submission_id) as total
                FROM terrain_form_answers
                WHERE question_id = $1
            )
            SELECT 
                as.*,
                tr.total as total_respondents,
                ROUND(as.frequency::NUMERIC / NULLIF(tr.total, 0) * 100, 2) as penetration_rate
            FROM answer_stats as
            CROSS JOIN total_respondents tr
            ORDER BY frequency DESC
        `, [questionId]);
        
        // Analyse des réponses multi
        const multiAnswers = await db.query(`
            WITH multi_stats AS (
                SELECT 
                    answer_selected,
                    COUNT(*) as frequency,
                    COUNT(DISTINCT submission_id) as unique_submissions,
                    ROUND(COUNT(*)::NUMERIC / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 2) as selection_rate,
                    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as rank
                FROM terrain_form_answers_multi
                WHERE question_id = $1
                GROUP BY answer_selected
            ),
            total_selections AS (
                SELECT COUNT(DISTINCT submission_id) as total
                FROM terrain_form_answers_multi
                WHERE question_id = $1
            )
            SELECT 
                ms.*,
                ts.total as total_respondents,
                ROUND(ms.frequency::NUMERIC / NULLIF(ts.total, 0) * 100, 2) as adoption_rate
            FROM multi_stats ms
            CROSS JOIN total_selections ts
            ORDER BY frequency DESC
        `, [questionId]);
        
        // Analyse des combinaisons de réponses (pour multi-choix)
        let combinations = [];
        if (multiAnswers.rows.length > 5) {
            combinations = await db.query(`
                WITH user_selections AS (
                    SELECT 
                        submission_id,
                        array_agg(answer_selected ORDER BY answer_selected) as selections
                    FROM terrain_form_answers_multi
                    WHERE question_id = $1
                    GROUP BY submission_id
                )
                SELECT 
                    selections,
                    COUNT(*) as frequency
                FROM user_selections
                WHERE array_length(selections, 1) > 1
                GROUP BY selections
                ORDER BY frequency DESC
                LIMIT 10
            `, [questionId]);
        }
        
        // Tendance temporelle pour cette question
        const timeTrend = await db.query(`
            SELECT 
                DATE_TRUNC('week', created_at) as week,
                answer_value,
                COUNT(*) as frequency
            FROM terrain_form_answers
            WHERE question_id = $1 AND answer_value IS NOT NULL
            GROUP BY DATE_TRUNC('week', created_at), answer_value
            ORDER BY week DESC
            LIMIT 20
        `, [questionId]);
        
        // Segmentation par rapport à une autre question
        let segmentation = null;
        if (compare_with) {
            segmentation = await db.query(`
                SELECT 
                    q1.answer_value as main_answer,
                    q2.answer_value as segment_answer,
                    COUNT(*) as count
                FROM terrain_form_answers q1
                JOIN terrain_form_answers q2 ON q1.submission_id = q2.submission_id
                WHERE q1.question_id = $1 
                    AND q2.question_id = $2
                    AND q1.answer_value IS NOT NULL
                    AND q2.answer_value IS NOT NULL
                GROUP BY q1.answer_value, q2.answer_value
                ORDER BY main_answer, count DESC
            `, [questionId, compare_with]);
        }
        
        res.json({
            success: true,
            data: {
                question_id: questionId,
                metadata: questionMeta.rows[0],
                simple_answers: simpleAnswers.rows,
                multi_answers: multiAnswers.rows,
                common_combinations: combinations.rows || [],
                temporal_trend: timeTrend.rows,
                segmentation: segmentation?.rows || null,
                summary: {
                    total_responses: simpleAnswers.rows.reduce((sum, r) => sum + parseInt(r.frequency), 0) + 
                                   multiAnswers.rows.reduce((sum, r) => sum + parseInt(r.frequency), 0),
                    top_answer: simpleAnswers.rows[0]?.answer_value || multiAnswers.rows[0]?.answer_selected || null,
                    top_answer_percentage: simpleAnswers.rows[0]?.percentage || multiAnswers.rows[0]?.selection_rate || 0,
                    diversity_index: calculateDiversityIndex(simpleAnswers.rows.concat(multiAnswers.rows))
                }
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse segmentée avancée
router.get('/market/segmentation', async (req, res) => {
    try {
        const { segment_by = 'q1', min_sample_size = 5 } = req.query;
        
        // 1. Segmentation par type de propriétaire (q1)
        const ownerSegments = await db.query(`
            SELECT 
                answer_value as owner_type,
                COUNT(DISTINCT submission_id) as count,
                ROUND(COUNT(DISTINCT submission_id)::NUMERIC / NULLIF((SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers WHERE question_id = 'q1'), 0) * 100, 2) as percentage
            FROM terrain_form_answers
            WHERE question_id = 'q1' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY count DESC
        `);
        
        // 2. Segmentation par expérience (q2)
        const experienceSegments = await db.query(`
            SELECT 
                answer_value as experience_level,
                COUNT(DISTINCT submission_id) as respondents,
                ROUND(COUNT(DISTINCT submission_id)::NUMERIC / NULLIF((SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers WHERE question_id = 'q2'), 0) * 100, 2) as percentage
            FROM terrain_form_answers
            WHERE question_id = 'q2' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY respondents DESC
        `);
        
        // 3. Profil croisé détaillé (heatmap)
        const crossProfile = await db.query(`
            SELECT 
                own.answer_value as owner_type,
                exp.answer_value as experience_level,
                COUNT(DISTINCT own.submission_id) as count,
                ROUND(COUNT(DISTINCT own.submission_id)::NUMERIC / NULLIF(SUM(COUNT(DISTINCT own.submission_id)) OVER (PARTITION BY own.answer_value), 0) * 100, 2) as within_segment_pct
            FROM terrain_form_answers own
            JOIN terrain_form_answers exp ON own.submission_id = exp.submission_id
            WHERE own.question_id = 'q1' AND exp.question_id = 'q2'
                AND own.answer_value IS NOT NULL AND exp.answer_value IS NOT NULL
            GROUP BY own.answer_value, exp.answer_value
            ORDER BY own.answer_value, count DESC
        `);
        
        // 4. Segmentation par problématiques principales
        const problemSegmentation = await db.query(`
            WITH user_problems AS (
                SELECT 
                    submission_id,
                    array_agg(answer_selected) as problems
                FROM terrain_form_answers_multi
                WHERE question_id = 'q18'
                GROUP BY submission_id
            ),
            user_profile AS (
                SELECT 
                    submission_id,
                    answer_value as owner_type
                FROM terrain_form_answers
                WHERE question_id = 'q1'
            )
            SELECT 
                up.owner_type,
                upro.problems,
                COUNT(*) as count
            FROM user_profile up
            JOIN user_problems upro ON up.submission_id = upro.submission_id
            GROUP BY up.owner_type, upro.problems
            ORDER BY up.owner_type, count DESC
            LIMIT 30
        `);
        
        // 5. Segmentation par budget d'investissement
        const budgetSegmentation = await db.query(`
            SELECT 
                invest.answer_value as investment_level,
                owner.answer_value as owner_type,
                COUNT(*) as count
            FROM terrain_form_answers invest
            JOIN terrain_form_answers owner ON invest.submission_id = owner.submission_id
            WHERE invest.question_id = 'q20' 
                AND owner.question_id = 'q1'
                AND invest.answer_value IS NOT NULL
                AND owner.answer_value IS NOT NULL
            GROUP BY invest.answer_value, owner.answer_value
            ORDER BY invest.answer_value, count DESC
        `);
        
        // 6. Segmentation géographique avancée
        const geographicSegments = await db.query(`
            SELECT 
                CASE 
                    WHEN LEFT(phone, 2) IN ('06', '07') THEN 'Mobile France'
                    WHEN LEFT(phone, 3) IN ('0032', '+32') THEN 'Belgique'
                    WHEN LEFT(phone, 3) IN ('0041', '+41') THEN 'Suisse'
                    WHEN LEFT(phone, 3) IN ('0033', '+33') THEN 'France'
                    ELSE 'Autre'
                END as region,
                COUNT(*) as count,
                COUNT(DISTINCT submission_id) as unique_respondents,
                ROUND(AVG(LENGTH(extra_comment))) as avg_comment_length
            FROM terrain_form_responses
            WHERE phone IS NOT NULL AND phone != ''
            GROUP BY region
            ORDER BY count DESC
        `);
        
        // 7. Analyse RFM-like (Récence, Fréquence, Montant)
        const rfmAnalysis = await db.query(`
            WITH user_activity AS (
                SELECT 
                    submission_id,
                    MAX(submitted_at) as last_activity,
                    COUNT(*) as engagement_score,
                    CASE 
                        WHEN COUNT(DISTINCT a.question_id) >= 20 THEN 'High'
                        WHEN COUNT(DISTINCT a.question_id) >= 10 THEN 'Medium'
                        ELSE 'Low'
                    END as completion_level
                FROM terrain_form_responses r
                LEFT JOIN terrain_form_answers a ON r.submission_id = a.submission_id
                GROUP BY r.submission_id
            )
            SELECT 
                CASE 
                    WHEN last_activity >= CURRENT_DATE - INTERVAL '7 days' THEN 'Active'
                    WHEN last_activity >= CURRENT_DATE - INTERVAL '30 days' THEN 'Warm'
                    ELSE 'Cold'
                END as recency_segment,
                completion_level,
                COUNT(*) as user_count
            FROM user_activity
            GROUP BY recency_segment, completion_level
            ORDER BY recency_segment, completion_level
        `);
        
        // 8. Personas types (clustering simple)
        const personas = await db.query(`
            WITH user_features AS (
                SELECT 
                    r.submission_id,
                    MAX(CASE WHEN a.question_id = 'q1' THEN a.answer_value END) as owner_type,
                    MAX(CASE WHEN a.question_id = 'q2' THEN a.answer_value END) as experience,
                    MAX(CASE WHEN a.question_id = 'q20' THEN a.answer_value END) as investment,
                    COUNT(CASE WHEN m.answer_selected IS NOT NULL THEN 1 END) as problems_count,
                    MAX(CASE WHEN m.answer_selected = 'Manque de visibilité' THEN 1 ELSE 0 END) as has_visibility_issue,
                    MAX(CASE WHEN m.answer_selected = 'Réservations manuelles' THEN 1 ELSE 0 END) as has_booking_issue
                FROM terrain_form_responses r
                LEFT JOIN terrain_form_answers a ON r.submission_id = a.submission_id
                LEFT JOIN terrain_form_answers_multi m ON r.submission_id = m.submission_id AND m.question_id = 'q18'
                GROUP BY r.submission_id
            )
            SELECT 
                CASE 
                    WHEN owner_type = 'Propriétaire unique' AND experience = 'Moins de 1 an' THEN 'Nouveau propriétaire'
                    WHEN owner_type = 'Société de gestion' AND investment = 'Plus de 50 000€' THEN 'Investisseur majeur'
                    WHEN has_visibility_issue = 1 AND has_booking_issue = 1 THEN 'Problèmes opérationnels'
                    WHEN owner_type = 'Propriétaire unique' AND problems_count >= 3 THEN 'Propriétaire en difficulté'
                    ELSE 'Profil standard'
                END as persona,
                COUNT(*) as count,
                ROUND(AVG(problems_count), 1) as avg_problems,
                MODE() WITHIN GROUP (ORDER BY investment) as typical_investment
            FROM user_features
            GROUP BY persona
            ORDER BY count DESC
        `);
        
        res.json({
            success: true,
            data: {
                segmentation_analysis: {
                    owner_segments: ownerSegments.rows,
                    experience_segments: experienceSegments.rows,
                    cross_profile_heatmap: crossProfile.rows,
                    problem_by_owner_segment: problemSegmentation.rows,
                    budget_by_owner_type: budgetSegmentation.rows,
                    geographic_distribution: geographicSegments.rows,
                    rfm_segmentation: rfmAnalysis.rows,
                    identified_personas: personas.rows
                },
                insights: generateSegmentationInsights(ownerSegments.rows, experienceSegments.rows, personas.rows)
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse des besoins et douleurs (ultra détaillée)
router.get('/market/needs-analysis', async (req, res) => {
    try {
        // 1. Principales difficultés avec scoring
        const mainDifficulties = await db.query(`
            WITH difficulty_stats AS (
                SELECT 
                    answer_selected as difficulty,
                    COUNT(DISTINCT submission_id) as affected_users,
                    COUNT(*) as total_mentions,
                    COUNT(DISTINCT submission_id)::NUMERIC / NULLIF((SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = 'q18'), 0) * 100 as impact_score,
                    ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT submission_id) DESC) as rank
                FROM terrain_form_answers_multi
                WHERE question_id = 'q18'
                GROUP BY answer_selected
            )
            SELECT 
                difficulty,
                affected_users,
                total_mentions,
                ROUND(impact_score, 2) as impact_percentage,
                rank,
                CASE 
                    WHEN rank <= 3 THEN 'Critical'
                    WHEN rank <= 6 THEN 'Major'
                    ELSE 'Minor'
                END as priority_level
            FROM difficulty_stats
            ORDER BY rank
        `);
        
        // 2. Analyse des combinaisons de difficultés
        const difficultyClusters = await db.query(`
            WITH user_difficulties AS (
                SELECT 
                    submission_id,
                    array_agg(answer_selected ORDER BY answer_selected) as difficulties,
                    COUNT(*) as difficulty_count
                FROM terrain_form_answers_multi
                WHERE question_id = 'q18'
                GROUP BY submission_id
                HAVING COUNT(*) > 1
            )
            SELECT 
                difficulties,
                difficulty_count,
                COUNT(*) as frequency
            FROM user_difficulties
            GROUP BY difficulties, difficulty_count
            ORDER BY frequency DESC
            LIMIT 15
        `);
        
        // 3. Fonctionnalités demandées avec analyse de priorité
        const requestedFeatures = await db.query(`
            WITH feature_stats AS (
                SELECT 
                    answer_selected as feature,
                    COUNT(DISTINCT submission_id) as requests,
                    COUNT(*) as total_selections,
                    ROUND(COUNT(DISTINCT submission_id)::NUMERIC / NULLIF((SELECT COUNT(DISTINCT submission_id) FROM terrain_form_answers_multi WHERE question_id = 'q22'), 0) * 100, 2) as demand_score,
                    ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT submission_id) DESC) as rank
                FROM terrain_form_answers_multi
                WHERE question_id = 'q22'
                GROUP BY answer_selected
            )
            SELECT 
                feature,
                requests,
                total_selections,
                demand_score,
                rank,
                CASE 
                    WHEN rank <= 2 THEN 'High Priority'
                    WHEN rank <= 5 THEN 'Medium Priority'
                    ELSE 'Nice to Have'
                END as development_priority
            FROM feature_stats
            ORDER BY rank
        `);
        
        // 4. Corrélation besoins vs fonctionnalités
        const needsVsFeatures = await db.query(`
            SELECT 
                d.answer_selected as difficulty,
                f.answer_selected as requested_feature,
                COUNT(DISTINCT d.submission_id) as users_count
            FROM terrain_form_answers_multi d
            JOIN terrain_form_answers_multi f ON d.submission_id = f.submission_id
            WHERE d.question_id = 'q18' 
                AND f.question_id = 'q22'
            GROUP BY d.answer_selected, f.answer_selected
            HAVING COUNT(DISTINCT d.submission_id) >= 3
            ORDER BY users_count DESC
            LIMIT 30
        `);
        
        // 5. Analyse d'investissement détaillée
        const investmentReadiness = await db.query(`
            SELECT 
                answer_value as investment_level,
                COUNT(*) as respondents,
                ROUND(COUNT(*)::NUMERIC / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 2) as percentage,
                ROUND(AVG(CASE WHEN extra_comment IS NOT NULL THEN LENGTH(extra_comment) ELSE 0 END), 0) as avg_comment_length
            FROM terrain_form_answers a
            LEFT JOIN terrain_form_responses r ON a.submission_id = r.submission_id
            WHERE question_id = 'q20' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY 
                CASE answer_value
                    WHEN 'Moins de 5 000€' THEN 1
                    WHEN '5 000€ - 15 000€' THEN 2
                    WHEN '15 000€ - 30 000€' THEN 3
                    WHEN '30 000€ - 50 000€' THEN 4
                    WHEN 'Plus de 50 000€' THEN 5
                END
        `);
        
        // 6. Calcul du NPS-like (recommandation via q23)
        const npsScore = await db.query(`
            SELECT 
                answer_value as recommendation_score,
                COUNT(*) as count,
                CASE 
                    WHEN answer_value IN ('9', '10') THEN 'Promoter'
                    WHEN answer_value IN ('7', '8') THEN 'Passive'
                    WHEN answer_value IN ('0', '1', '2', '3', '4', '5', '6') THEN 'Detractor'
                END as nps_category
            FROM terrain_form_answers
            WHERE question_id = 'q23' AND answer_value IS NOT NULL
            GROUP BY answer_value
        `);
        
        const npsCalculation = await db.query(`
            WITH nps_calc AS (
                SELECT 
                    CASE 
                        WHEN answer_value IN ('9', '10') THEN 'Promoter'
                        WHEN answer_value IN ('7', '8') THEN 'Passive'
                        ELSE 'Detractor'
                    END as category
                FROM terrain_form_answers
                WHERE question_id = 'q23' AND answer_value IS NOT NULL
            )
            SELECT 
                ROUND(100.0 * SUM(CASE WHEN category = 'Promoter' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) - 
                      100.0 * SUM(CASE WHEN category = 'Detractor' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) as nps_score,
                COUNT(*) as total_responses,
                SUM(CASE WHEN category = 'Promoter' THEN 1 ELSE 0 END) as promoters,
                SUM(CASE WHEN category = 'Passive' THEN 1 ELSE 0 END) as passives,
                SUM(CASE WHEN category = 'Detractor' THEN 1 ELSE 0 END) as detractors
            FROM nps_calc
        `);
        
        // 7. Urgence des besoins (timeline)
        const urgencyAnalysis = await db.query(`
            SELECT 
                timeline.answer_value as timeline,
                COUNT(DISTINCT timeline.submission_id) as users,
                COUNT(DISTINCT d.submission_id) as users_with_difficulties,
                ROUND(COUNT(DISTINCT d.submission_id)::NUMERIC / NULLIF(COUNT(DISTINCT timeline.submission_id), 0) * 100, 2) as difficulty_correlation
            FROM terrain_form_answers timeline
            LEFT JOIN terrain_form_answers_multi d ON timeline.submission_id = d.submission_id AND d.question_id = 'q18'
            WHERE timeline.question_id = 'q21' AND timeline.answer_value IS NOT NULL
            GROUP BY timeline.answer_value
            ORDER BY 
                CASE timeline.answer_value
                    WHEN 'Immédiatement (0-3 mois)' THEN 1
                    WHEN 'Court terme (3-6 mois)' THEN 2
                    WHEN 'Moyen terme (6-12 mois)' THEN 3
                    WHEN 'Long terme (+12 mois)' THEN 4
                END
        `);
        
        // 8. Market opportunity score
        const opportunityScore = await db.query(`
            WITH feature_demand AS (
                SELECT 
                    answer_selected as feature,
                    COUNT(DISTINCT submission_id) as demand
                FROM terrain_form_answers_multi
                WHERE question_id = 'q22'
                GROUP BY answer_selected
            ),
            problem_intensity AS (
                SELECT 
                    answer_selected as problem,
                    COUNT(DISTINCT submission_id) as intensity,
                    AVG(CASE WHEN a.answer_value IN ('Plus de 50 000€', '30 000€ - 50 000€') THEN 1 ELSE 0 END) as high_budget_ratio
                FROM terrain_form_answers_multi m
                LEFT JOIN terrain_form_answers a ON m.submission_id = a.submission_id AND a.question_id = 'q20'
                WHERE m.question_id = 'q18'
                GROUP BY answer_selected
            )
            SELECT 
                fd.feature,
                fd.demand,
                COALESCE(pi.intensity, 0) as related_problem_intensity,
                COALESCE(pi.high_budget_ratio, 0) as budget_ready_ratio,
                ROUND((fd.demand * 0.4 + COALESCE(pi.intensity, 0) * 0.4 + COALESCE(pi.high_budget_ratio, 0) * 100 * 0.2), 2) as opportunity_score
            FROM feature_demand fd
            LEFT JOIN problem_intensity pi ON 
                (fd.feature LIKE '%réservation%' AND pi.problem LIKE '%réservation%') OR
                (fd.feature LIKE '%visibilité%' AND pi.problem LIKE '%visibilité%') OR
                (fd.feature LIKE '%planning%' AND pi.problem LIKE '%planning%')
            ORDER BY opportunity_score DESC
        `);
        
        res.json({
            success: true,
            data: {
                needs_analysis: {
                    main_difficulties: mainDifficulties.rows,
                    difficulty_clusters: difficultyClusters.rows,
                    requested_features: requestedFeatures.rows,
                    needs_vs_features_correlation: needsVsFeatures.rows,
                    investment_readiness: investmentReadiness.rows
                },
                satisfaction_metrics: {
                    nps_score: npsCalculation.rows[0],
                    nps_distribution: npsScore.rows,
                    urgency_timeline: urgencyAnalysis.rows
                },
                market_opportunities: {
                    opportunity_scores: opportunityScore.rows,
                    top_opportunities: opportunityScore.rows.slice(0, 3)
                },
                executive_summary: generateNeedsSummary(
                    mainDifficulties.rows, 
                    requestedFeatures.rows, 
                    npsCalculation.rows[0],
                    opportunityScore.rows.slice(0, 3)
                )
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Dashboard exécutif avec KPIs avancés
router.get('/dashboard/executive', async (req, res) => {
    try {
        // KPIs globaux avec tendances
        const globalKPIs = await db.query(`
            WITH current_period AS (
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as leads,
                    COUNT(CASE WHEN extra_comment IS NOT NULL AND extra_comment != '' THEN 1 END) as comments
                FROM terrain_form_responses
                WHERE submitted_at >= CURRENT_DATE - INTERVAL '30 days'
            ),
            previous_period AS (
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as leads
                FROM terrain_form_responses
                WHERE submitted_at >= CURRENT_DATE - INTERVAL '60 days'
                    AND submitted_at < CURRENT_DATE - INTERVAL '30 days'
            )
            SELECT 
                cp.total as current_total,
                cp.leads as current_leads,
                cp.comments as current_comments,
                pp.total as previous_total,
                pp.leads as previous_leads,
                ROUND((cp.total - pp.total)::NUMERIC / NULLIF(pp.total, 0) * 100, 2) as total_growth,
                ROUND((cp.leads - pp.leads)::NUMERIC / NULLIF(pp.leads, 0) * 100, 2) as leads_growth
            FROM current_period cp
            CROSS JOIN previous_period pp
        `);
        
        // Taux de conversion par étape (funnel)
        const conversionFunnel = await db.query(`
            WITH funnel_steps AS (
                SELECT 
                    '1. Visite formulaire' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_responses
                UNION ALL
                SELECT 
                    '2. Section 1 complétée' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_answers
                WHERE section_id = 's1'
                UNION ALL
                SELECT 
                    '3. Section 2 complétée' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_answers
                WHERE section_id = 's2'
                UNION ALL
                SELECT 
                    '4. Section 3 complétée' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_answers
                WHERE section_id = 's3'
                UNION ALL
                SELECT 
                    '5. Section 4 complétée' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_answers
                WHERE section_id = 's4'
                UNION ALL
                SELECT 
                    '6. Section 5 complétée' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_answers
                WHERE section_id = 's5'
                UNION ALL
                SELECT 
                    '7. Section 6 complétée' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_answers
                WHERE section_id = 's6'
                UNION ALL
                SELECT 
                    '8. Commentaire laissé' as step,
                    COUNT(DISTINCT submission_id) as users
                FROM terrain_form_responses
                WHERE extra_comment IS NOT NULL AND extra_comment != ''
            )
            SELECT 
                step,
                users,
                LAG(users) OVER (ORDER BY step) as previous_step_users,
                ROUND(users::NUMERIC / NULLIF(LAG(users) OVER (ORDER BY step), 0) * 100, 2) as conversion_rate
            FROM funnel_steps
        `);
        
        // Insights texte générés
        const insights = await generateExecutiveInsights(globalKPIs.rows[0], conversionFunnel.rows);
        
        res.json({
            success: true,
            data: {
                period: "30 derniers jours",
                global_kpis: globalKPIs.rows[0],
                conversion_funnel: conversionFunnel.rows,
                insights: insights,
                generated_at: new Date().toISOString()
            }
        });
        
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// FONCTIONS UTILITAIRES D'ANALYSE
// ============================================

function calculateDiversityIndex(answers) {
    if (!answers || answers.length === 0) return 0;
    
    const total = answers.reduce((sum, a) => sum + parseInt(a.frequency || a.count || 0), 0);
    if (total === 0) return 0;
    
    // Shannon Diversity Index
    let diversity = 0;
    answers.forEach(answer => {
        const proportion = (answer.frequency || answer.count || 0) / total;
        if (proportion > 0) {
            diversity -= proportion * Math.log(proportion);
        }
    });
    
    return Math.round(diversity * 100) / 100;
}

function generateSegmentationInsights(ownerSegments, experienceSegments, personas) {
    const insights = [];
    
    if (ownerSegments && ownerSegments[0]) {
        insights.push(`Le segment majoritaire est "${ownerSegments[0].owner_type}" avec ${ownerSegments[0].count} utilisateurs (${ownerSegments[0].percentage}%)`);
    }
    
    if (experienceSegments && experienceSegments[0]) {
        insights.push(`La majorité des répondants ont "${experienceSegments[0].experience_level}" d'expérience (${experienceSegments[0].percentage}%)`);
    }
    
    if (personas && personas[0]) {
        insights.push(`Le persona principal identifié est "${personas[0].persona}" représentant ${personas[0].count} utilisateurs`);
    }
    
    return insights;
}

function generateNeedsSummary(difficulties, features, nps, topOpportunities) {
    return {
        top_problem: difficulties[0]?.difficulty || "Non identifié",
        top_feature: features[0]?.feature || "Non identifiée",
        nps_rating: nps?.nps_score || 0,
        nps_interpretation: getNPSInterpretation(nps?.nps_score || 0),
        top_opportunity: topOpportunities[0]?.feature || "Non identifiée",
        urgency_level: getUrgencyLevel(difficulties)
    };
}

function getNPSInterpretation(score) {
    if (score >= 50) return "Excellent - Forte fidélité";
    if (score >= 30) return "Très bien - Bonne satisfaction";
    if (score >= 10) return "Correct - Améliorations possibles";
    if (score >= 0) return "Moyen - Nécessite des améliorations";
    return "Critique - Urgence d'action";
}

function getUrgencyLevel(difficulties) {
    if (!difficulties || difficulties.length === 0) return "Inconnu";
    const criticalCount = difficulties.filter(d => d.priority_level === 'Critical').length;
    if (criticalCount >= 3) return "Très élevée";
    if (criticalCount >= 1) return "Élevée";
    return "Modérée";
}

async function generateExecutiveInsights(kpis, funnel) {
    const insights = [];
    
    if (kpis.total_growth > 20) {
        insights.push(`📈 Croissance exceptionnelle: +${kpis.total_growth}% de soumissions sur 30 jours`);
    } else if (kpis.total_growth > 0) {
        insights.push(`📊 Croissance positive: +${kpis.total_growth}% de soumissions`);
    } else if (kpis.total_growth < 0) {
        insights.push(`⚠️ Baisse d'activité: ${kpis.total_growth}% de soumissions`);
    }
    
    if (funnel && funnel.length > 0) {
        const finalConversion = funnel[funnel.length - 1]?.conversion_rate;
        if (finalConversion < 30) {
            insights.push(`🎯 Opportunité d'optimisation: faible taux de completion final (${finalConversion}%)`);
        }
        
        const biggestDrop = findBiggestDrop(funnel);
        if (biggestDrop) {
            insights.push(`🔍 Point de friction majeur: ${biggestDrop.step} (chute de ${biggestDrop.drop}%)`);
        }
    }
    
    return insights;
}

function findBiggestDrop(funnel) {
    if (!funnel || funnel.length < 2) return null;
    
    let maxDrop = 0;
    let dropStep = null;
    
    for (let i = 1; i < funnel.length; i++) {
        const drop = 100 - (funnel[i].conversion_rate || 0);
        if (drop > maxDrop) {
            maxDrop = drop;
            dropStep = {
                step: funnel[i].step,
                drop: Math.round(drop)
            };
        }
    }
    
    return dropStep;
}

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

export default router;