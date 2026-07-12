// routes/sessions.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// 📋 GET - Récupérer toutes les sessions
router.get("/", async (req, res) => {
    try {
        const { sport, ville, quartier, date, status } = req.query;
        
        let sql = `
            SELECT 
                s.id,
                s.reservation_id,
                s.sport,
                TO_CHAR(s.date, 'YYYY-MM-DD') as date,
                s.heure,
                s.heurefin,
                s.terrain,
                s.ville,
                s.quartier,
                s.creator_name,
                s.creator_email,
                s.creator_phone,
                s.players_needed,
                s.status,
                s.created_at,
                s.updated_at,
                COUNT(sp.id) as current_players,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', sp.id,
                            'name', sp.name,
                            'email', sp.email,
                            'phone', sp.phone,
                            'isCreator', sp.is_creator,
                            'joinedAt', sp.joined_at
                        )
                    ) FILTER (WHERE sp.id IS NOT NULL), 
                    '[]'
                ) as players
            FROM sessions s
            LEFT JOIN session_players sp ON s.id = sp.session_id
            WHERE s.status != 'cancelled'
        `;

        const params = [];
        let paramCount = 0;

        if (sport) {
            paramCount++;
            sql += ` AND s.sport = $${paramCount}`;
            params.push(sport.toLowerCase());
        }

        if (ville) {
            paramCount++;
            sql += ` AND s.ville = $${paramCount}`;
            params.push(ville);
        }

        if (quartier) {
            paramCount++;
            sql += ` AND s.quartier = $${paramCount}`;
            params.push(quartier);
        }

        if (date) {
            paramCount++;
            sql += ` AND s.date = $${paramCount}`;
            params.push(date);
        }

        if (status) {
            paramCount++;
            sql += ` AND s.status = $${paramCount}`;
            params.push(status);
        }

        sql += ` GROUP BY s.id ORDER BY s.date ASC, s.heure ASC`;

        const result = await pool.query(sql, params);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows.map(row => ({
                ...row,
                currentPlayers: parseInt(row.current_players) || 0
            }))
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des sessions:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des sessions",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer une session spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `
            SELECT 
                s.id,
                s.reservation_id,
                s.sport,
                TO_CHAR(s.date, 'YYYY-MM-DD') as date,
                s.heure,
                s.heurefin,
                s.terrain,
                s.ville,
                s.quartier,
                s.creator_name,
                s.creator_email,
                s.creator_phone,
                s.players_needed,
                s.status,
                s.created_at,
                s.updated_at,
                COUNT(sp.id) as current_players,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', sp.id,
                            'name', sp.name,
                            'email', sp.email,
                            'phone', sp.phone,
                            'isCreator', sp.is_creator,
                            'joinedAt', sp.joined_at
                        )
                    ) FILTER (WHERE sp.id IS NOT NULL), 
                    '[]'
                ) as players
            FROM sessions s
            LEFT JOIN session_players sp ON s.id = sp.session_id
            WHERE s.id = $1
            GROUP BY s.id
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Session non trouvée"
            });
        }

        const session = {
            ...result.rows[0],
            currentPlayers: parseInt(result.rows[0].current_players) || 0
        };

        res.json({
            success: true,
            data: session
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération de la session:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération de la session",
            error: err.message
        });
    }
});

// ➕ POST - Créer une nouvelle session
router.post("/", async (req, res) => {
    const {
        reservation_id,
        sport,
        date,
        heure,
        heurefin,
        terrain,
        ville,
        quartier,
        creator_name,
        creator_email,
        creator_phone,
        players_needed
    } = req.body;

    // Validation des champs requis
    if (!sport || !date || !heure || !terrain || !creator_name || !creator_phone) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: sport, date, heure, terrain, creator_name, creator_phone sont obligatoires"
        });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Créer la session
        const result = await client.query(
            `INSERT INTO sessions 
             (reservation_id, sport, date, heure, heurefin, terrain, ville, quartier, 
              creator_name, creator_email, creator_phone, players_needed, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open') 
             RETURNING 
                id,
                reservation_id,
                sport,
                TO_CHAR(date, 'YYYY-MM-DD') as date,
                heure,
                heurefin,
                terrain,
                ville,
                quartier,
                creator_name,
                creator_email,
                creator_phone,
                players_needed,
                status,
                created_at,
                updated_at`,
            [
                reservation_id || null,
                sport.toLowerCase(),
                date,
                heure,
                heurefin || null,
                terrain,
                ville || null,
                quartier || null,
                creator_name,
                creator_email || null,
                creator_phone,
                players_needed || 10
            ]
        );

        const session = result.rows[0];

        // Ajouter le créateur comme premier joueur
        await client.query(
            `INSERT INTO session_players (session_id, name, email, phone, is_creator) 
             VALUES ($1, $2, $3, $4, true)`,
            [session.id, creator_name, creator_email, creator_phone]
        );

        await client.query('COMMIT');

        console.log("✅ Session créée:", session);

        res.status(201).json({
            success: true,
            message: "Session créée avec succès",
            data: {
                ...session,
                currentPlayers: 1,
                players: [{
                    name: creator_name,
                    email: creator_email,
                    phone: creator_phone,
                    isCreator: true
                }]
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur lors de la création de la session:", err.message);
        
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: "Une session existe déjà pour ce créneau"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création de la session",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// ✏️ PUT - Modifier une session
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        sport,
        date,
        heure,
        heurefin,
        terrain,
        ville,
        quartier,
        players_needed,
        status
    } = req.body;

    try {
        const result = await pool.query(
            `UPDATE sessions 
             SET sport = $1, 
                 date = $2, 
                 heure = $3, 
                 heurefin = $4, 
                 terrain = $5, 
                 ville = $6, 
                 quartier = $7, 
                 players_needed = $8,
                 status = $9,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $10 
             RETURNING 
                id,
                reservation_id,
                sport,
                TO_CHAR(date, 'YYYY-MM-DD') as date,
                heure,
                heurefin,
                terrain,
                ville,
                quartier,
                creator_name,
                creator_email,
                creator_phone,
                players_needed,
                status,
                created_at,
                updated_at`,
            [
                sport.toLowerCase(),
                date,
                heure,
                heurefin || null,
                terrain,
                ville || null,
                quartier || null,
                players_needed || 10,
                status || 'open',
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Session non trouvée"
            });
        }

        console.log("✅ Session modifiée:", result.rows[0]);

        // Récupérer les joueurs
        const playersResult = await pool.query(
            `SELECT id, name, email, phone, is_creator, joined_at 
             FROM session_players 
             WHERE session_id = $1`,
            [id]
        );

        res.json({
            success: true,
            message: "Session modifiée avec succès",
            data: {
                ...result.rows[0],
                currentPlayers: playersResult.rows.length,
                players: playersResult.rows
            }
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de la session:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de la session",
            error: err.message
        });
    }
});

// 🗑️ DELETE - Supprimer une session (soft delete)
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `UPDATE sessions 
             SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP 
             WHERE id = $1 
             RETURNING 
                id,
                sport,
                TO_CHAR(date, 'YYYY-MM-DD') as date,
                heure,
                terrain,
                status`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Session non trouvée"
            });
        }

        console.log("✅ Session annulée:", result.rows[0]);

        res.json({
            success: true,
            message: "Session annulée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de l'annulation de la session:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'annulation de la session",
            error: err.message
        });
    }
});

// 🧑‍🤝‍🧑 POST - Ajouter un joueur à une session
router.post("/:id/players", async (req, res) => {
    const sessionId = req.params.id;
    const { name, email, phone } = req.body;

    if (!name || !phone) {
        return res.status(400).json({
            success: false,
            message: "Nom et téléphone sont obligatoires"
        });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Vérifier si la session existe et n'est pas pleine
        const sessionResult = await client.query(
            `SELECT id, players_needed, status FROM sessions 
             WHERE id = $1 AND status IN ('open', 'full')`,
            [sessionId]
        );

        if (sessionResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: "Session non trouvée ou déjà terminée"
            });
        }

        const session = sessionResult.rows[0];

        // Vérifier si le joueur est déjà inscrit
        const existingPlayer = await client.query(
            `SELECT id FROM session_players 
             WHERE session_id = $1 AND (email = $2 OR phone = $3)`,
            [sessionId, email || null, phone]
        );

        if (existingPlayer.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: "Vous êtes déjà inscrit à cette session"
            });
        }

        // Compter les joueurs actuels
        const countResult = await client.query(
            `SELECT COUNT(*) as count FROM session_players WHERE session_id = $1`,
            [sessionId]
        );

        const currentCount = parseInt(countResult.rows[0].count);

        if (currentCount >= session.players_needed) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: "Session complète"
            });
        }

        // Ajouter le joueur
        const playerResult = await client.query(
            `INSERT INTO session_players (session_id, name, email, phone, is_creator) 
             VALUES ($1, $2, $3, $4, false) 
             RETURNING id, name, email, phone, joined_at`,
            [sessionId, name, email || null, phone]
        );

        // Mettre à jour le statut de la session si pleine
        if (currentCount + 1 >= session.players_needed) {
            await client.query(
                `UPDATE sessions SET status = 'full', updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [sessionId]
            );
        }

        await client.query('COMMIT');

        // Récupérer la session mise à jour
        const updatedSession = await pool.query(
            `SELECT 
                s.id,
                s.sport,
                TO_CHAR(s.date, 'YYYY-MM-DD') as date,
                s.heure,
                s.heurefin,
                s.terrain,
                s.ville,
                s.quartier,
                s.players_needed,
                s.status,
                COUNT(sp.id) as current_players,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', sp.id,
                            'name', sp.name,
                            'email', sp.email,
                            'phone', sp.phone,
                            'isCreator', sp.is_creator,
                            'joinedAt', sp.joined_at
                        )
                    ) FILTER (WHERE sp.id IS NOT NULL), 
                    '[]'
                ) as players
            FROM sessions s
            LEFT JOIN session_players sp ON s.id = sp.session_id
            WHERE s.id = $1
            GROUP BY s.id`,
            [sessionId]
        );

        console.log("✅ Joueur ajouté à la session:", { sessionId, name, phone });

        res.json({
            success: true,
            message: "Inscription réussie !",
            data: {
                ...updatedSession.rows[0],
                currentPlayers: parseInt(updatedSession.rows[0].current_players) || 0
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur lors de l'ajout du joueur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'inscription",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// 🧑‍🤝‍🧑 DELETE - Retirer un joueur d'une session
router.delete("/:id/players/:playerId", async (req, res) => {
    const sessionId = req.params.id;
    const playerId = req.params.playerId;

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Vérifier si le joueur existe
        const playerResult = await client.query(
            `SELECT id, is_creator FROM session_players 
             WHERE id = $1 AND session_id = $2`,
            [playerId, sessionId]
        );

        if (playerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: "Joueur non trouvé dans cette session"
            });
        }

        // Ne pas permettre de retirer le créateur
        if (playerResult.rows[0].is_creator) {
            await client.query('ROLLBACK');
            return res.status(403).json({
                success: false,
                message: "Le créateur de la session ne peut pas être retiré"
            });
        }

        // Retirer le joueur
        await client.query(
            `DELETE FROM session_players WHERE id = $1`,
            [playerId]
        );

        // Mettre à jour le statut de la session
        const countResult = await client.query(
            `SELECT COUNT(*) as count FROM session_players WHERE session_id = $1`,
            [sessionId]
        );

        const currentCount = parseInt(countResult.rows[0].count);

        const sessionResult = await client.query(
            `SELECT players_needed FROM sessions WHERE id = $1`,
            [sessionId]
        );

        const playersNeeded = parseInt(sessionResult.rows[0].players_needed);

        if (currentCount < playersNeeded) {
            await client.query(
                `UPDATE sessions SET status = 'open', updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [sessionId]
            );
        }

        await client.query('COMMIT');

        console.log("✅ Joueur retiré de la session:", { sessionId, playerId });

        res.json({
            success: true,
            message: "Joueur retiré avec succès"
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur lors du retrait du joueur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors du retrait du joueur",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// 📊 GET - Statistiques des sessions
router.get("/statistiques/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(CASE WHEN status = 'open' THEN 1 END) as ouvertes,
                COUNT(CASE WHEN status = 'full' THEN 1 END) as pleines,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as terminees,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as annulees,
                AVG(players_needed) as moyenne_joueurs,
                COUNT(DISTINCT sport) as sports_disponibles,
                COUNT(DISTINCT ville) as villes_disponibles,
                SUM(players_needed) as total_places,
                (
                    SELECT COUNT(*) 
                    FROM session_players 
                    WHERE session_id IN (SELECT id FROM sessions WHERE status != 'cancelled')
                ) as total_inscrits
            FROM sessions
            WHERE status != 'cancelled'
        `);

        res.json({
            success: true,
            data: stats.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des statistiques:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des statistiques",
            error: err.message
        });
    }
});

// 🔍 GET - Sessions par sport
router.get("/sport/:sport", async (req, res) => {
    const sport = req.params.sport;
    
    try {
        const result = await pool.query(
            `SELECT 
                s.id,
                s.reservation_id,
                s.sport,
                TO_CHAR(s.date, 'YYYY-MM-DD') as date,
                s.heure,
                s.heurefin,
                s.terrain,
                s.ville,
                s.quartier,
                s.creator_name,
                s.players_needed,
                s.status,
                COUNT(sp.id) as current_players
            FROM sessions s
            LEFT JOIN session_players sp ON s.id = sp.session_id
            WHERE s.sport = $1 AND s.status != 'cancelled'
            GROUP BY s.id
            ORDER BY s.date ASC, s.heure ASC`,
            [sport.toLowerCase()]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows.map(row => ({
                ...row,
                currentPlayers: parseInt(row.current_players) || 0
            }))
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des sessions par sport:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des sessions",
            error: err.message
        });
    }
});

export default router;