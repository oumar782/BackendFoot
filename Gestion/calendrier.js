// routes/calendriers.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// CREATE - Créer une nouvelle entrée calendrier
router.post("/", async (req, res) => {
    const {
        date,
        nomterrain,
        statut,
        periode  // ✅ Ajouté ici
    } = req.body;

    // Validation des champs requis
    if (!date) {
        return res.status(400).json({
            success: false,
            message: "Le champ date est obligatoire"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO calendriers 
             (date, nomterrain, statut, periode) 
             VALUES ($1, $2, $3, $4) 
             RETURNING *`,
            [
                date,
                nomterrain || null,
                statut || 'disponible',  // ✅ Valeur par défaut
                periode || 'matin'       // ✅ Valeur par défaut pour periode
            ]
        );

        console.log("✅ Entrée calendrier créée:", result.rows[0]);
        
        res.status(201).json({
            success: true,
            message: "Entrée calendrier créée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la création de l'entrée calendrier:", err.message);
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création de l'entrée calendrier",
            error: err.message
        });
    }
});

// READ - Récupérer toutes les entrées calendrier
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM calendriers ORDER BY date DESC"
        );
        
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des entrées calendrier:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des entrées calendrier",
            error: err.message
        });
    }
});

// READ - Récupérer une entrée calendrier spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            "SELECT * FROM calendriers WHERE id = $1",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Entrée calendrier non trouvée"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération de l'entrée calendrier:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération de l'entrée calendrier",
            error: err.message
        });
    }
});

// READ - Récupérer les entrées calendrier par date
router.get("/date/:date", async (req, res) => {
    const date = req.params.date;
    
    try {
        const result = await pool.query(
            "SELECT * FROM calendriers WHERE date = $1 ORDER BY id",
            [date]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération par date:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération par date",
            error: err.message
        });
    }
});

// READ - Récupérer les entrées calendrier par nom de terrain
router.get("/terrain/:nomterrain", async (req, res) => {
    const nomterrain = req.params.nomterrain;
    
    try {
        const result = await pool.query(
            "SELECT * FROM calendriers WHERE nomterrain = $1 ORDER BY date DESC",
            [nomterrain]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération par terrain:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération par terrain",
            error: err.message
        });
    }
});

// UPDATE - Modifier une entrée calendrier
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        date,
        nomterrain,
        statut,
        periode  // ✅ Ajouté ici
    } = req.body;

    // Validation des champs requis
    if (!date) {
        return res.status(400).json({
            success: false,
            message: "Le champ date est obligatoire"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE calendriers 
             SET date = $1, nomterrain = $2, statut = $3, periode = $4
             WHERE id = $5 
             RETURNING *`,
            [
                date,
                nomterrain || null,
                statut || 'disponible',
                periode || 'matin',  // ✅ Valeur par défaut
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Entrée calendrier non trouvée"
            });
        }

        console.log("✅ Entrée calendrier modifiée:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Entrée calendrier modifiée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de l'entrée calendrier:", err.message);
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de l'entrée calendrier",
            error: err.message
        });
    }
});

// DELETE - Supprimer une entrée calendrier
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            "DELETE FROM calendriers WHERE id = $1 RETURNING *",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Entrée calendrier non trouvée"
            });
        }

        console.log("✅ Entrée calendrier supprimée:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Entrée calendrier supprimée avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression de l'entrée calendrier:", err.message);
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression de l'entrée calendrier",
            error: err.message
        });
    }
});

// DELETE - Supprimer les entrées calendrier par date
router.delete("/date/:date", async (req, res) => {
    const date = req.params.date;

    try {
        const result = await pool.query(
            "DELETE FROM calendriers WHERE date = $1 RETURNING *",
            [date]
        );

        res.json({
            success: true,
            message: `${result.rows.length} entrée(s) calendrier supprimée(s) avec succès`,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression par date:", err.message);
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression par date",
            error: err.message
        });
    }
});

// GET - Récupérer les entrées calendrier par plage de dates
router.get("/plage/:startDate/:endDate", async (req, res) => {
    const { startDate, endDate } = req.params;
    
    try {
        const result = await pool.query(
            "SELECT * FROM calendriers WHERE date BETWEEN $1 AND $2 ORDER BY date",
            [startDate, endDate]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération par plage de dates:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération par plage de dates",
            error: err.message
        });
    }
});

// GET - Statistiques des calendriers
router.get("/statistiques/overview", async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_entrees,
                COUNT(DISTINCT date) as jours_uniques,
                COUNT(DISTINCT nomterrain) as terrains_differents,
                MIN(date) as date_min,
                MAX(date) as date_max
            FROM calendriers
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