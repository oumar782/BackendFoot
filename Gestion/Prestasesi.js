// routes/prestations.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// 📋 GET - Récupérer toutes les prestations avec filtres
router.get("/", async (req, res) => {
    try {
        const { status, search, date_from, date_to, coiffeur, limit = 50, offset = 0 } = req.query;
        
        let sql = `
            SELECT 
                id,
                type_prestation,
                prix_base,
                statut,
                coiffeur_nom,
                client_nom,
                date_prestation
            FROM prestations
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            sql += ` AND statut = $${paramCount}`;
            params.push(status);
        }

        if (coiffeur) {
            paramCount++;
            sql += ` AND coiffeur_nom ILIKE $${paramCount}`;
            params.push(`%${coiffeur}%`);
        }

        if (date_from) {
            paramCount++;
            sql += ` AND date_prestation >= $${paramCount}`;
            params.push(date_from);
        }

        if (date_to) {
            paramCount++;
            sql += ` AND date_prestation <= $${paramCount}`;
            params.push(date_to);
        }

        if (search) {
            paramCount++;
            sql += ` AND (type_prestation ILIKE $${paramCount} OR client_nom ILIKE $${paramCount} OR coiffeur_nom ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        sql += ` ORDER BY date_prestation DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(sql, params);

        // Compter le total
        let countSql = `SELECT COUNT(*) as total FROM prestations WHERE 1=1`;
        const countParams = [];
        let countParamCount = 0;

        if (status) {
            countParamCount++;
            countSql += ` AND statut = $${countParamCount}`;
            countParams.push(status);
        }

        if (coiffeur) {
            countParamCount++;
            countSql += ` AND coiffeur_nom ILIKE $${countParamCount}`;
            countParams.push(`%${coiffeur}%`);
        }

        if (date_from) {
            countParamCount++;
            countSql += ` AND date_prestation >= $${countParamCount}`;
            countParams.push(date_from);
        }

        if (date_to) {
            countParamCount++;
            countSql += ` AND date_prestation <= $${countParamCount}`;
            countParams.push(date_to);
        }

        if (search) {
            countParamCount++;
            countSql += ` AND (type_prestation ILIKE $${countParamCount} OR client_nom ILIKE $${countParamCount} OR coiffeur_nom ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }

        const countResult = await pool.query(countSql, countParams);

        // Statistiques
        const statsResult = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN statut = 'en_cours' THEN 1 END) as en_cours,
                COUNT(CASE WHEN statut = 'termine' THEN 1 END) as termine,
                COUNT(CASE WHEN statut = 'annule' THEN 1 END) as annule,
                COALESCE(SUM(prix_base) FILTER (WHERE statut != 'annule'), 0) as revenu_total
            FROM prestations
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
        console.error("❌ Erreur lors de la récupération des prestations:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des prestations",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer une prestation spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `SELECT 
                id,
                type_prestation,
                prix_base,
                statut,
                coiffeur_nom,
                client_nom,
                date_prestation
            FROM prestations
            WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Prestation non trouvée"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération de la prestation:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération de la prestation",
            error: err.message
        });
    }
});

// ➕ POST - Créer une nouvelle prestation
router.post("/", async (req, res) => {
    const {
        type_prestation,
        prix_base,
        statut = 'en_attente',
        coiffeur_nom,
        client_nom,
        date_prestation
    } = req.body;

    // Validation des champs requis
    if (!type_prestation) {
        return res.status(400).json({
            success: false,
            message: "Le champ type_prestation est requis"
        });
    }

    if (!coiffeur_nom) {
        return res.status(400).json({
            success: false,
            message: "Le champ coiffeur_nom est requis"
        });
    }

    if (prix_base === undefined || prix_base === null) {
        return res.status(400).json({
            success: false,
            message: "Le champ prix_base est requis"
        });
    }

    if (prix_base < 0) {
        return res.status(400).json({
            success: false,
            message: "Le prix ne peut pas être négatif"
        });
    }

    // Validation du statut
    const validStatus = ['en_attente', 'en_cours', 'termine', 'annule'];
    if (statut && !validStatus.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Valeurs acceptées: en_attente, en_cours, termine, annule"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO prestations 
             (type_prestation, prix_base, statut, coiffeur_nom, client_nom, date_prestation) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING *`,
            [
                type_prestation,
                parseFloat(prix_base),
                statut,
                coiffeur_nom,
                client_nom || null,
                date_prestation || new Date().toISOString()
            ]
        );

        res.status(201).json({
            success: true,
            message: "Prestation créée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la création de la prestation:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création de la prestation",
            error: err.message
        });
    }
});

// ✏️ PUT - Modifier une prestation
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        type_prestation,
        prix_base,
        statut,
        coiffeur_nom,
        client_nom,
        date_prestation
    } = req.body;

    // Validation du statut si fourni
    const validStatus = ['en_attente', 'en_cours', 'termine', 'annule'];
    if (statut && !validStatus.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Valeurs acceptées: en_attente, en_cours, termine, annule"
        });
    }

    if (prix_base !== undefined && prix_base < 0) {
        return res.status(400).json({
            success: false,
            message: "Le prix ne peut pas être négatif"
        });
    }

    try {
        // Vérifier si la prestation existe
        const check = await pool.query(
            `SELECT id FROM prestations WHERE id = $1`,
            [id]
        );

        if (check.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Prestation non trouvée"
            });
        }

        const result = await pool.query(
            `UPDATE prestations 
             SET 
                type_prestation = COALESCE($1, type_prestation),
                prix_base = COALESCE($2, prix_base),
                statut = COALESCE($3, statut),
                coiffeur_nom = COALESCE($4, coiffeur_nom),
                client_nom = COALESCE($5, client_nom),
                date_prestation = COALESCE($6, date_prestation)
             WHERE id = $7 
             RETURNING *`,
            [
                type_prestation,
                prix_base !== undefined ? parseFloat(prix_base) : null,
                statut,
                coiffeur_nom,
                client_nom,
                date_prestation,
                id
            ]
        );

        res.json({
            success: true,
            message: "Prestation modifiée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de la prestation:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de la prestation",
            error: err.message
        });
    }
});

// 🔄 PATCH - Mettre à jour le statut d'une prestation
router.patch("/:id/status", async (req, res) => {
    const id = req.params.id;
    const { statut } = req.body;

    if (!statut) {
        return res.status(400).json({
            success: false,
            message: "Le champ statut est requis"
        });
    }

    const validStatus = ['en_attente', 'en_cours', 'termine', 'annule'];
    if (!validStatus.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Valeurs acceptées: en_attente, en_cours, termine, annule"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE prestations 
             SET statut = $1
             WHERE id = $2 
             RETURNING *`,
            [statut, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Prestation non trouvée"
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

// 🗑️ DELETE - Supprimer une prestation
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `DELETE FROM prestations WHERE id = $1 RETURNING id, type_prestation`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Prestation non trouvée"
            });
        }

        res.json({
            success: true,
            message: "Prestation supprimée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression de la prestation:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression de la prestation",
            error: err.message
        });
    }
});

// 📊 GET - Statistiques des prestations
router.get("/statistiques/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as en_attente,
                COUNT(CASE WHEN statut = 'en_cours' THEN 1 END) as en_cours,
                COUNT(CASE WHEN statut = 'termine' THEN 1 END) as termine,
                COUNT(CASE WHEN statut = 'annule' THEN 1 END) as annule,
                COALESCE(SUM(prix_base), 0) as revenu_total,
                COALESCE(SUM(prix_base) FILTER (WHERE statut = 'termine'), 0) as revenu_termine,
                COALESCE(AVG(prix_base)::DECIMAL(10,2), 0) as prix_moyen,
                MIN(prix_base) as prix_min,
                MAX(prix_base) as prix_max,
                (
                    SELECT json_agg(DISTINCT coiffeur_nom ORDER BY coiffeur_nom)
                    FROM prestations
                ) as coiffeurs,
                (
                    SELECT json_agg(DISTINCT statut ORDER BY statut)
                    FROM prestations
                ) as statuts
            FROM prestations
        `);

        // Top prestations par type
        const topPrestations = await pool.query(`
            SELECT 
                type_prestation,
                COUNT(*) as nombre,
                COALESCE(AVG(prix_base)::DECIMAL(10,2), 0) as prix_moyen,
                SUM(prix_base) as revenu_total
            FROM prestations
            WHERE statut != 'annule'
            GROUP BY type_prestation
            ORDER BY nombre DESC
            LIMIT 10
        `);

        // Prestations par jour (derniers 30 jours)
        const prestationsParJour = await pool.query(`
            SELECT 
                DATE(date_prestation) as jour,
                COUNT(*) as nombre,
                COALESCE(SUM(prix_base), 0) as revenu
            FROM prestations
            WHERE statut != 'annule'
                AND date_prestation >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(date_prestation)
            ORDER BY jour DESC
        `);

        // Répartition par coiffeur
        const repartitionCoiffeur = await pool.query(`
            SELECT 
                coiffeur_nom,
                COUNT(*) as total_prestations,
                COALESCE(SUM(prix_base), 0) as revenu_total,
                COUNT(CASE WHEN statut = 'termine' THEN 1 END) as termine
            FROM prestations
            WHERE statut != 'annule'
            GROUP BY coiffeur_nom
            ORDER BY revenu_total DESC
        `);

        res.json({
            success: true,
            data: {
                overview: stats.rows[0],
                top_prestations: topPrestations.rows,
                prestations_par_jour: prestationsParJour.rows,
                repartition_coiffeur: repartitionCoiffeur.rows
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

// 📋 GET - Récupérer les prestations par coiffeur
router.get("/coiffeur/:nom", async (req, res) => {
    const nom = req.params.nom;
    
    try {
        const result = await pool.query(
            `SELECT 
                id,
                type_prestation,
                prix_base,
                statut,
                client_nom,
                date_prestation
            FROM prestations 
            WHERE coiffeur_nom ILIKE $1
            ORDER BY date_prestation DESC`,
            [`%${nom}%`]
        );

        // Statistiques par coiffeur
        const stats = await pool.query(
            `SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN statut = 'termine' THEN 1 END) as termine,
                COUNT(CASE WHEN statut = 'en_cours' THEN 1 END) as en_cours,
                COUNT(CASE WHEN statut = 'en_attente' THEN 1 END) as en_attente,
                COALESCE(SUM(prix_base) FILTER (WHERE statut = 'termine'), 0) as revenu,
                COALESCE(AVG(prix_base)::DECIMAL(10,2), 0) as prix_moyen
            FROM prestations 
            WHERE coiffeur_nom ILIKE $1`,
            [`%${nom}%`]
        );

        res.json({
            success: true,
            count: result.rows.length,
            stats: stats.rows[0],
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des prestations par coiffeur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer les prestations par client
router.get("/client/:nom", async (req, res) => {
    const nom = req.params.nom;
    
    try {
        const result = await pool.query(
            `SELECT 
                id,
                type_prestation,
                prix_base,
                statut,
                coiffeur_nom,
                date_prestation
            FROM prestations 
            WHERE client_nom ILIKE $1
            ORDER BY date_prestation DESC`,
            [`%${nom}%`]
        );

        // Statistiques par client
        const stats = await pool.query(
            `SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN statut = 'termine' THEN 1 END) as termine,
                COUNT(CASE WHEN statut = 'en_cours' THEN 1 END) as en_cours,
                COALESCE(SUM(prix_base) FILTER (WHERE statut = 'termine'), 0) as total_depense
            FROM prestations 
            WHERE client_nom ILIKE $1`,
            [`%${nom}%`]
        );

        res.json({
            success: true,
            count: result.rows.length,
            stats: stats.rows[0],
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des prestations par client:", err.message);
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
            groupBy = "DATE_TRUNC('month', date_prestation)";
            break;
        case 'semaine':
            groupBy = "DATE_TRUNC('week', date_prestation)";
            break;
        case 'jour':
        default:
            groupBy = "DATE(date_prestation)";
            break;
    }

    try {
        const result = await pool.query(
            `
            SELECT 
                ${groupBy} as periode,
                COUNT(*) as nombre_prestations,
                COALESCE(SUM(prix_base), 0) as revenu_total,
                COALESCE(AVG(prix_base)::DECIMAL(10,2), 0) as panier_moyen
            FROM prestations
            WHERE statut != 'annule'
                AND date_prestation >= $1
                AND date_prestation <= $2
            GROUP BY periode
            ORDER BY periode ASC
            `,
            [date_debut, date_fin]
        );

        // Total général
        const total = await pool.query(
            `
            SELECT 
                COUNT(*) as total_prestations,
                COALESCE(SUM(prix_base), 0) as revenu_total
            FROM prestations
            WHERE statut != 'annule'
                AND date_prestation >= $1
                AND date_prestation <= $2
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