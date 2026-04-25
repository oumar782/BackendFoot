import express from 'express';
const router = express.Router();
import db from '../db.js';

// ============================================
// 1. GESTION DES SOUMISSIONS DU FORMULAIRE
// ============================================

// Soumettre une nouvelle réponse au formulaire
router.post('/submissions', async (req, res) => {
    try {
        const {
            // Section 1: Habitudes de jeu
            quartier,
            frequence,
            avec_qui, // Array
            
            // Section 2: Recherche de terrain
            trouver_terrain, // Array
            facilite_terrain,
            abandon,
            
            // Section 3: Réservation
            moyen_reservation, // Array
            temps_reservation,
            problemes_reservation, // Array
            appels_multiples,
            
            // Section 4: Organisation des matchs
            organisateur,
            reunion_joueurs,
            temps_organisation,
            annulation_match,
            annulations_joueurs,
            remplacant,
            whatsapp_orga,
            desaccord,
            coordination,
            
            // Section 5: Expérience sur place
            horaires_respectes,
            annulation_terrain,
            orga_sur_place,
            
            // Section 6: Frustrations
            frustrations, // Array
            pire_experience,
            plus_complique,
            freins, // Array
            
            // Section 7: Habitudes
            quartiers_difficiles,
            terrains_pleins, // Array
            fidelite_terrain,
            
            // Section 8: Contact
            telephone,
            commentaire
        } = req.body;
        
        // Insertion dans la table principale
        const result = await db.query(
            `INSERT INTO survey_responses (
                quartier, frequence, avec_qui, trouver_terrain, facilite_terrain,
                abandon, moyen_reservation, temps_reservation, problemes_reservation,
                appels_multiples, organisateur, reunion_joueurs, temps_organisation,
                annulation_match, annulations_joueurs, remplacant, whatsapp_orga,
                desaccord, coordination, horaires_respectes, annulation_terrain,
                orga_sur_place, frustrations, pire_experience, plus_complique,
                freins, quartiers_difficiles, terrains_pleins, fidelite_terrain,
                telephone, commentaire
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
                $25, $26, $27, $28, $29, $30, $31
            ) RETURNING id`,
            [
                quartier || null,
                frequence || null,
                avec_qui || null,
                trouver_terrain || null,
                facilite_terrain || null,
                abandon || null,
                moyen_reservation || null,
                temps_reservation || null,
                problemes_reservation || null,
                appels_multiples || null,
                organisateur || null,
                reunion_joueurs || null,
                temps_organisation || null,
                annulation_match || null,
                annulations_joueurs || null,
                remplacant || null,
                whatsapp_orga || null,
                desaccord || null,
                coordination || null,
                horaires_respectes || null,
                annulation_terrain || null,
                orga_sur_place || null,
                frustrations || null,
                pire_experience || null,
                plus_complique || null,
                freins || null,
                quartiers_difficiles || null,
                terrains_pleins || null,
                fidelite_terrain || null,
                telephone || null,
                commentaire || null
            ]
        );
        
        res.status(201).json({
            success: true,
            message: 'Formulaire soumis avec succès',
            submission_id: result.rows[0].id
        });
    } catch (err) {
        console.error('Erreur soumission:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Récupérer toutes les soumissions
router.get('/submissions', async (req, res) => {
    try {
        const { date_start, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;
        
        let query = `
            SELECT 
                id,
                created_at,
                quartier,
                frequence,
                avec_qui,
                trouver_terrain,
                facilite_terrain,
                abandon,
                moyen_reservation,
                temps_reservation,
                problemes_reservation,
                appels_multiples,
                organisateur,
                reunion_joueurs,
                temps_organisation,
                annulation_match,
                annulations_joueurs,
                remplacant,
                whatsapp_orga,
                desaccord,
                coordination,
                horaires_respectes,
                annulation_terrain,
                orga_sur_place,
                frustrations,
                pire_experience,
                plus_complique,
                freins,
                quartiers_difficiles,
                terrains_pleins,
                fidelite_terrain,
                telephone,
                commentaire
            FROM survey_responses
            WHERE 1=1
        `;
        
        const params = [];
        let paramIndex = 1;
        
        if (date_start) {
            query += ` AND created_at >= $${paramIndex}`;
            params.push(date_start);
            paramIndex++;
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        
        // Récupérer le nombre total
        const countResult = await db.query('SELECT COUNT(*) FROM survey_responses');
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].count)
            }
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
        
        const result = await db.query(
            `SELECT * FROM survey_responses WHERE id = $1`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Soumission non trouvée' });
        }
        
        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Supprimer une soumission
router.delete('/submissions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query(
            'DELETE FROM survey_responses WHERE id = $1 RETURNING id',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Soumission non trouvée' });
        }
        
        res.json({
            success: true,
            message: 'Soumission supprimée avec succès'
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// 2. STATISTIQUES ET ANALYSES
// ============================================

// Statistiques globales
router.get('/stats', async (req, res) => {
    try {
        // Nombre total de soumissions
        const totalResult = await db.query('SELECT COUNT(*) as total FROM survey_responses');
        
        // Nombre de soumissions avec téléphone
        const phoneResult = await db.query(
            "SELECT COUNT(*) as with_phone FROM survey_responses WHERE telephone IS NOT NULL AND telephone != ''"
        );
        
        // Nombre de soumissions avec commentaire
        const commentResult = await db.query(
            "SELECT COUNT(*) as with_comment FROM survey_responses WHERE commentaire IS NOT NULL AND commentaire != ''"
        );
        
        // Fréquences de jeu
        const frequenceResult = await db.query(`
            SELECT frequence, COUNT(*) as count 
            FROM survey_responses 
            WHERE frequence IS NOT NULL 
            GROUP BY frequence 
            ORDER BY count DESC
        `);
        
        // Facilité à trouver un terrain
        const faciliteResult = await db.query(`
            SELECT facilite_terrain, COUNT(*) as count 
            FROM survey_responses 
            WHERE facilite_terrain IS NOT NULL 
            GROUP BY facilite_terrain 
            ORDER BY count DESC
        `);
        
        // Principales frustrations
        const frustrationsResult = await db.query(`
            SELECT unnest(frustrations) as frustration, COUNT(*) as count
            FROM survey_responses
            WHERE frustrations IS NOT NULL
            GROUP BY unnest(frustrations)
            ORDER BY count DESC
            LIMIT 5
        `);
        
        res.json({
            success: true,
            data: {
                total: parseInt(totalResult.rows[0].total),
                with_phone: parseInt(phoneResult.rows[0].with_phone),
                with_comment: parseInt(commentResult.rows[0].with_comment),
                frequences: frequenceResult.rows,
                facilite_terrain: faciliteResult.rows,
                top_frustrations: frustrationsResult.rows
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Analyse par question
router.get('/stats/question/:question', async (req, res) => {
    try {
        const { question } = req.params;
        const validQuestions = [
            'frequence', 'facilite_terrain', 'abandon', 'temps_reservation',
            'appels_multiples', 'organisateur', 'reunion_joueurs', 'temps_organisation',
            'annulation_match', 'annulations_joueurs', 'remplacant', 'whatsapp_orga',
            'desaccord', 'coordination', 'horaires_respectes', 'annulation_terrain',
            'orga_sur_place', 'pire_experience', 'plus_complique', 'quartiers_difficiles',
            'fidelite_terrain'
        ];
        
        if (!validQuestions.includes(question)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Question non valide pour cette analyse' 
            });
        }
        
        const result = await db.query(
            `SELECT ${question} as reponse, COUNT(*) as count 
             FROM survey_responses 
             WHERE ${question} IS NOT NULL 
             GROUP BY ${question} 
             ORDER BY count DESC`,
            []
        );
        
        const totalResult = await db.query(
            `SELECT COUNT(*) as total FROM survey_responses WHERE ${question} IS NOT NULL`
        );
        
        const stats = result.rows.map(row => ({
            reponse: row.reponse,
            count: parseInt(row.count),
            percentage: parseFloat((row.count / totalResult.rows[0].total * 100).toFixed(2))
        }));
        
        res.json({
            success: true,
            data: stats,
            total_responses: parseInt(totalResult.rows[0].total)
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Export Excel (CSV)
router.get('/export/csv', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                id,
                created_at,
                quartier,
                frequence,
                array_to_string(avec_qui, ', ') as avec_qui,
                array_to_string(trouver_terrain, ', ') as trouver_terrain,
                facilite_terrain,
                abandon,
                array_to_string(moyen_reservation, ', ') as moyen_reservation,
                temps_reservation,
                array_to_string(problemes_reservation, ', ') as problemes_reservation,
                appels_multiples,
                organisateur,
                reunion_joueurs,
                temps_organisation,
                annulation_match,
                annulations_joueurs,
                remplacant,
                whatsapp_orga,
                desaccord,
                coordination,
                horaires_respectes,
                annulation_terrain,
                orga_sur_place,
                array_to_string(frustrations, ', ') as frustrations,
                pire_experience,
                plus_complique,
                array_to_string(freins, ', ') as freins,
                quartiers_difficiles,
                array_to_string(terrains_pleins, ', ') as terrains_pleins,
                fidelite_terrain,
                telephone,
                commentaire
            FROM survey_responses
            ORDER BY created_at DESC
        `);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Aucune donnée à exporter' });
        }
        
        // Créer le CSV
        const headers = Object.keys(result.rows[0]);
        const csvRows = [];
        csvRows.push(headers.join(','));
        
        for (const row of result.rows) {
            const values = headers.map(header => {
                let value = row[header];
                if (value === null || value === undefined) value = '';
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    value = `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            });
            csvRows.push(values.join(','));
        }
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=survey_responses_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csvRows.join('\n'));
        
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;