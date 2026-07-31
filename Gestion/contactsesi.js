// routes/contact.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// 📋 GET - Récupérer tous les messages
router.get("/", async (req, res) => {
    try {
        const { status, search, limit = 50, offset = 0 } = req.query;
        
        let sql = `
            SELECT 
                id,
                name,
                email,
                phone,
                message,
                status,
                created_at,
                updated_at
            FROM contact_messages
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            sql += ` AND status = $${paramCount}`;
            params.push(status);
        }

        if (search) {
            paramCount++;
            sql += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount} OR message ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(sql, params);

        // Statistiques
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'unread' THEN 1 END) as unread,
                COUNT(CASE WHEN status = 'read' THEN 1 END) as read
            FROM contact_messages
        `);

        res.json({
            success: true,
            count: result.rows.length,
            stats: statsResult.rows[0],
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

// 📋 GET - Récupérer un message par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `SELECT * FROM contact_messages WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Message non trouvé"
            });
        }

        res.json({
            success: true,
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

// ➕ POST - Créer un nouveau message
router.post("/", async (req, res) => {
    const { name, email, phone, message, status = 'unread' } = req.body;

    // Validation
    if (!name || !email || !phone || !message) {
        return res.status(400).json({
            success: false,
            message: "Tous les champs sont requis: name, email, phone, message"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO contact_messages (name, email, phone, message, status) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING *`,
            [name, email, phone, message, status]
        );

        res.status(201).json({
            success: true,
            message: "Message créé avec succès",
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

// 🔄 PATCH - Marquer comme lu
router.patch("/:id/read", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `UPDATE contact_messages 
             SET status = 'read', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Message non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Message marqué comme lu",
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

// 🔄 PATCH - Marquer comme non lu
router.patch("/:id/unread", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `UPDATE contact_messages 
             SET status = 'unread', updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Message non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Message marqué comme non lu",
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

// 🗑️ DELETE - Supprimer un message
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `DELETE FROM contact_messages WHERE id = $1 RETURNING id, name`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Message non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Message supprimé avec succès",
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

export default router;