import express from "express";
import pool from "../db.js";

const router = express.Router();

// 📋 GET - Récupérer tous les créneaux
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                idcreneaux,
                TO_CHAR(datecreneaux, 'YYYY-MM-DD') as datecreneaux,
                heure,
                heurefin,
                statut,
                numeroterrain,
                typeterrain,
                nomterrain,
                surfaceterrains,
                tarif,
                ville,
                quartier
             FROM creneaux 
             ORDER BY datecreneaux, heure`
        );
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des créneaux:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des créneaux",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer un créneau spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            `SELECT 
                idcreneaux,
                TO_CHAR(datecreneaux, 'YYYY-MM-DD') as datecreneaux,
                heure,
                heurefin,
                statut,
                numeroterrain,
                typeterrain,
                nomterrain,
                surfaceterrains,
                tarif,
                ville,
                quartier
             FROM creneaux 
             WHERE idcreneaux = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Créneau non trouvé"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération du créneau:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération du créneau",
            error: err.message
        });
    }
});

// ➕ POST - Ajouter un nouveau créneau
router.post("/", async (req, res) => {
    const {
        datecreneaux,
        heure,
        heurefin,
        statut,
        numeroterrain,
        typeterrain,
        nomterrain,
        surfaceterrains,
        tarif,
        ville,
        quartier
    } = req.body;

    // Validation des champs requis
    if (!datecreneaux || !heure || !statut || !numeroterrain || !tarif) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: date, heure, statut, numéro de terrain et tarif sont obligatoires"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO creneaux 
             (datecreneaux, heure, heurefin, statut, numeroterrain, typeterrain, nomterrain, surfaceterrains, tarif, ville, quartier) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
             RETURNING 
                idcreneaux,
                TO_CHAR(datecreneaux, 'YYYY-MM-DD') as datecreneaux,
                heure,
                heurefin,
                statut,
                numeroterrain,
                typeterrain,
                nomterrain,
                surfaceterrains,
                tarif,
                ville,
                quartier`,
            [
                datecreneaux,
                heure,
                heurefin || null,
                statut,
                numeroterrain,
                typeterrain || null,
                nomterrain || null,
                surfaceterrains || null,
                tarif,
                ville || null,
                quartier || null
            ]
        );

        console.log("✅ Créneau ajouté:", result.rows[0]);
        
        res.status(201).json({
            success: true,
            message: "Créneau ajouté avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de l'ajout du créneau:", err.message);
        
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: "Un créneau existe déjà pour ce terrain à cette date et heure"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'ajout du créneau",
            error: err.message
        });
    }
});

// ✏️ PUT - Modifier un créneau
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        datecreneaux,
        heure,
        heurefin,
        statut,
        numeroterrain,
        typeterrain,
        nomterrain,
        surfaceterrains,
        tarif,
        ville,
        quartier
    } = req.body;

    if (!datecreneaux || !heure || !statut || !numeroterrain || !tarif) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: date, heure, statut, numéro de terrain et tarif sont obligatoires"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE creneaux 
             SET datecreneaux = $1, 
                 heure = $2, 
                 heurefin = $3, 
                 statut = $4, 
                 numeroterrain = $5, 
                 typeterrain = $6, 
                 nomterrain = $7, 
                 surfaceterrains = $8, 
                 tarif = $9,
                 ville = $10,
                 quartier = $11
             WHERE idcreneaux = $12 
             RETURNING 
                idcreneaux,
                TO_CHAR(datecreneaux, 'YYYY-MM-DD') as datecreneaux,
                heure,
                heurefin,
                statut,
                numeroterrain,
                typeterrain,
                nomterrain,
                surfaceterrains,
                tarif,
                ville,
                quartier`,
            [
                datecreneaux,
                heure,
                heurefin || null,
                statut,
                numeroterrain,
                typeterrain || null,
                nomterrain || null,
                surfaceterrains || null,
                tarif,
                ville || null,
                quartier || null,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Créneau non trouvé"
            });
        }

        console.log("✅ Créneau modifié:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Créneau modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification du créneau:", err.message);
        
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: "Un créneau existe déjà pour ce terrain à cette date et heure"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification du créneau",
            error: err.message
        });
    }
});

// 🗑️ DELETE - Supprimer un créneau
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            `DELETE FROM creneaux 
             WHERE idcreneaux = $1 
             RETURNING 
                idcreneaux,
                TO_CHAR(datecreneaux, 'YYYY-MM-DD') as datecreneaux,
                heure,
                heurefin,
                statut,
                numeroterrain,
                typeterrain,
                nomterrain,
                surfaceterrains,
                tarif,
                ville,
                quartier`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Créneau non trouvé"
            });
        }

        console.log("✅ Créneau supprimé:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Créneau supprimé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression du créneau:", err.message);
        
        if (err.code === '23503') {
            return res.status(409).json({
                success: false,
                message: "Impossible de supprimer ce créneau car il est lié à des réservations"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression du créneau",
            error: err.message
        });
    }
});

// 🔍 GET - Filtrer les créneaux par date, statut, etc.
router.get("/filtre/recherche", async (req, res) => {
    const { date, statut, terrain, ville, quartier } = req.query;
    
    try {
        let sql = `
            SELECT 
                idcreneaux,
                TO_CHAR(datecreneaux, 'YYYY-MM-DD') as datecreneaux,
                heure,
                heurefin,
                statut,
                numeroterrain,
                typeterrain,
                nomterrain,
                surfaceterrains,
                tarif,
                ville,
                quartier
            FROM creneaux 
            WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;

        if (date) {
            paramCount++;
            sql += ` AND datecreneaux = $${paramCount}`;
            params.push(date);
        }

        if (statut) {
            paramCount++;
            sql += ` AND statut = $${paramCount}`;
            params.push(statut);
        }

        if (terrain) {
            paramCount++;
            sql += ` AND numeroterrain = $${paramCount}`;
            params.push(terrain);
        }

        if (ville) {
            paramCount++;
            sql += ` AND ville = $${paramCount}`;
            params.push(ville);
        }

        if (quartier) {
            paramCount++;
            sql += ` AND quartier = $${paramCount}`;
            params.push(quartier);
        }

        sql += " ORDER BY datecreneaux, heure";

        const result = await pool.query(sql, params);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors du filtrage des créneaux:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors du filtrage des créneaux",
            error: err.message
        });
    }
});

// 📊 GET - Statistiques des créneaux
router.get("/statistiques/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN statut = 'disponible' THEN 1 END) as disponibles,
                COUNT(CASE WHEN statut = 'réservé' THEN 1 END) as reserves,
                COUNT(CASE WHEN statut = 'maintenance' THEN 1 END) as maintenance,
                COUNT(DISTINCT numeroterrain) as terrains_actifs,
                AVG(tarif) as tarif_moyen,
                COUNT(DISTINCT ville) as villes_disponibles
            FROM creneaux
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

export default router;