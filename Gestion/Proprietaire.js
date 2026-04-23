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
                MIN(submitted_at) as first_submission,
                MAX(submitted_at) as last_submission
            FROM terrain_form_responses
            WHERE 1=1 ${dateFilter}
        `);
        
        // Distribution par section
        const sectionDistribution = await db.query(`
            SELECT 
                'Section ' || section_id as section,
                COUNT(*) as total_responses,
                COUNT(DISTINCT submission_id) as unique_submissions
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
                COUNT(*) as count
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
                COUNT(*) as frequency
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
                submissions_trend: submissionsTrend.rows
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
                COUNT(*) as frequency
            FROM terrain_form_answers_multi
            WHERE question_id = $1
            GROUP BY answer_selected
            ORDER BY frequency DESC
        `, [questionId]);
        
        res.json({
            success: true,
            data: {
                question_id: questionId,
                simple_answers: simpleAnswers.rows,
                multi_answers: multiAnswers.rows,
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
        // Segmentation par type de propriétaire (question q1)
        const ownerSegments = await db.query(`
            SELECT 
                answer_value as owner_type,
                COUNT(DISTINCT submission_id) as count
            FROM terrain_form_answers
            WHERE question_id = 'q1' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY count DESC
        `);
        
        // Segmentation par expérience (question q2)
        const experienceSegments = await db.query(`
            SELECT 
                answer_value as experience_level,
                COUNT(DISTINCT submission_id) as respondents
            FROM terrain_form_answers
            WHERE question_id = 'q2' AND answer_value IS NOT NULL
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
                COUNT(*) as count
            FROM terrain_form_responses
            WHERE phone IS NOT NULL AND phone != '' AND phone ~ '^[0-9]{2}'
            GROUP BY LEFT(phone, 2)
            ORDER BY count DESC
        `);
        
        res.json({
            success: true,
            data: {
                owner_segments: ownerSegments.rows,
                experience_segments: experienceSegments.rows,
                cross_profile: crossProfile.rows,
                geographic_segments: geographicSegments.rows
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
        // Principales difficultés rencontrées (q18)
        const mainDifficulties = await db.query(`
            SELECT 
                answer_selected as difficulty,
                COUNT(DISTINCT submission_id) as affected_users
            FROM terrain_form_answers_multi
            WHERE question_id = 'q18'
            GROUP BY answer_selected
            ORDER BY affected_users DESC
        `);
        
        // Fonctionnalités les plus demandées (q22)
        const requestedFeatures = await db.query(`
            SELECT 
                answer_selected as feature,
                COUNT(DISTINCT submission_id) as requests
            FROM terrain_form_answers_multi
            WHERE question_id = 'q22'
            GROUP BY answer_selected
            ORDER BY requests DESC
        `);
        
        // Niveau d'investissement (q20)
        const investmentReadiness = await db.query(`
            SELECT 
                answer_value as investment_level,
                COUNT(*) as respondents
            FROM terrain_form_answers
            WHERE question_id = 'q20' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY respondents DESC
        `);
        
        res.json({
            success: true,
            data: {
                main_difficulties: mainDifficulties.rows,
                requested_features: requestedFeatures.rows,
                investment_readiness: investmentReadiness.rows
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

// Exporter les données
router.get('/export/all', async (req, res) => {
    try {
        const submissions = await db.query(`
            SELECT 
                r.submission_id,
                r.phone,
                r.extra_comment,
                r.submitted_at,
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

// Dashboard résumé
router.get('/dashboard/summary', async (req, res) => {
    try {
        // KPIs principaux
        const keyMetrics = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM terrain_form_responses) as total_submissions,
                (SELECT COUNT(*) FROM terrain_form_responses WHERE phone IS NOT NULL AND phone != '') as leads_generated,
                (SELECT COUNT(*) FROM terrain_form_admin WHERE status = 'contacted') as contacted_leads,
                (SELECT COUNT(*) FROM terrain_form_admin WHERE status = 'completed') as converted_leads
        `);
        
        // Top insights rapides
        const topInsights = await db.query(`
            SELECT 
                'Principale difficulté' as insight_type,
                answer_selected as value,
                COUNT(*) as mentions
            FROM terrain_form_answers_multi
            WHERE question_id = 'q18'
            GROUP BY answer_selected
            ORDER BY mentions DESC
            LIMIT 1
            UNION ALL
            SELECT 
                'Fonctionnalité la plus demandée' as insight_type,
                answer_selected as value,
                COUNT(*) as mentions
            FROM terrain_form_answers_multi
            WHERE question_id = 'q22'
            GROUP BY answer_selected
            ORDER BY mentions DESC
            LIMIT 1
            UNION ALL
            SELECT 
                'Problème prioritaire' as insight_type,
                answer_value as value,
                COUNT(*) as mentions
            FROM terrain_form_answers
            WHERE question_id = 'q20' AND answer_value IS NOT NULL
            GROUP BY answer_value
            ORDER BY mentions DESC
            LIMIT 1
        `);
        
        // Tendance des 30 derniers jours
        const recentTrend = await db.query(`
            SELECT 
                DATE_TRUNC('week', submitted_at) as week,
                COUNT(*) as submissions
            FROM terrain_form_responses
            WHERE submitted_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE_TRUNC('week', submitted_at)
            ORDER BY week DESC
        `);
        
        res.json({
            success: true,
            data: {
                key_metrics: keyMetrics.rows[0],
                top_insights: topInsights.rows,
                recent_trend: recentTrend.rows
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

export default router;