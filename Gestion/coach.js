// routes/coaches.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// 📋 GET - Récupérer tous les coaches avec filtres
router.get("/", async (req, res) => {
    try {
        const { discipline, city, status, search, limit = 50, offset = 0 } = req.query;
        
        let sql = `
            SELECT 
                c.id,
                c.name,
                c.discipline,
                c.city,
                c.experience,
                c.rating,
                c.price,
                c.availability,
                c.languages,
                c.certifications,
                c.specialties,
                c.bio,
                c.skills,
                c.colors,
                c.dna,
                c.status,
                c.created_at,
                c.updated_at,
                COALESCE(
                    (SELECT AVG(rating)::DECIMAL(3,2) FROM coach_reviews WHERE coach_id = c.id),
                    c.rating
                ) as average_rating,
                COALESCE(
                    (SELECT COUNT(*) FROM coach_reviews WHERE coach_id = c.id),
                    0
                ) as review_count
            FROM coaches c
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 0;

        if (discipline) {
            paramCount++;
            sql += ` AND c.discipline = $${paramCount}`;
            params.push(discipline.toLowerCase());
        }

        if (city) {
            paramCount++;
            sql += ` AND c.city ILIKE $${paramCount}`;
            params.push(`%${city}%`);
        }

        if (status) {
            paramCount++;
            sql += ` AND c.status = $${paramCount}`;
            params.push(status);
        } else {
            sql += ` AND c.status = 'active'`;
        }

        if (search) {
            paramCount++;
            sql += ` AND (c.name ILIKE $${paramCount} OR c.bio ILIKE $${paramCount} OR c.discipline ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY c.rating DESC, c.name ASC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(sql, params);

        // Récupérer les carrières pour chaque coach
        const coachesWithCareers = await Promise.all(result.rows.map(async (coach) => {
            const careerResult = await pool.query(
                `SELECT id, year, role, club FROM coach_careers WHERE coach_id = $1 ORDER BY year ASC`,
                [coach.id]
            );
            
            return {
                ...coach,
                career: careerResult.rows || [],
                rating: parseFloat(coach.average_rating || coach.rating || 4.5),
                reviewCount: parseInt(coach.review_count) || 0
            };
        }));

        // Compter le total
        let countSql = `SELECT COUNT(*) as total FROM coaches c WHERE 1=1`;
        const countParams = [];
        let countParamCount = 0;

        if (discipline) {
            countParamCount++;
            countSql += ` AND c.discipline = $${countParamCount}`;
            countParams.push(discipline.toLowerCase());
        }

        if (city) {
            countParamCount++;
            countSql += ` AND c.city ILIKE $${countParamCount}`;
            countParams.push(`%${city}%`);
        }

        if (status) {
            countParamCount++;
            countSql += ` AND c.status = $${countParamCount}`;
            countParams.push(status);
        } else {
            countSql += ` AND c.status = 'active'`;
        }

        if (search) {
            countParamCount++;
            countSql += ` AND (c.name ILIKE $${countParamCount} OR c.bio ILIKE $${countParamCount} OR c.discipline ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }

        const countResult = await pool.query(countSql, countParams);

        res.json({
            success: true,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset),
            count: coachesWithCareers.length,
            data: coachesWithCareers
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des coaches:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des coaches",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer un coach spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `
            SELECT 
                c.id,
                c.name,
                c.discipline,
                c.city,
                c.experience,
                c.rating,
                c.price,
                c.availability,
                c.languages,
                c.certifications,
                c.specialties,
                c.bio,
                c.skills,
                c.colors,
                c.dna,
                c.status,
                c.created_at,
                c.updated_at,
                COALESCE(
                    (SELECT AVG(rating)::DECIMAL(3,2) FROM coach_reviews WHERE coach_id = c.id),
                    c.rating
                ) as average_rating,
                COALESCE(
                    (SELECT COUNT(*) FROM coach_reviews WHERE coach_id = c.id),
                    0
                ) as review_count
            FROM coaches c
            WHERE c.id = $1
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Coach non trouvé"
            });
        }

        const coach = result.rows[0];

        // Récupérer les carrières
        const careerResult = await pool.query(
            `SELECT id, year, role, club FROM coach_careers WHERE coach_id = $1 ORDER BY year ASC`,
            [coach.id]
        );

        // Récupérer les avis
        const reviewsResult = await pool.query(
            `SELECT id, player_name, player_email, rating, comment, session_id, created_at 
             FROM coach_reviews 
             WHERE coach_id = $1 
             ORDER BY created_at DESC 
             LIMIT 10`,
            [coach.id]
        );

        const formattedData = {
            ...coach,
            rating: parseFloat(coach.average_rating || coach.rating || 4.5),
            reviewCount: parseInt(coach.review_count) || 0,
            career: careerResult.rows || [],
            reviews: reviewsResult.rows || []
        };

        res.json({
            success: true,
            data: formattedData
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération du coach:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération du coach",
            error: err.message
        });
    }
});

// ➕ POST - Créer un nouveau coach
router.post("/", async (req, res) => {
    const {
        name,
        discipline,
        city,
        experience,
        price,
        availability,
        languages,
        certifications,
        specialties,
        bio,
        skills,
        colors,
        dna,
        career
    } = req.body;

    // Validation des champs requis
    if (!name || !discipline || !city || !price) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: name, discipline, city, price"
        });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Créer le coach
        const result = await client.query(
            `INSERT INTO coaches 
             (name, discipline, city, experience, price, availability, 
              languages, certifications, specialties, bio, skills, colors, dna) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
             RETURNING *`,
            [
                name,
                discipline.toLowerCase(),
                city,
                experience || 'Débutant',
                price,
                availability || 'Lun-Sam 8h-20h',
                languages || [],
                certifications || [],
                specialties || [],
                bio || null,
                skills || { technique: 85, pedagogy: 85, motivation: 85, experience: 85 },
                colors || ['#3e6c1a', '#027e0f'],
                dna || []
            ]
        );

        const coach = result.rows[0];

        // Ajouter les carrières si fournies
        if (career && career.length > 0) {
            for (const item of career) {
                await client.query(
                    `INSERT INTO coach_careers (coach_id, year, role, club) 
                     VALUES ($1, $2, $3, $4)`,
                    [coach.id, item.year, item.role, item.club]
                );
            }
        }

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: "Coach créé avec succès",
            data: {
                ...coach,
                career: career || []
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur lors de la création du coach:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création du coach",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// ✏️ PUT - Modifier un coach
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        name,
        discipline,
        city,
        experience,
        price,
        availability,
        languages,
        certifications,
        specialties,
        bio,
        skills,
        colors,
        dna,
        status
    } = req.body;

    try {
        const result = await pool.query(
            `UPDATE coaches 
             SET 
                name = COALESCE($1, name),
                discipline = COALESCE($2, discipline),
                city = COALESCE($3, city),
                experience = COALESCE($4, experience),
                price = COALESCE($5, price),
                availability = COALESCE($6, availability),
                languages = COALESCE($7, languages),
                certifications = COALESCE($8, certifications),
                specialties = COALESCE($9, specialties),
                bio = COALESCE($10, bio),
                skills = COALESCE($11, skills),
                colors = COALESCE($12, colors),
                dna = COALESCE($13, dna),
                status = COALESCE($14, status),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $15 
             RETURNING *`,
            [
                name,
                discipline?.toLowerCase(),
                city,
                experience,
                price,
                availability,
                languages,
                certifications,
                specialties,
                bio,
                skills,
                colors,
                dna,
                status,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Coach non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Coach modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification du coach:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification du coach",
            error: err.message
        });
    }
});

// 🗑️ DELETE - Supprimer un coach (soft delete)
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `UPDATE coaches SET status = 'inactive', updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1 
             RETURNING id, name, status`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Coach non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Coach désactivé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression du coach:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression du coach",
            error: err.message
        });
    }
});

// 🏷️ GET - Récupérer les coaches par discipline
router.get("/discipline/:discipline", async (req, res) => {
    const discipline = req.params.discipline;
    
    try {
        const result = await pool.query(
            `SELECT 
                id, name, discipline, city, experience, rating, price, availability,
                languages, certifications, specialties, bio, skills, colors, dna
             FROM coaches 
             WHERE discipline = $1 AND status = 'active'
             ORDER BY rating DESC`,
            [discipline.toLowerCase()]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des coaches par discipline:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// 🏆 GET - Coaches recommandés (CORRIGÉ - sans ?)
router.get("/recommended", async (req, res) => {
    const { discipline } = req.query;
    
    try {
        let sql = `
            SELECT 
                id, name, discipline, city, experience, rating, price, availability,
                languages, certifications, specialties, bio, skills, colors, dna
            FROM coaches 
            WHERE status = 'active'
        `;
        const params = [];

        if (discipline && discipline !== 'undefined' && discipline !== 'all') {
            sql += ` AND discipline = $1`;
            params.push(discipline.toLowerCase());
        }

        sql += ` ORDER BY rating DESC, review_count DESC LIMIT 3`;

        const result = await pool.query(sql, params);

        res.json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des coaches recommandés:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ⭐ POST - Ajouter un avis sur un coach
router.post("/:id/reviews", async (req, res) => {
    const coachId = req.params.id;
    const { player_name, player_email, rating, comment, session_id } = req.body;

    if (!player_name || !rating) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: player_name, rating"
        });
    }

    try {
        // Vérifier si le coach existe
        const coachCheck = await pool.query(
            `SELECT id FROM coaches WHERE id = $1 AND status = 'active'`,
            [coachId]
        );

        if (coachCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Coach non trouvé"
            });
        }

        const result = await pool.query(
            `INSERT INTO coach_reviews 
             (coach_id, player_name, player_email, rating, comment, session_id) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING id, player_name, rating, comment, created_at`,
            [coachId, player_name, player_email, rating, comment || null, session_id || null]
        );

        res.status(201).json({
            success: true,
            message: "Avis ajouté avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de l'ajout de l'avis:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'ajout de l'avis",
            error: err.message
        });
    }
});

// 📊 GET - Statistiques des coaches
router.get("/statistiques/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_coaches,
                COUNT(DISTINCT discipline) as total_disciplines,
                COUNT(DISTINCT city) as total_cities,
                ROUND(AVG(rating)::DECIMAL, 2) as avg_rating,
                MIN(price) as min_price,
                MAX(price) as max_price,
                ROUND(AVG(price)::DECIMAL, 2) as avg_price,
                (
                    SELECT COUNT(*) 
                    FROM coach_reviews 
                    WHERE coach_id IN (SELECT id FROM coaches WHERE status = 'active')
                ) as total_reviews,
                (
                    SELECT json_agg(DISTINCT discipline ORDER BY discipline)
                    FROM coaches 
                    WHERE status = 'active'
                ) as disciplines,
                (
                    SELECT json_agg(DISTINCT city ORDER BY city)
                    FROM coaches 
                    WHERE status = 'active'
                ) as cities
            FROM coaches
            WHERE status = 'active'
        `);

        res.json({
            success: true,
            data: stats.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des statistiques:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

export default router;