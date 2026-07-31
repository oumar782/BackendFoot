// routes/appointments.js
import express from "express";
import pool from "../db.js";
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// 📋 GET - Récupérer tous les rendez-vous avec filtres
router.get("/", async (req, res) => {
    try {
        const { status, search, date_from, date_to, stylist, limit = 50, offset = 0 } = req.query;
        
        let sql = `
            SELECT 
                id,
                client_name,
                client_email,
                client_phone,
                hairstyle,
                size,
                length,
                hair_included,
                stylist,
                date,
                time,
                notes,
                status,
                deposit_paid,
                deposit_amount,
                total_price,
                created_at,
                updated_at
            FROM appointments
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            sql += ` AND status = $${paramCount}`;
            params.push(status);
        }

        if (stylist) {
            paramCount++;
            sql += ` AND stylist ILIKE $${paramCount}`;
            params.push(`%${stylist}%`);
        }

        if (date_from) {
            paramCount++;
            sql += ` AND date >= $${paramCount}`;
            params.push(date_from);
        }

        if (date_to) {
            paramCount++;
            sql += ` AND date <= $${paramCount}`;
            params.push(date_to);
        }

        if (search) {
            paramCount++;
            sql += ` AND (client_name ILIKE $${paramCount} OR client_email ILIKE $${paramCount} OR hairstyle ILIKE $${paramCount} OR stylist ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY date DESC, time DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(sql, params);

        // Compter le total
        let countSql = `SELECT COUNT(*) as total FROM appointments WHERE 1=1`;
        const countParams = [];
        let countParamCount = 0;

        if (status) {
            countParamCount++;
            countSql += ` AND status = $${countParamCount}`;
            countParams.push(status);
        }

        if (stylist) {
            countParamCount++;
            countSql += ` AND stylist ILIKE $${countParamCount}`;
            countParams.push(`%${stylist}%`);
        }

        if (date_from) {
            countParamCount++;
            countSql += ` AND date >= $${countParamCount}`;
            countParams.push(date_from);
        }

        if (date_to) {
            countParamCount++;
            countSql += ` AND date <= $${countParamCount}`;
            countParams.push(date_to);
        }

        if (search) {
            countParamCount++;
            countSql += ` AND (client_name ILIKE $${countParamCount} OR client_email ILIKE $${countParamCount} OR hairstyle ILIKE $${countParamCount} OR stylist ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }

        const countResult = await pool.query(countSql, countParams);

        // Statistiques
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
                COALESCE(SUM(total_price) FILTER (WHERE status != 'cancelled'), 0) as revenu_total,
                COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_paid = true), 0) as total_deposits
            FROM appointments
        `);

        res.json({
            success: true,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset),
            count: result.rows.length,
            stats: statsResult.rows[0],
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des rendez-vous:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des rendez-vous",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer un rendez-vous spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `SELECT 
                id,
                client_name,
                client_email,
                client_phone,
                hairstyle,
                size,
                length,
                hair_included,
                stylist,
                date,
                time,
                notes,
                status,
                deposit_paid,
                deposit_amount,
                total_price,
                created_at,
                updated_at
            FROM appointments
            WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Rendez-vous non trouvé"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération du rendez-vous:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération du rendez-vous",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer les rendez-vous par client
router.get("/client/:name", async (req, res) => {
    const name = req.params.name;
    
    try {
        const result = await pool.query(
            `SELECT 
                id,
                client_name,
                client_email,
                client_phone,
                hairstyle,
                size,
                length,
                stylist,
                date,
                time,
                status,
                total_price
            FROM appointments 
            WHERE client_name ILIKE $1
            ORDER BY date DESC, time DESC`,
            [`%${name}%`]
        );

        // Statistiques par client
        const stats = await pool.query(
            `SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as total_depense
            FROM appointments 
            WHERE client_name ILIKE $1`,
            [`%${name}%`]
        );

        res.json({
            success: true,
            count: result.rows.length,
            stats: stats.rows[0],
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des rendez-vous par client:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// ➕ POST - Créer un nouveau rendez-vous
router.post("/", async (req, res) => {
    const {
        client_name,
        client_email,
        client_phone,
        hairstyle,
        size,
        length,
        hair_included,
        stylist,
        date,
        time,
        notes,
        status = 'pending',
        deposit_paid = false,
        deposit_amount = 0,
        total_price
    } = req.body;

    // Validation des champs requis
    if (!client_name) {
        return res.status(400).json({
            success: false,
            message: "Le champ client_name est requis"
        });
    }

    if (!client_email) {
        return res.status(400).json({
            success: false,
            message: "Le champ client_email est requis"
        });
    }

    if (!client_phone) {
        return res.status(400).json({
            success: false,
            message: "Le champ client_phone est requis"
        });
    }

    if (!hairstyle) {
        return res.status(400).json({
            success: false,
            message: "Le champ hairstyle est requis"
        });
    }

    if (!stylist) {
        return res.status(400).json({
            success: false,
            message: "Le champ stylist est requis"
        });
    }

    if (!date) {
        return res.status(400).json({
            success: false,
            message: "Le champ date est requis"
        });
    }

    if (!time) {
        return res.status(400).json({
            success: false,
            message: "Le champ time est requis"
        });
    }

    if (total_price === undefined || total_price === null) {
        return res.status(400).json({
            success: false,
            message: "Le champ total_price est requis"
        });
    }

    if (total_price < 0) {
        return res.status(400).json({
            success: false,
            message: "Le prix total ne peut pas être négatif"
        });
    }

    // Validation du statut
    const validStatus = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (status && !validStatus.includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Valeurs acceptées: pending, confirmed, completed, cancelled"
        });
    }

    // Validation de l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(client_email)) {
        return res.status(400).json({
            success: false,
            message: "Email invalide"
        });
    }

    try {
        // Générer un ID unique avec UUID
        const id = uuidv4();

        const result = await pool.query(
            `INSERT INTO appointments 
             (id, client_name, client_email, client_phone, hairstyle, size, length, hair_included, 
              stylist, date, time, notes, status, deposit_paid, deposit_amount, total_price) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) 
             RETURNING *`,
            [
                id,
                client_name,
                client_email,
                client_phone,
                hairstyle,
                size || null,
                length || null,
                hair_included || null,
                stylist,
                date,
                time,
                notes || null,
                status,
                deposit_paid,
                parseFloat(deposit_amount) || 0,
                parseFloat(total_price)
            ]
        );

        res.status(201).json({
            success: true,
            message: "Rendez-vous créé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la création du rendez-vous:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création du rendez-vous",
            error: err.message
        });
    }
});

// ✏️ PUT - Modifier un rendez-vous
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        client_name,
        client_email,
        client_phone,
        hairstyle,
        size,
        length,
        hair_included,
        stylist,
        date,
        time,
        notes,
        status,
        deposit_paid,
        deposit_amount,
        total_price
    } = req.body;

    // Validation du statut si fourni
    const validStatus = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (status && !validStatus.includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Valeurs acceptées: pending, confirmed, completed, cancelled"
        });
    }

    // Validation de l'email si fourni
    if (client_email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(client_email)) {
            return res.status(400).json({
                success: false,
                message: "Email invalide"
            });
        }
    }

    if (total_price !== undefined && total_price < 0) {
        return res.status(400).json({
            success: false,
            message: "Le prix total ne peut pas être négatif"
        });
    }

    if (deposit_amount !== undefined && deposit_amount < 0) {
        return res.status(400).json({
            success: false,
            message: "Le montant du dépôt ne peut pas être négatif"
        });
    }

    try {
        // Vérifier si le rendez-vous existe
        const check = await pool.query(
            `SELECT id FROM appointments WHERE id = $1`,
            [id]
        );

        if (check.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Rendez-vous non trouvé"
            });
        }

        const result = await pool.query(
            `UPDATE appointments 
             SET 
                client_name = COALESCE($1, client_name),
                client_email = COALESCE($2, client_email),
                client_phone = COALESCE($3, client_phone),
                hairstyle = COALESCE($4, hairstyle),
                size = COALESCE($5, size),
                length = COALESCE($6, length),
                hair_included = COALESCE($7, hair_included),
                stylist = COALESCE($8, stylist),
                date = COALESCE($9, date),
                time = COALESCE($10, time),
                notes = COALESCE($11, notes),
                status = COALESCE($12, status),
                deposit_paid = COALESCE($13, deposit_paid),
                deposit_amount = COALESCE($14, deposit_amount),
                total_price = COALESCE($15, total_price),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $16 
             RETURNING *`,
            [
                client_name,
                client_email,
                client_phone,
                hairstyle,
                size,
                length,
                hair_included,
                stylist,
                date,
                time,
                notes,
                status,
                deposit_paid,
                deposit_amount !== undefined ? parseFloat(deposit_amount) : null,
                total_price !== undefined ? parseFloat(total_price) : null,
                id
            ]
        );

        res.json({
            success: true,
            message: "Rendez-vous modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification du rendez-vous:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification du rendez-vous",
            error: err.message
        });
    }
});

// 🔄 PATCH - Mettre à jour le statut d'un rendez-vous
router.patch("/:id/status", async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({
            success: false,
            message: "Le champ status est requis"
        });
    }

    const validStatus = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (!validStatus.includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Valeurs acceptées: pending, confirmed, completed, cancelled"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE appointments 
             SET status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 
             RETURNING *`,
            [status, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Rendez-vous non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Statut mis à jour avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la mise à jour du statut:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la mise à jour du statut",
            error: err.message
        });
    }
});

// 🔄 PATCH - Mettre à jour le paiement du dépôt
router.patch("/:id/deposit", async (req, res) => {
    const id = req.params.id;
    const { deposit_paid, deposit_amount } = req.body;

    if (deposit_paid === undefined) {
        return res.status(400).json({
            success: false,
            message: "Le champ deposit_paid est requis"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE appointments 
             SET 
                deposit_paid = $1,
                deposit_amount = COALESCE($2, deposit_amount),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $3 
             RETURNING *`,
            [deposit_paid, deposit_amount !== undefined ? parseFloat(deposit_amount) : null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Rendez-vous non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Paiement du dépôt mis à jour avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la mise à jour du dépôt:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// 🗑️ DELETE - Supprimer un rendez-vous
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `DELETE FROM appointments WHERE id = $1 RETURNING id, client_name, hairstyle`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Rendez-vous non trouvé"
            });
        }

        res.json({
            success: true,
            message: "Rendez-vous supprimé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression du rendez-vous:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression du rendez-vous",
            error: err.message
        });
    }
});

// 📊 GET - Statistiques des rendez-vous
router.get("/statistiques/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
                COALESCE(SUM(total_price), 0) as revenu_total,
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenu_completed,
                COALESCE(AVG(total_price)::DECIMAL(10,2), 0) as prix_moyen,
                MIN(total_price) as prix_min,
                MAX(total_price) as prix_max,
                COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_paid = true), 0) as total_deposits,
                (
                    SELECT json_agg(DISTINCT stylist ORDER BY stylist)
                    FROM appointments
                ) as stylists,
                (
                    SELECT json_agg(DISTINCT status ORDER BY status)
                    FROM appointments
                ) as statuses
            FROM appointments
        `);

        // Rendez-vous par jour (derniers 30 jours)
        const appointmentsParJour = await pool.query(`
            SELECT 
                date,
                COUNT(*) as nombre,
                COALESCE(SUM(total_price) FILTER (WHERE status != 'cancelled'), 0) as revenu
            FROM appointments
            WHERE date >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY date
            ORDER BY date DESC
        `);

        // Top styles les plus demandés
        const topStyles = await pool.query(`
            SELECT 
                hairstyle,
                COUNT(*) as nombre,
                COALESCE(AVG(total_price)::DECIMAL(10,2), 0) as prix_moyen
            FROM appointments
            WHERE status != 'cancelled'
            GROUP BY hairstyle
            ORDER BY nombre DESC
            LIMIT 10
        `);

        // Répartition par coiffeur
        const repartitionStylist = await pool.query(`
            SELECT 
                stylist,
                COUNT(*) as total_rendezvous,
                COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0) as revenu,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
            FROM appointments
            WHERE status != 'cancelled'
            GROUP BY stylist
            ORDER BY revenu DESC
        `);

        res.json({
            success: true,
            data: {
                overview: stats.rows[0],
                appointments_par_jour: appointmentsParJour.rows,
                top_styles: topStyles.rows,
                repartition_stylist: repartitionStylist.rows
            }
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

// 📈 GET - Revenus par période
router.get("/revenus/periode", async (req, res) => {
    const { date_debut, date_fin, periode = 'jour' } = req.query;

    if (!date_debut || !date_fin) {
        return res.status(400).json({
            success: false,
            message: "Les dates date_debut et date_fin sont requises"
        });
    }

    let groupBy;
    switch (periode) {
        case 'mois':
            groupBy = "DATE_TRUNC('month', date)";
            break;
        case 'semaine':
            groupBy = "DATE_TRUNC('week', date)";
            break;
        case 'jour':
        default:
            groupBy = "date";
            break;
    }

    try {
        const result = await pool.query(
            `
            SELECT 
                ${groupBy} as periode,
                COUNT(*) as nombre_rendezvous,
                COALESCE(SUM(total_price) FILTER (WHERE status != 'cancelled'), 0) as revenu_total,
                COALESCE(AVG(total_price)::DECIMAL(10,2), 0) as panier_moyen,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
            FROM appointments
            WHERE date >= $1 AND date <= $2
            GROUP BY periode
            ORDER BY periode ASC
            `,
            [date_debut, date_fin]
        );

        // Total général
        const total = await pool.query(
            `
            SELECT 
                COUNT(*) as total_rendezvous,
                COALESCE(SUM(total_price) FILTER (WHERE status != 'cancelled'), 0) as revenu_total,
                COALESCE(SUM(deposit_amount) FILTER (WHERE deposit_paid = true), 0) as total_deposits
            FROM appointments
            WHERE date >= $1 AND date <= $2
            `,
            [date_debut, date_fin]
        );

        res.json({
            success: true,
            periode: periode,
            date_debut: date_debut,
            date_fin: date_fin,
            total: total.rows[0],
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des revenus:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

export default router;