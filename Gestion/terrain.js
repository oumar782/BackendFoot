// routes/terrains.js
import express from "express";
import pool from "../db.js";
import { requireAuth, requireManagerOrAdmin, isAdmin } from './Auth.js';
import { ownedTerrain, tenantFilter } from '../middleware/tenant.js';

const router = express.Router();
router.use(requireAuth, requireManagerOrAdmin);

// CREATE - Créer un nouveau terrain
router.post("/", async (req, res) => {
    const {
        nomterrain,
        typeTerrain,
        surface,
        descriptions,
        tarif,
        equipementdispo,
        photo,
        idclient, manager_id, ville, quartier
    } = req.body;

    // Validation des champs requis
    if (!nomterrain || !typeTerrain || !surface || !tarif) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: nomterrain, typeTerrain, surface et tarif sont obligatoires"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO terrains 
             (nomterrain, typeTerrain, surface, descriptions, tarif, equipementdispo, photo, idclient, manager_id, ville, quartier) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
             RETURNING *`,
            [
                nomterrain,
                typeTerrain,
                surface,
                descriptions || null,
                tarif,
                equipementdispo || null,
                photo || null,
                idclient || null,
                isAdmin(req.user) ? (manager_id || null) : req.user.managerId,
                ville || null,
                quartier || null
            ]
        );

        console.log("✅ Terrain créé:", result.rows[0]);
        
        res.status(201).json({
            success: true,
            message: "Terrain créé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la création du terrain:", err.message);
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création du terrain",
            error: err.message
        });
    }
});

// READ - Récupérer tous les terrains
router.get("/", async (req, res) => {
    try {
        const scope = tenantFilter(req, 'manager_id');
        const result = await pool.query(`SELECT * FROM terrains WHERE 1=1${scope.sql} ORDER BY numeroterrain`, scope.params);
        
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des terrains:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des terrains",
            error: err.message
        });
    }
});

// READ - Récupérer un terrain spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const terrain = await ownedTerrain(pool, req, id);

        if (!terrain) {
            return res.status(404).json({
                success: false,
                message: "Terrain non trouvé"
            });
        }

        res.json({
            success: true,
            data: terrain
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération du terrain:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération du terrain",
            error: err.message
        });
    }
});

// UPDATE - Modifier un terrain
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        nomterrain,
        typeTerrain,
        surface,
        descriptions,
        tarif,
        equipementdispo,
        photo,
        idclient
    } = req.body;

    // Validation des champs requis
    if (!nomterrain || !typeTerrain || !surface || !tarif) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: nomterrain, typeTerrain, surface et tarif sont obligatoires"
        });
    }

    try {
        if (!await ownedTerrain(pool, req, id)) {
            return res.status(404).json({ success: false, message: "Terrain non trouvé" });
        }
        const result = await pool.query(
            `UPDATE terrains 
             SET nomterrain = $1, typeTerrain = $2, surface = $3, descriptions = $4, 
                 tarif = $5, equipementdispo = $6, photo = $7, idclient = $8
             WHERE numeroterrain = $9 
             RETURNING *`,
            [
                nomterrain,
                typeTerrain,
                surface,
                descriptions || null,
                tarif,
                equipementdispo || null,
                photo || null,
                idclient || null,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Terrain non trouvé"
            });
        }

        console.log("✅ Terrain modifié:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Terrain modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification du terrain:", err.message);
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification du terrain",
            error: err.message
        });
    }
});

// DELETE - Supprimer un terrain
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        if (!await ownedTerrain(pool, req, id)) {
            return res.status(404).json({ success: false, message: "Terrain non trouvé" });
        }
        const result = await pool.query(
            "DELETE FROM terrains WHERE numeroterrain = $1 RETURNING *",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Terrain non trouvé"
            });
        }

        console.log("✅ Terrain supprimé:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Terrain supprimé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression du terrain:", err.message);
        
        if (err.code === '23503') {
            return res.status(409).json({
                success: false,
                message: "Impossible de supprimer ce terrain car il est lié à des créneaux ou réservations"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression du terrain",
            error: err.message
        });
    }
});

export default router;
