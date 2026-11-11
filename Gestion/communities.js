// routes/communities.js
import express from "express";
import { randomBytes } from "node:crypto";
import pool from "../db.js";
import { hashPassword, requireAuth } from "./Auths.js";

const router = express.Router();

async function findCommunityUserId(queryable, email) {
    const result = await queryable.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
    );
    return result.rows[0]?.id || null;
}

async function getOrCreateCommunityUser(queryable, user) {
    const existingId = await findCommunityUserId(queryable, user.email);
    if (existingId) return existingId;

    const organization = await queryable.query(
        `INSERT INTO organizations (name, slug)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
         RETURNING id`,
        [`PlayForest member ${user.id}`, `playforest-user-${user.id}`]
    );
    const nameParts = String(user.full_name || '').trim().split(/\s+/);
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    const createdUser = await queryable.query(
        `INSERT INTO users
            (organization_id, email, password_hash, role, first_name, last_name)
         VALUES ($1, $2, $3, 'viewer', $4, $5)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [organization.rows[0].id, user.email, passwordHash, nameParts.shift() || 'PlayForest', nameParts.join(' ') || null]
    );

    return createdUser.rows[0]?.id || findCommunityUserId(queryable, user.email);
}

// ================================================================
// 📋 GET - Récupérer toutes les communautés avec filtres
// ================================================================
router.get("/", requireAuth, async (req, res) => {
    try {
        const { sport, city, quartier, search, is_private, limit = 50, offset = 0 } = req.query;

        let sql = `
            SELECT
                c.id,
                c.name,
                c.sport,
                c.description,
                c.city,
                c.quartier,
                c.is_private,
                c.members_count,
                c.created_at,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS admin_name,
                u.email     AS admin_email,
                c.admin_id = (SELECT owner.id FROM users owner WHERE LOWER(owner.email) = LOWER($1) LIMIT 1) AS "isAdmin",
                EXISTS (
                    SELECT 1 FROM community_members cm
                    JOIN users member_user ON member_user.id = cm.user_id
                    WHERE cm.community_id = c.id AND LOWER(member_user.email) = LOWER($1)
                ) AS "isMember",
                (SELECT COUNT(*) FROM posts p WHERE p.community_id = c.id) AS posts_count
            FROM communities c
            JOIN users u ON u.id = c.admin_id
            WHERE 1=1
        `;

        const params = [req.user.email];
        let paramCount = 1;

        if (sport) {
            paramCount++;
            sql += ` AND c.sport ILIKE $${paramCount}`;
            params.push(`%${sport}%`);
        }

        if (city) {
            paramCount++;
            sql += ` AND c.city ILIKE $${paramCount}`;
            params.push(`%${city}%`);
        }

        if (quartier) {
            paramCount++;
            sql += ` AND c.quartier ILIKE $${paramCount}`;
            params.push(`%${quartier}%`);
        }

        if (is_private !== undefined) {
            paramCount++;
            sql += ` AND c.is_private = $${paramCount}`;
            params.push(is_private === 'true');
        }

        if (search) {
            paramCount++;
            sql += ` AND (c.name ILIKE $${paramCount} OR c.description ILIKE $${paramCount} OR c.sport ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY c.members_count DESC, c.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(sql, params);

        // Compter le total (mêmes filtres)
        let countSql = `SELECT COUNT(*) as total FROM communities c WHERE 1=1`;
        const countParams = [];
        let cCount = 0;

        if (sport) {
            cCount++;
            countSql += ` AND c.sport ILIKE $${cCount}`;
            countParams.push(`%${sport}%`);
        }
        if (city) {
            cCount++;
            countSql += ` AND c.city ILIKE $${cCount}`;
            countParams.push(`%${city}%`);
        }
        if (quartier) {
            cCount++;
            countSql += ` AND c.quartier ILIKE $${cCount}`;
            countParams.push(`%${quartier}%`);
        }
        if (is_private !== undefined) {
            cCount++;
            countSql += ` AND c.is_private = $${cCount}`;
            countParams.push(is_private === 'true');
        }
        if (search) {
            cCount++;
            countSql += ` AND (c.name ILIKE $${cCount} OR c.description ILIKE $${cCount} OR c.sport ILIKE $${cCount})`;
            countParams.push(`%${search}%`);
        }

        const countResult = await pool.query(countSql, countParams);

        res.json({
            success: true,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset),
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des communautés:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des communautés",
            error: err.message
        });
    }
});

// ================================================================
// 📋 GET - Récupérer une communauté par ID (détail complet)
// ================================================================
router.get("/:id", requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `
            SELECT
                c.id,
                c.name,
                c.sport,
                c.description,
                c.city,
                c.quartier,
                c.is_private,
                c.members_count,
                c.created_at,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS admin_name,
                u.email     AS admin_email,
                c.admin_id = (SELECT owner.id FROM users owner WHERE LOWER(owner.email) = LOWER($2) LIMIT 1) AS "isAdmin",
                EXISTS (
                    SELECT 1 FROM community_members cm
                    JOIN users member_user ON member_user.id = cm.user_id
                    WHERE cm.community_id = c.id AND LOWER(member_user.email) = LOWER($2)
                ) AS "isMember"
            FROM communities c
            JOIN users u ON u.id = c.admin_id
            WHERE c.id = $1
            `,
            [id, req.user.email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Communauté non trouvée"
            });
        }

        const community = result.rows[0];

        // Membres officiels (avec nom)
        const membersResult = await pool.query(
            `
            SELECT
                cm.role,
                cm.level,
                cm.joined_at,
                u.id         AS user_id,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS name,
                NULL::TEXT AS avatar_url
            FROM community_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.community_id = $1
            ORDER BY (cm.role = 'admin') DESC, cm.joined_at ASC
            `,
            [id]
        );

        // Posts + auteur (avec nom)
        const postsResult = await pool.query(
            `
            SELECT
                p.id,
                p.post_type,
                p.content,
                p.media_url,
                p.media_type,
                p.likes_count,
                p.created_at,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS author_name,
                NULL::TEXT AS author_avatar,
                cm.role AS author_role
            FROM posts p
            JOIN users u ON u.id = p.author_id
            LEFT JOIN community_members cm
                   ON cm.user_id = p.author_id AND cm.community_id = p.community_id
            WHERE p.community_id = $1
            ORDER BY p.created_at DESC
            `,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...community,
                members: membersResult.rows,
                posts: postsResult.rows
            }
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération de la communauté:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération de la communauté",
            error: err.message
        });
    }
});

// ================================================================
// ➕ POST - Créer une nouvelle communauté
// ================================================================
router.post("/", requireAuth, async (req, res) => {
    const { name, sport, description, is_private } = req.body;
    const city = req.user.city?.trim();
    const quartier = req.user.quartier?.trim() || null;

    if (!name || !sport) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: name, sport"
        });
    }

    if (!city) {
        return res.status(400).json({
            success: false,
            message: "Renseignez votre ville dans votre profil avant de créer une communauté"
        });
    }

    let client;
    let transactionStarted = false;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        transactionStarted = true;

        const admin_id = await getOrCreateCommunityUser(client, req.user);

        if (!admin_id) throw new Error('Impossible de créer le profil communautaire');

        // 1. Créer la communauté
        const result = await client.query(
            `
            INSERT INTO communities
                (name, sport, description, city, quartier, is_private, admin_id, members_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
            RETURNING *
            `,
            [
                name,
                sport,
                description || null,
                city,
                quartier || null,
                is_private !== undefined ? is_private : true,
                admin_id
            ]
        );

        const community = result.rows[0];

        // 2. Ajouter l'admin comme membre
        await client.query(
            `
            INSERT INTO community_members (community_id, user_id, role, level)
            VALUES ($1, $2, 'admin', 'Confirmé')
            `,
            [community.id, admin_id]
        );

        await client.query('COMMIT');
        transactionStarted = false;

        res.status(201).json({
            success: true,
            message: "Communauté créée avec succès",
            data: community
        });
    } catch (err) {
        if (client && transactionStarted) await client.query('ROLLBACK');
        console.error("❌ Erreur lors de la création de la communauté:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création de la communauté",
            error: err.message
        });
    } finally {
        client?.release();
    }
});

// ================================================================
// ✏️ PUT - Modifier une communauté
// ================================================================
router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const { name, sport, description, city, quartier, is_private } = req.body;

    try {
        const result = await pool.query(
            `
            UPDATE communities
            SET
                name        = COALESCE($1, name),
                sport       = COALESCE($2, sport),
                description = COALESCE($3, description),
                city        = COALESCE($4, city),
                quartier    = COALESCE($5, quartier),
                is_private  = COALESCE($6, is_private)
            WHERE id = $7
            RETURNING *
            `,
            [name, sport, description, city, quartier, is_private, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Communauté non trouvée"
            });
        }

        res.json({
            success: true,
            message: "Communauté modifiée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de la communauté:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de la communauté",
            error: err.message
        });
    }
});

// ================================================================
// 🗑️ DELETE - Supprimer une communauté
// ================================================================
router.delete("/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `DELETE FROM communities WHERE id = $1 RETURNING id, name`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Communauté non trouvée"
            });
        }

        res.json({
            success: true,
            message: "Communauté supprimée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression de la communauté:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression de la communauté",
            error: err.message
        });
    }
});

// ================================================================
// 📩 POST - Envoyer une demande d'adhésion
// ================================================================
router.post("/:id/join", async (req, res) => {
    const { id } = req.params;
    const { user_id, message, level } = req.body;

    if (!user_id) {
        return res.status(400).json({
            success: false,
            message: "Champ requis manquant: user_id"
        });
    }

    try {
        // Vérifier que la communauté existe
        const commCheck = await pool.query(
            `SELECT id, name, admin_id FROM communities WHERE id = $1`,
            [id]
        );

        if (commCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Communauté non trouvée"
            });
        }

        // Vérifier si déjà membre
        const memberCheck = await pool.query(
            `SELECT id FROM community_members WHERE community_id = $1 AND user_id = $2`,
            [id, user_id]
        );

        if (memberCheck.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Vous êtes déjà membre de cette communauté"
            });
        }

        // Vérifier si demande déjà en attente
        const pendingCheck = await pool.query(
            `SELECT id FROM join_requests WHERE community_id = $1 AND user_id = $2 AND status = 'pending'`,
            [id, user_id]
        );

        if (pendingCheck.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Une demande est déjà en attente"
            });
        }

        // Créer la demande
        const result = await pool.query(
            `
            INSERT INTO join_requests (community_id, user_id, message, level, status)
            VALUES ($1, $2, $3, $4, 'pending')
            RETURNING *
            `,
            [id, user_id, message || null, level || null]
        );

        // Notifier l'admin
        await pool.query(
            `
            INSERT INTO notifications (user_id, community_id, title, message, type)
            VALUES ($1, $2, $3, $4, 'join_request')
            `,
            [
                commCheck.rows[0].admin_id,
                id,
                commCheck.rows[0].name,
                `Nouvelle demande d'adhésion reçue.`
            ]
        );

        res.status(201).json({
            success: true,
            message: "Demande d'adhésion envoyée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de l'envoi de la demande:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'envoi de la demande",
            error: err.message
        });
    }
});

// ================================================================
// 📩 GET - Récupérer les demandes d'adhésion (admin)
// ================================================================
router.get("/:id/join-requests", requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
        const community = await pool.query(
            `SELECT admin_id FROM communities WHERE id = $1`,
            [id]
        );
        if (community.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Communauté non trouvée" });
        }

        const currentUserId = await findCommunityUserId(pool, req.user.email);
        if (!currentUserId || community.rows[0].admin_id !== currentUserId) {
            return res.status(403).json({ success: false, message: "Accès réservé à l'administrateur de la communauté" });
        }

        const result = await pool.query(
            `
            SELECT
                jr.id,
                jr.message,
                jr.level,
                jr.status,
                jr.created_at,
                u.id         AS user_id,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS name,
                u.email
            FROM join_requests jr
            JOIN users u ON u.id = jr.user_id
            WHERE jr.community_id = $1 AND jr.status = 'pending'
            ORDER BY jr.created_at ASC
            `,
            [id]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des demandes:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// POST /:id/join-requests - compatible avec le client PlayForest
router.post("/:id/join-requests", requireAuth, async (req, res) => {
    const { id } = req.params;
    const { message } = req.body;
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const community = await client.query(
            `SELECT id, name FROM communities WHERE id = $1`,
            [id]
        );
        if (community.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "Communauté non trouvée" });
        }

        const userId = await getOrCreateCommunityUser(client, req.user);
        const member = await client.query(
            `SELECT id FROM community_members WHERE community_id = $1 AND user_id = $2`,
            [id, userId]
        );
        if (member.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.json({ success: true, code: "ALREADY_MEMBER", alreadyMember: true, message: "Vous êtes déjà membre de cette communauté" });
        }

        const pending = await client.query(
            `SELECT id FROM join_requests WHERE community_id = $1 AND user_id = $2 AND status = 'pending'`,
            [id, userId]
        );
        if (pending.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.json({ success: true, code: "REQUEST_PENDING", requestPending: true, message: "Une demande est déjà en attente" });
        }

        const request = await client.query(
            `INSERT INTO join_requests (community_id, user_id, message, status)
             VALUES ($1, $2, $3, 'pending') RETURNING *`,
            [id, userId, message || null]
        );
        const communityAdmin = await client.query(
            `SELECT admin_id FROM communities WHERE id = $1`,
            [id]
        );
        await client.query(
            `INSERT INTO notifications (user_id, community_id, title, message, type)
             VALUES ($1, $2, $3, $4, 'join_request')`,
            [communityAdmin.rows[0].admin_id, id, community.rows[0].name, 'Nouvelle demande d\'adhésion reçue.']
        );
        await client.query('COMMIT');

        res.status(201).json({ success: true, message: "Demande d'adhésion envoyée avec succès", data: request.rows[0] });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error("❌ Erreur lors de l'envoi de la demande:", err.message);
        res.status(500).json({ success: false, message: "Erreur serveur lors de l'envoi de la demande", error: err.message });
    } finally {
        client?.release();
    }
});

// PATCH /:id/join-requests/:requestId - compatible avec le client PlayForest
router.patch("/:id/join-requests/:requestId", requireAuth, async (req, res) => {
    const { id, requestId } = req.params;
    const action = req.body.action;
    if (!['accept', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, message: "Action attendue: accept ou reject" });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const community = await client.query(
            `SELECT admin_id FROM communities WHERE id = $1`,
            [id]
        );
        if (community.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "Communauté non trouvée" });
        }

        const currentUserId = await findCommunityUserId(client, req.user.email);
        if (!currentUserId || community.rows[0].admin_id !== currentUserId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, message: "Accès réservé à l'administrateur de la communauté" });
        }

        const request = await client.query(
            `SELECT user_id, level FROM join_requests
             WHERE id = $1 AND community_id = $2 AND status = 'pending' FOR UPDATE`,
            [requestId, id]
        );
        if (request.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: "Demande non trouvée ou déjà traitée" });
        }

        const { user_id: requesterId, level } = request.rows[0];
        const status = action === 'accept' ? 'accepted' : 'rejected';
        await client.query(`UPDATE join_requests SET status = $1 WHERE id = $2`, [status, requestId]);

        if (action === 'accept') {
            const member = await client.query(
                `INSERT INTO community_members (community_id, user_id, role, level)
                 VALUES ($1, $2, 'member', $3)
                 ON CONFLICT (community_id, user_id) DO NOTHING
                 RETURNING id`,
                [id, requesterId, level || null]
            );
            if (member.rows.length > 0) {
                await client.query(`UPDATE communities SET members_count = members_count + 1 WHERE id = $1`, [id]);
            }
        }

        await client.query(
            `INSERT INTO notifications (user_id, community_id, title, message, type)
             VALUES ($1, $2, $3, $4, 'info')`,
            [requesterId, id, action === 'accept' ? 'Adhésion acceptée' : 'Adhésion refusée', action === 'accept' ? 'Votre demande a été acceptée.' : 'Votre demande a été refusée.']
        );
        await client.query('COMMIT');
        res.json({ success: true, message: action === 'accept' ? "Demande acceptée avec succès" : "Demande refusée" });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error("❌ Erreur lors du traitement de la demande:", err.message);
        res.status(500).json({ success: false, message: "Erreur serveur lors du traitement de la demande", error: err.message });
    } finally {
        client?.release();
    }
});

// ================================================================
// ✅ POST - Accepter une demande d'adhésion
// ================================================================
router.post("/:id/join-requests/:requestId/accept", async (req, res) => {
    const { id, requestId } = req.params;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Récupérer la demande
        const reqResult = await client.query(
            `SELECT user_id, level FROM join_requests WHERE id = $1 AND community_id = $2 AND status = 'pending'`,
            [requestId, id]
        );

        if (reqResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: "Demande non trouvée ou déjà traitée"
            });
        }

        const { user_id, level } = reqResult.rows[0];

        // Mettre à jour le statut
        await client.query(
            `UPDATE join_requests SET status = 'accepted' WHERE id = $1`,
            [requestId]
        );

        // Ajouter le membre
        await client.query(
            `
            INSERT INTO community_members (community_id, user_id, role, level)
            VALUES ($1, $2, 'member', $3)
            ON CONFLICT (community_id, user_id) DO NOTHING
            `,
            [id, user_id, level || null]
        );

        // Incrémenter le compteur
        await client.query(
            `UPDATE communities SET members_count = members_count + 1 WHERE id = $1`,
            [id]
        );

        // Notifier l'utilisateur
        await client.query(
            `
            INSERT INTO notifications (user_id, community_id, title, message, type)
            VALUES ($1, $2, $3, $4, 'info')
            `,
            [user_id, id, 'Adhésion acceptée', 'Votre demande a été acceptée 🎉']
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: "Demande acceptée avec succès"
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur lors de l'acceptation:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'acceptation",
            error: err.message
        });
    } finally {
        client.release();
    }
});

// ================================================================
// ❌ POST - Refuser une demande d'adhésion
// ================================================================
router.post("/:id/join-requests/:requestId/reject", async (req, res) => {
    const { id, requestId } = req.params;

    try {
        const result = await pool.query(
            `
            UPDATE join_requests
            SET status = 'rejected'
            WHERE id = $1 AND community_id = $2 AND status = 'pending'
            RETURNING user_id
            `,
            [requestId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Demande non trouvée ou déjà traitée"
            });
        }

        // Notifier l'utilisateur
        await pool.query(
            `
            INSERT INTO notifications (user_id, community_id, title, message, type)
            VALUES ($1, $2, $3, $4, 'info')
            `,
            [result.rows[0].user_id, id, 'Adhésion refusée', 'Votre demande a été refusée.']
        );

        res.json({
            success: true,
            message: "Demande refusée"
        });
    } catch (err) {
        console.error("❌ Erreur lors du refus:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 👥 GET - Récupérer les membres d'une communauté
// ================================================================
router.get("/:id/members", async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `
            SELECT
                cm.role,
                cm.level,
                cm.joined_at,
                u.id         AS user_id,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS name,
                NULL::TEXT AS avatar_url
            FROM community_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.community_id = $1
            ORDER BY (cm.role = 'admin') DESC, cm.joined_at ASC
            `,
            [id]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des membres:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 📰 POST - Créer un post dans une communauté
// ================================================================
router.post("/:id/posts", requireAuth, async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const media_url = req.body.media_url ?? req.body.mediaUrl;
    const media_type = req.body.media_type ?? req.body.mediaType;
    const post_type = req.body.post_type ?? req.body.postType;

    if (!content && !media_url) {
        return res.status(400).json({
            success: false,
            message: "Le post doit contenir du texte ou un média"
        });
    }

    try {
        const author_id = await findCommunityUserId(pool, req.user.email);
        if (!author_id) {
            return res.status(403).json({ success: false, message: "Profil communautaire introuvable" });
        }

        // Vérifier que l'auteur est membre
        const memberCheck = await pool.query(
            `SELECT id FROM community_members WHERE community_id = $1 AND user_id = $2`,
            [id, author_id]
        );

        if (memberCheck.rows.length === 0) {
            return res.status(403).json({
                success: false,
                message: "Vous devez être membre pour publier"
            });
        }

        const result = await pool.query(
            `
            INSERT INTO posts (community_id, author_id, post_type, content, media_url, media_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            `,
            [
                id,
                author_id,
                post_type || 'text',
                content || null,
                media_url || null,
                media_type || 'none'
            ]
        );

        // Récupérer le nom de l'auteur pour la réponse
        const authorResult = await pool.query(
            `SELECT COALESCE(first_name || ' ' || last_name, email) AS full_name FROM users WHERE id = $1`,
            [author_id]
        );

        res.status(201).json({
            success: true,
            message: "Post publié avec succès",
            data: {
                ...result.rows[0],
                author_name: authorResult.rows[0]?.full_name
            }
        });
    } catch (err) {
        console.error("❌ Erreur lors de la création du post:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création du post",
            error: err.message
        });
    }
});

// ================================================================
// 📰 GET - Récupérer les posts d'une communauté
// ================================================================
router.get("/:id/posts", async (req, res) => {
    const { id } = req.params;
    const { user_id } = req.query;  // optionnel : pour savoir si l'user a liké

    try {
        const result = await pool.query(
            `
            SELECT
                p.id,
                p.post_type,
                p.content,
                p.media_url,
                p.media_type,
                p.likes_count,
                p.created_at,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS author_name,
                NULL::TEXT AS author_avatar,
                cm.role      AS author_role,
                $2::uuid IS NOT NULL AND EXISTS (
                    SELECT 1 FROM post_likes pl
                    WHERE pl.post_id = p.id AND pl.user_id = $2::uuid
                ) AS user_liked,
                (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments_count
            FROM posts p
            JOIN users u ON u.id = p.author_id
            LEFT JOIN community_members cm
                   ON cm.user_id = p.author_id AND cm.community_id = p.community_id
            WHERE p.community_id = $1
            ORDER BY p.created_at DESC
            `,
            [id, user_id || null]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des posts:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 🗑️ DELETE - Supprimer un post
// ================================================================
router.delete("/:id/posts/:postId", async (req, res) => {
    const { id, postId } = req.params;

    try {
        const result = await pool.query(
            `DELETE FROM posts WHERE id = $1 AND community_id = $2 RETURNING id`,
            [postId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Post non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Post supprimé avec succès"
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression du post:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 🔥 POST - Toggle like sur un post
// ================================================================
const toggleCommunityPostLike = async (req, res) => {
    const { id, postId } = req.params;

    try {
        const user_id = await findCommunityUserId(pool, req.user.email);
        if (!user_id) {
            return res.status(403).json({ success: false, message: "Profil communautaire introuvable" });
        }

        const post = await pool.query(
            `SELECT id FROM posts WHERE id = $1 AND community_id = $2`,
            [postId, id]
        );
        if (post.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Publication non trouvée" });
        }

        // Vérifier si déjà liké
        const existing = await pool.query(
            `SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2`,
            [postId, user_id]
        );

        if (existing.rows.length > 0) {
            // Unlike
            await pool.query(
                `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2`,
                [postId, user_id]
            );
            await pool.query(
                `UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1`,
                [postId]
            );
            return res.json({
                success: true,
                message: "Like retiré",
                liked: false
            });
        } else {
            // Like
            await pool.query(
                `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)`,
                [postId, user_id]
            );
            await pool.query(
                `UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1`,
                [postId]
            );
            return res.json({
                success: true,
                message: "Post liké",
                liked: true
            });
        }
    } catch (err) {
        console.error("❌ Erreur lors du like:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
};

router.post("/:id/posts/:postId/like", requireAuth, toggleCommunityPostLike);
router.post("/:id/posts/:postId/likes", requireAuth, toggleCommunityPostLike);

// ================================================================
// 💬 POST - Ajouter un commentaire
// ================================================================
router.post("/:id/posts/:postId/comments", requireAuth, async (req, res) => {
    const { id, postId } = req.params;
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({
            success: false,
            message: "Champ requis manquant: content"
        });
    }

    try {
        const author_id = await findCommunityUserId(pool, req.user.email);
        if (!author_id) {
            return res.status(403).json({ success: false, message: "Profil communautaire introuvable" });
        }

        const member = await pool.query(
            `SELECT 1 FROM community_members cm
             JOIN posts p ON p.community_id = cm.community_id
             WHERE cm.user_id = $1 AND p.id = $2 AND p.community_id = $3`,
            [author_id, postId, id]
        );
        if (member.rows.length === 0) {
            return res.status(403).json({ success: false, message: "Vous devez être membre pour commenter" });
        }

        const result = await pool.query(
            `
            INSERT INTO comments (post_id, author_id, content)
            VALUES ($1, $2, $3)
            RETURNING *
            `,
            [postId, author_id, content]
        );

        const authorResult = await pool.query(
            `SELECT COALESCE(first_name || ' ' || last_name, email) AS full_name FROM users WHERE id = $1`,
            [author_id]
        );

        res.status(201).json({
            success: true,
            message: "Commentaire ajouté",
            data: {
                ...result.rows[0],
                author_name: authorResult.rows[0]?.full_name
            }
        });
    } catch (err) {
        console.error("❌ Erreur lors de l'ajout du commentaire:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 💬 GET - Récupérer les commentaires d'un post
// ================================================================
router.get("/:id/posts/:postId/comments", async (req, res) => {
    const { postId } = req.params;

    try {
        const result = await pool.query(
            `
            SELECT
                c.id,
                c.content,
                c.created_at,
                COALESCE(u.first_name || ' ' || u.last_name, u.email) AS author_name,
                NULL::TEXT AS author_avatar
            FROM comments c
            JOIN users u ON u.id = c.author_id
            WHERE c.post_id = $1
            ORDER BY c.created_at ASC
            `,
            [postId]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des commentaires:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 🔔 GET - Notifications de l'utilisateur
// ================================================================
router.get("/notifications/:userId", async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(
            `
            SELECT
                n.id,
                n.title,
                n.message,
                n.type,
                n.is_read,
                n.created_at,
                c.name AS community_name
            FROM notifications n
            LEFT JOIN communities c ON c.id = n.community_id
            WHERE n.user_id = $1
            ORDER BY n.created_at DESC
            LIMIT 50
            `,
            [userId]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des notifications:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 🔔 PUT - Marquer une notification comme lue
// ================================================================
router.put("/notifications/:notificationId/read", async (req, res) => {
    const { notificationId } = req.params;

    try {
        const result = await pool.query(
            `UPDATE notifications SET is_read = TRUE WHERE id = $1 RETURNING id`,
            [notificationId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Notification non trouvée"
            });
        }

        res.json({
            success: true,
            message: "Notification marquée comme lue"
        });
    } catch (err) {
        console.error("❌ Erreur lors de la mise à jour:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ================================================================
// 📊 GET - Statistiques globales des communautés
// ================================================================
router.get("/stats/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                COUNT(*)                                  AS total_communities,
                COUNT(DISTINCT sport)                     AS total_sports,
                COUNT(DISTINCT city)                      AS total_cities,
                COALESCE(SUM(members_count), 0)           AS total_members,
                (SELECT COUNT(*) FROM posts)              AS total_posts,
                (SELECT COUNT(*) FROM join_requests WHERE status = 'pending') AS pending_requests,
                (SELECT json_agg(DISTINCT sport ORDER BY sport) FROM communities) AS sports,
                (SELECT json_agg(DISTINCT city ORDER BY city)   FROM communities) AS cities
            FROM communities
        `);

        res.json({
            success: true,
            data: stats.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors des statistiques:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

export default router;