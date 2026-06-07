import express from 'express';
const router = express.Router();
import db from '../../db.js';

// ============================================
// CRUD COMPLET POUR LA TABLE BILLETS
// ============================================

// 📌 CREATE - Créer un nouveau billet
router.post('/billets', async (req, res) => {
    try {
        const {
            nom_supporter,
            prenom_supporter,
            email,
            equipe_1,
            equipe_2,
            phase_match,
            edition,
            stade,
            ville,
            date_match,
            heure_match,
            type_billet,
            porte,
            tribune,
            rang,
            siege,
            qr_code,
            statut_billet = 'actif',
            latitude_porte,
            longitude_porte
        } = req.body;

        // Vérification des champs obligatoires
        if (!nom_supporter || !prenom_supporter || !email || !equipe_1 || !equipe_2 || !date_match) {
            return res.status(400).json({
                success: false,
                message: 'Les champs obligatoires sont: nom_supporter, prenom_supporter, email, equipe_1, equipe_2, date_match'
            });
        }

        const result = await db.query(
            `INSERT INTO billets (
                nom_supporter, prenom_supporter, email, equipe_1, equipe_2,
                phase_match, edition, stade, ville, date_match, heure_match,
                type_billet, porte, tribune, rang, siege, qr_code, statut_billet,
                latitude_porte, longitude_porte
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *`,
            [
                nom_supporter, prenom_supporter, email, equipe_1, equipe_2,
                phase_match, edition, stade, ville, date_match, heure_match,
                type_billet, porte, tribune, rang, siege, qr_code, statut_billet,
                latitude_porte, longitude_porte
            ]
        );

        res.status(201).json({
            success: true,
            message: 'Billet créé avec succès',
            billet: result.rows[0]
        });

    } catch (error) {
        console.error('Erreur creation billet:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la création du billet',
            error: error.message
        });
    }
});

// 📖 READ - Récupérer tous les billets (avec pagination)
router.get('/billets', async (req, res) => {
    try {
        const { page = 1, limit = 50, statut, email, equipe } = req.query;
        const offset = (page - 1) * limit;
        
        let query = `SELECT * FROM billets`;
        let countQuery = `SELECT COUNT(*) FROM billets`;
        let params = [];
        let conditions = [];
        
        // Filtres optionnels
        if (statut) {
            conditions.push(`statut_billet = $${params.length + 1}`);
            params.push(statut);
        }
        if (email) {
            conditions.push(`email = $${params.length + 1}`);
            params.push(email);
        }
        if (equipe) {
            conditions.push(`(equipe_1 = $${params.length + 1} OR equipe_2 = $${params.length + 1})`);
            params.push(equipe);
        }
        
        if (conditions.length > 0) {
            const whereClause = ` WHERE ` + conditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }
        
        // Récupérer le total
        const totalResult = await db.query(countQuery, params);
        const total = parseInt(totalResult.rows[0].count);
        
        // Ajouter pagination
        query += ` ORDER BY date_creation DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);
        
        const result = await db.query(query, params);
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Erreur lecture billets:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des billets',
            error: error.message
        });
    }
});

// 📖 READ - Récupérer un billet par son ID
router.get('/billets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query(
            'SELECT * FROM billets WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Billet non trouvé'
            });
        }
        
        res.json({
            success: true,
            billet: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur lecture billet:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération du billet',
            error: error.message
        });
    }
});

// 📖 READ - Récupérer un billet par son QR code
router.get('/billets/qrcode/:qr_code', async (req, res) => {
    try {
        const { qr_code } = req.params;
        
        const result = await db.query(
            'SELECT * FROM billets WHERE qr_code = $1',
            [qr_code]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Billet non trouvé avec ce QR code'
            });
        }
        
        res.json({
            success: true,
            billet: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur lecture billet par QR:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération du billet',
            error: error.message
        });
    }
});

// ✏️ UPDATE - Mettre à jour un billet
router.put('/billets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nom_supporter,
            prenom_supporter,
            email,
            equipe_1,
            equipe_2,
            phase_match,
            edition,
            stade,
            ville,
            date_match,
            heure_match,
            type_billet,
            porte,
            tribune,
            rang,
            siege,
            qr_code,
            statut_billet,
            latitude_porte,
            longitude_porte
        } = req.body;
        
        // Vérifier si le billet existe
        const checkResult = await db.query(
            'SELECT * FROM billets WHERE id = $1',
            [id]
        );
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Billet non trouvé'
            });
        }
        
        const result = await db.query(
            `UPDATE billets SET
                nom_supporter = COALESCE($1, nom_supporter),
                prenom_supporter = COALESCE($2, prenom_supporter),
                email = COALESCE($3, email),
                equipe_1 = COALESCE($4, equipe_1),
                equipe_2 = COALESCE($5, equipe_2),
                phase_match = COALESCE($6, phase_match),
                edition = COALESCE($7, edition),
                stade = COALESCE($8, stade),
                ville = COALESCE($9, ville),
                date_match = COALESCE($10, date_match),
                heure_match = COALESCE($11, heure_match),
                type_billet = COALESCE($12, type_billet),
                porte = COALESCE($13, porte),
                tribune = COALESCE($14, tribune),
                rang = COALESCE($15, rang),
                siege = COALESCE($16, siege),
                qr_code = COALESCE($17, qr_code),
                statut_billet = COALESCE($18, statut_billet),
                latitude_porte = COALESCE($19, latitude_porte),
                longitude_porte = COALESCE($20, longitude_porte)
            WHERE id = $21
            RETURNING *`,
            [
                nom_supporter, prenom_supporter, email, equipe_1, equipe_2,
                phase_match, edition, stade, ville, date_match, heure_match,
                type_billet, porte, tribune, rang, siege, qr_code, statut_billet,
                latitude_porte, longitude_porte, id
            ]
        );
        
        res.json({
            success: true,
            message: 'Billet mis à jour avec succès',
            billet: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur mise à jour billet:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la mise à jour du billet',
            error: error.message
        });
    }
});

// ✏️ UPDATE - Changer le statut d'un billet
router.patch('/billets/:id/statut', async (req, res) => {
    try {
        const { id } = req.params;
        const { statut_billet } = req.body;
        
        if (!statut_billet) {
            return res.status(400).json({
                success: false,
                message: 'Le statut est requis'
            });
        }
        
        const result = await db.query(
            'UPDATE billets SET statut_billet = $1 WHERE id = $2 RETURNING *',
            [statut_billet, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Billet non trouvé'
            });
        }
        
        res.json({
            success: true,
            message: 'Statut mis à jour avec succès',
            billet: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur mise à jour statut:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la mise à jour du statut',
            error: error.message
        });
    }
});

// ✏️ UPDATE - Marquer un billet comme utilisé
router.patch('/billets/:id/utiliser', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query(
            `UPDATE billets 
             SET statut_billet = 'utilise' 
             WHERE id = $1 AND statut_billet = 'actif'
             RETURNING *`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Billet non trouvé ou déjà utilisé/annulé'
            });
        }
        
        res.json({
            success: true,
            message: 'Billet marqué comme utilisé',
            billet: result.rows[0]
        });
        
    } catch (error) {
        console.error('Erreur utilisation billet:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'utilisation du billet',
            error: error.message
        });
    }
});

// ❌ DELETE - Supprimer un billet (soft delete ou hard delete)
router.delete('/billets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { hard_delete } = req.query;
        
        // Vérifier si le billet existe
        const checkResult = await db.query(
            'SELECT * FROM billets WHERE id = $1',
            [id]
        );
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Billet non trouvé'
            });
        }
        
        if (hard_delete === 'true') {
            // Suppression définitive
            await db.query('DELETE FROM billets WHERE id = $1', [id]);
            res.json({
                success: true,
                message: 'Billet supprimé définitivement'
            });
        } else {
            // Soft delete - changer statut en annulé
            await db.query(
                'UPDATE billets SET statut_billet = $1 WHERE id = $2',
                ['annule', id]
            );
            res.json({
                success: true,
                message: 'Billet annulé (soft delete)'
            });
        }
        
    } catch (error) {
        console.error('Erreur suppression billet:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la suppression du billet',
            error: error.message
        });
    }
});

// 📊 READ - Récupérer les billets d'un supporter
router.get('/supporters/:email/billets', async (req, res) => {
    try {
        const { email } = req.params;
        
        const result = await db.query(
            `SELECT * FROM billets 
             WHERE email = $1 
             ORDER BY date_match DESC`,
            [email]
        );
        
        res.json({
            success: true,
            supporter: {
                email: email,
                nom: result.rows[0]?.nom_supporter,
                prenom: result.rows[0]?.prenom_supporter
            },
            billets: result.rows,
            total: result.rows.length
        });
        
    } catch (error) {
        console.error('Erreur lecture billets supporter:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des billets',
            error: error.message
        });
    }
});

// 📊 READ - Récupérer les billets par match
router.get('/matchs/:equipe1/:equipe2/billets', async (req, res) => {
    try {
        const { equipe1, equipe2 } = req.params;
        
        const result = await db.query(
            `SELECT * FROM billets 
             WHERE equipe_1 = $1 AND equipe_2 = $2
             ORDER BY date_match DESC`,
            [equipe1, equipe2]
        );
        
        res.json({
            success: true,
            match: `${equipe1} vs ${equipe2}`,
            billets: result.rows,
            total: result.rows.length,
            stats: {
                actifs: result.rows.filter(b => b.statut_billet === 'actif').length,
                utilises: result.rows.filter(b => b.statut_billet === 'utilise').length,
                annules: result.rows.filter(b => b.statut_billet === 'annule').length
            }
        });
        
    } catch (error) {
        console.error('Erreur lecture billets match:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des billets',
            error: error.message
        });
    }
});

export default router;