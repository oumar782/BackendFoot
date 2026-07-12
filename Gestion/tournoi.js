// routes/tournoi.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// ============================================
// 📋 GET - Récupérer tous les tournois
// ============================================
router.get("/", async (req, res) => {
    try {
        const { sport, status, search, limit = 50, offset = 0 } = req.query;
        
        let sql = `
            SELECT 
                t.id,
                t.name,
                t.sport,
                t.type,
                t.description,
                TO_CHAR(t.date, 'YYYY-MM-DD') as date,
                TO_CHAR(t.end_date, 'YYYY-MM-DD') as end_date,
                t.time,
                t.location,
                t.teams_needed,
                t.fee,
                t.status,
                t.created_at,
                t.updated_at,
                COALESCE(
                    (SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = t.id AND status != 'cancelled'),
                    0
                ) as teams_joined
            FROM tournaments t
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 0;

        if (sport) {
            paramCount++;
            sql += ` AND LOWER(t.sport) = LOWER($${paramCount})`;
            params.push(sport);
        }

        if (status) {
            paramCount++;
            sql += ` AND t.status = $${paramCount}`;
            params.push(status);
        }

        if (search) {
            paramCount++;
            sql += ` AND (t.name ILIKE $${paramCount} OR t.description ILIKE $${paramCount} OR t.location ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY t.date ASC, t.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(sql, params);

        // Compter le total
        let countSql = `SELECT COUNT(*) as total FROM tournaments t WHERE 1=1`;
        const countParams = [];
        let countParamCount = 0;

        if (sport) {
            countParamCount++;
            countSql += ` AND LOWER(t.sport) = LOWER($${countParamCount})`;
            countParams.push(sport);
        }

        if (status) {
            countParamCount++;
            countSql += ` AND t.status = $${countParamCount}`;
            countParams.push(status);
        }

        if (search) {
            countParamCount++;
            countSql += ` AND (t.name ILIKE $${countParamCount} OR t.description ILIKE $${countParamCount} OR t.location ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }

        const countResult = await pool.query(countSql, countParams);

        // Récupérer les inscriptions pour chaque tournoi
        const tournamentsWithRegistrations = await Promise.all(result.rows.map(async (tournament) => {
            const registrationsResult = await pool.query(
                `SELECT 
                    id, 
                    team_name, 
                    captain_name, 
                    email, 
                    phone, 
                    registered_at, 
                    status
                 FROM tournament_registrations 
                 WHERE tournament_id = $1 AND status != 'cancelled'
                 ORDER BY registered_at ASC`,
                [tournament.id]
            );
            
            return {
                ...tournament,
                teamsJoined: registrationsResult.rows || [],
                teams_joined: parseInt(tournament.teams_joined) || 0
            };
        }));

        res.json({
            success: true,
            total: parseInt(countResult.rows[0]?.total || 0),
            limit: parseInt(limit),
            offset: parseInt(offset),
            count: tournamentsWithRegistrations.length,
            data: tournamentsWithRegistrations
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 📋 GET - Récupérer un tournoi par ID
// ============================================
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `
            SELECT 
                t.id,
                t.name,
                t.sport,
                t.type,
                t.description,
                TO_CHAR(t.date, 'YYYY-MM-DD') as date,
                TO_CHAR(t.end_date, 'YYYY-MM-DD') as end_date,
                t.time,
                t.location,
                t.teams_needed,
                t.fee,
                t.status,
                t.created_at,
                t.updated_at,
                COALESCE(
                    (SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = t.id AND status != 'cancelled'),
                    0
                ) as teams_joined
            FROM tournaments t
            WHERE t.id = $1
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Tournoi non trouvé"
            });
        }

        const tournament = result.rows[0];

        const registrationsResult = await pool.query(
            `SELECT 
                id, 
                team_name, 
                captain_name, 
                email, 
                phone, 
                registered_at, 
                status
             FROM tournament_registrations 
             WHERE tournament_id = $1 AND status != 'cancelled'
             ORDER BY registered_at ASC`,
            [tournament.id]
        );

        res.json({
            success: true,
            data: {
                ...tournament,
                teamsJoined: registrationsResult.rows || [],
                teams_joined: parseInt(tournament.teams_joined) || 0
            }
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// ➕ POST - Créer un nouveau tournoi (CORRIGÉ)
// ============================================
router.post("/", async (req, res) => {
    const {
        id,
        name,
        sport,
        type,
        description,
        date,
        end_date,
        time,
        location,
        teams_needed,
        fee,
        status
    } = req.body;

    // Validation des champs requis
    if (!name || !sport || !date || !time || !location || !teams_needed) {
        return res.status(400).json({
            success: false,
            message: "Champs requis: name, sport, date, time, location, teams_needed"
        });
    }

    // 🔥 CORRECTION : Si end_date n'est pas fournie, utiliser la date de début
    const finalEndDate = end_date || date;

    // Vérifier que end_date >= date
    if (new Date(finalEndDate) < new Date(date)) {
        return res.status(400).json({
            success: false,
            message: "La date de fin doit être postérieure ou égale à la date de début"
        });
    }

    if (teams_needed <= 0) {
        return res.status(400).json({
            success: false,
            message: "Le nombre d'équipes doit être supérieur à 0"
        });
    }

    try {
        const tournamentId = id || `t${Date.now()}`;
        
        const result = await pool.query(
            `INSERT INTO tournaments 
             (id, name, sport, type, description, date, end_date, time, location, teams_needed, fee, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             RETURNING 
                id,
                name,
                sport,
                type,
                description,
                TO_CHAR(date, 'YYYY-MM-DD') as date,
                TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
                time,
                location,
                teams_needed,
                fee,
                status,
                created_at,
                updated_at`,
            [
                tournamentId,
                name,
                sport.toLowerCase(),
                type || 'tournament',
                description || null,
                date,
                finalEndDate,  // 🔥 Utiliser finalEndDate
                time,
                location,
                teams_needed,
                fee || null,
                status || 'open'
            ]
        );

        console.log("✅ Tournoi créé:", result.rows[0]);

        res.status(201).json({
            success: true,
            message: "Tournoi créé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: "Un tournoi avec cet ID existe déjà"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// ✏️ PUT - Modifier un tournoi
// ============================================
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        name,
        sport,
        type,
        description,
        date,
        end_date,
        time,
        location,
        teams_needed,
        fee,
        status
    } = req.body;

    try {
        const checkResult = await pool.query(
            `SELECT id FROM tournaments WHERE id = $1`,
            [id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Tournoi non trouvé"
            });
        }

        // Vérifier que end_date >= date si les deux sont fournis
        if (date && end_date && new Date(end_date) < new Date(date)) {
            return res.status(400).json({
                success: false,
                message: "La date de fin doit être postérieure ou égale à la date de début"
            });
        }

        const result = await pool.query(
            `UPDATE tournaments 
             SET 
                name = COALESCE($1, name),
                sport = COALESCE($2, sport),
                type = COALESCE($3, type),
                description = COALESCE($4, description),
                date = COALESCE($5, date),
                end_date = COALESCE($6, end_date),
                time = COALESCE($7, time),
                location = COALESCE($8, location),
                teams_needed = COALESCE($9, teams_needed),
                fee = COALESCE($10, fee),
                status = COALESCE($11, status),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $12 
             RETURNING 
                id,
                name,
                sport,
                type,
                description,
                TO_CHAR(date, 'YYYY-MM-DD') as date,
                TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
                time,
                location,
                teams_needed,
                fee,
                status,
                created_at,
                updated_at`,
            [
                name,
                sport?.toLowerCase(),
                type,
                description,
                date,
                end_date,
                time,
                location,
                teams_needed,
                fee,
                status,
                id
            ]
        );

        res.json({
            success: true,
            message: "Tournoi modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 🗑️ DELETE - Supprimer un tournoi (soft delete)
// ============================================
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const checkResult = await pool.query(
            `SELECT id FROM tournaments WHERE id = $1 AND status != 'cancelled'`,
            [id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Tournoi non trouvé ou déjà annulé"
            });
        }

        const result = await pool.query(
            `UPDATE tournaments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1 
             RETURNING id, name, status`,
            [id]
        );

        await pool.query(
            `UPDATE tournament_registrations SET status = 'cancelled' 
             WHERE tournament_id = $1 AND status != 'cancelled'`,
            [id]
        );

        res.json({
            success: true,
            message: "Tournoi annulé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 📝 POST - S'inscrire à un tournoi
// ============================================
router.post("/:id/register", async (req, res) => {
    const tournamentId = req.params.id;
    const { team_name, captain_name, email, phone } = req.body;

    if (!team_name || !captain_name || !email || !phone) {
        return res.status(400).json({
            success: false,
            message: "Tous les champs sont obligatoires: team_name, captain_name, email, phone"
        });
    }

    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Format d'email invalide"
        });
    }

    // Validation téléphone
    const phoneRegex = /^[0-9+\s]{10,}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
        return res.status(400).json({
            success: false,
            message: "Format de téléphone invalide (minimum 10 chiffres)"
        });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Vérifier si le tournoi existe et est ouvert
        const tournamentResult = await client.query(
            `SELECT id, teams_needed, status FROM tournaments 
             WHERE id = $1 AND status IN ('open', 'full')`,
            [tournamentId]
        );

        if (tournamentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: "Tournoi non trouvé ou déjà terminé"
            });
        }

        const tournament = tournamentResult.rows[0];

        // Compter les inscriptions actuelles
        const countResult = await client.query(
            `SELECT COUNT(*) as count FROM tournament_registrations 
             WHERE tournament_id = $1 AND status != 'cancelled'`,
            [tournamentId]
        );

        const currentCount = parseInt(countResult.rows[0].count);

        // Vérifier s'il reste des places
        if (currentCount >= tournament.teams_needed) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: "Tournoi complet"
            });
        }

        // Vérifier si déjà inscrit (email ou téléphone)
        const existingRegistration = await client.query(
            `SELECT id FROM tournament_registrations 
             WHERE tournament_id = $1 AND (email = $2 OR phone = $3) AND status != 'cancelled'`,
            [tournamentId, email, phone]
        );

        if (existingRegistration.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: "Déjà inscrit avec cet email ou téléphone"
            });
        }

        // Ajouter l'inscription
        const registrationResult = await client.query(
            `INSERT INTO tournament_registrations 
             (tournament_id, team_name, captain_name, email, phone, status) 
             VALUES ($1, $2, $3, $4, $5, 'confirmed') 
             RETURNING id, team_name, captain_name, email, phone, registered_at`,
            [tournamentId, team_name, captain_name, email, phone]
        );

        // Mettre à jour le statut du tournoi si complet
        if (currentCount + 1 >= tournament.teams_needed) {
            await client.query(
                `UPDATE tournaments SET status = 'full', updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [tournamentId]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: "Inscription réussie",
            data: {
                registration: registrationResult.rows[0],
                tournament: {
                    id: tournament.id,
                    teams_needed: tournament.teams_needed,
                    status: tournament.status === 'full' ? 'full' : 'open',
                    teams_joined: currentCount + 1
                }
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// ============================================
// 🧑‍🤝‍🧑 GET - Récupérer les inscriptions d'un tournoi
// ============================================
router.get("/:id/registrations", async (req, res) => {
    const tournamentId = req.params.id;
    
    try {
        const checkResult = await pool.query(
            `SELECT id FROM tournaments WHERE id = $1`,
            [tournamentId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Tournoi non trouvé"
            });
        }

        const result = await pool.query(
            `SELECT 
                id, 
                team_name, 
                captain_name, 
                email, 
                phone, 
                registered_at, 
                status
             FROM tournament_registrations 
             WHERE tournament_id = $1 AND status != 'cancelled'
             ORDER BY registered_at ASC`,
            [tournamentId]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 🧑‍🤝‍🧑 DELETE - Annuler une inscription
// ============================================
router.delete("/registrations/:registrationId", async (req, res) => {
    const registrationId = req.params.registrationId;
    
    try {
        const checkResult = await pool.query(
            `SELECT id, tournament_id FROM tournament_registrations 
             WHERE id = $1 AND status != 'cancelled'`,
            [registrationId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Inscription non trouvée"
            });
        }

        const tournamentId = checkResult.rows[0].tournament_id;

        const result = await pool.query(
            `UPDATE tournament_registrations SET status = 'cancelled' 
             WHERE id = $1 
             RETURNING id, team_name, email`,
            [registrationId]
        );

        // Mettre à jour le statut du tournoi
        const countResult = await pool.query(
            `SELECT COUNT(*) as count FROM tournament_registrations 
             WHERE tournament_id = $1 AND status != 'cancelled'`,
            [tournamentId]
        );
        
        const currentCount = parseInt(countResult.rows[0].count);
        
        const tournamentResult = await pool.query(
            `SELECT teams_needed FROM tournaments WHERE id = $1`,
            [tournamentId]
        );
        
        if (tournamentResult.rows.length > 0) {
            const teamsNeeded = parseInt(tournamentResult.rows[0].teams_needed);
            
            if (currentCount < teamsNeeded) {
                await pool.query(
                    `UPDATE tournaments SET status = 'open', updated_at = CURRENT_TIMESTAMP 
                     WHERE id = $1 AND status = 'full'`,
                    [tournamentId]
                );
            }
        }

        res.json({
            success: true,
            message: "Inscription annulée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 📊 GET - Statistiques des tournois
// ============================================
router.get("/statistiques/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_tournaments,
                COUNT(CASE WHEN status = 'open' THEN 1 END) as open_tournaments,
                COUNT(CASE WHEN status = 'full' THEN 1 END) as full_tournaments,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tournaments,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_tournaments,
                COALESCE(
                    (SELECT COUNT(*) FROM tournament_registrations WHERE status != 'cancelled'),
                    0
                ) as total_registrations,
                COALESCE(
                    (SELECT json_agg(DISTINCT sport ORDER BY sport)
                     FROM tournaments WHERE status IN ('open', 'full')),
                    '[]'
                ) as active_sports
            FROM tournaments
            WHERE status != 'cancelled'
        `);

        res.json({
            success: true,
            data: stats.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 📊 GET - Sports disponibles
// ============================================
router.get("/sports/list", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT sport FROM tournaments WHERE status != 'cancelled' ORDER BY sport`
        );

        res.json({
            success: true,
            data: result.rows.map(row => row.sport)
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 🔍 GET - Rechercher des tournois par date
// ============================================
router.get("/date/:searchDate", async (req, res) => {
    const searchDate = req.params.searchDate;
    
    try {
        const result = await pool.query(
            `SELECT 
                id, 
                name, 
                sport, 
                type, 
                description,
                TO_CHAR(date, 'YYYY-MM-DD') as date,
                TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
                time, 
                location, 
                teams_needed, 
                fee, 
                status
             FROM tournaments 
             WHERE $1 BETWEEN date AND end_date AND status != 'cancelled'
             ORDER BY date ASC, time ASC`,
            [searchDate]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 🔢 GET - Nombre de places restantes
// ============================================
router.get("/:id/remaining-spots", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `SELECT 
                t.id,
                t.teams_needed,
                COALESCE(
                    (SELECT COUNT(*) FROM tournament_registrations WHERE tournament_id = t.id AND status != 'cancelled'),
                    0
                ) as teams_joined
             FROM tournaments t
             WHERE t.id = $1 AND t.status != 'cancelled'`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Tournoi non trouvé"
            });
        }

        const { teams_needed, teams_joined } = result.rows[0];
        const remaining = parseInt(teams_needed) - parseInt(teams_joined);

        res.json({
            success: true,
            data: {
                tournament_id: id,
                teams_needed: parseInt(teams_needed),
                teams_joined: parseInt(teams_joined),
                remaining_spots: Math.max(0, remaining),
                is_full: remaining <= 0
            }
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ============================================
// 📧 GET - Vérifier si une équipe est inscrite
// ============================================
router.get("/:id/check-registration", async (req, res) => {
    const tournamentId = req.params.id;
    const { email } = req.query;
    
    if (!email) {
        return res.status(400).json({
            success: false,
            message: "Email requis"
        });
    }
    
    try {
        const checkResult = await pool.query(
            `SELECT id FROM tournaments WHERE id = $1`,
            [tournamentId]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Tournoi non trouvé"
            });
        }

        const result = await pool.query(
            `SELECT id, team_name, captain_name, email, phone, status
             FROM tournament_registrations 
             WHERE tournament_id = $1 AND email = $2 AND status != 'cancelled'`,
            [tournamentId, email]
        );

        res.json({
            success: true,
            data: {
                registered: result.rows.length > 0,
                registration: result.rows[0] || null
            }
        });
    } catch (err) {
        console.error("❌ Erreur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

export default router;