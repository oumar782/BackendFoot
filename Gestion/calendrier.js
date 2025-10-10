// routes/calendriers.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// CREATE - Créer une nouvelle entrée calendrier
router.post("/", async (req, res) => {
    const {
        date_debut,
        heure_debut,
        date_fin,
        heure_fin,
        nom_terrain
    } = req.body;

    // Validation des champs requis
    if (!date_debut || !date_fin || !heure_fin || !nom_terrain) {
        return res.status(400).json({
            success: false,
            message: "Les champs date_debut, date_fin, heure_fin et nom_terrain sont obligatoires"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO calendriers 
             (date_debut, heure_debut, date_fin, heure_fin, nom_terrain) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING *`,
            [
                date_debut,
                heure_debut || '09:00',  // Valeur par défaut
                date_fin,
                heure_fin,
                nom_terrain
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
            "SELECT * FROM calendriers ORDER BY date_debut DESC, heure_debut DESC"
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

// READ - Récupérer les entrées calendrier par date de début
router.get("/date-debut/:date_debut", async (req, res) => {
    const date_debut = req.params.date_debut;
    
    try {
        const result = await pool.query(
            "SELECT * FROM calendriers WHERE date_debut = $1 ORDER BY heure_debut",
            [date_debut]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération par date de début:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération par date de début",
            error: err.message
        });
    }
});

// READ - Récupérer les entrées calendrier par nom de terrain
router.get("/terrain/:nom_terrain", async (req, res) => {
    const nom_terrain = req.params.nom_terrain;
    
    try {
        const result = await pool.query(
            "SELECT * FROM calendriers WHERE nom_terrain = $1 ORDER BY date_debut DESC, heure_debut DESC",
            [nom_terrain]
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
        date_debut,
        heure_debut,
        date_fin,
        heure_fin,
        nom_terrain
    } = req.body;

    // Validation des champs requis
    if (!date_debut || !date_fin || !heure_fin || !nom_terrain) {
        return res.status(400).json({
            success: false,
            message: "Les champs date_debut, date_fin, heure_fin et nom_terrain sont obligatoires"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE calendriers 
             SET date_debut = $1, heure_debut = $2, date_fin = $3, heure_fin = $4, nom_terrain = $5
             WHERE id = $6 
             RETURNING *`,
            [
                date_debut,
                heure_debut || '09:00',
                date_fin,
                heure_fin,
                nom_terrain,
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

// DELETE - Supprimer les entrées calendrier par date de début
router.delete("/date-debut/:date_debut", async (req, res) => {
    const date_debut = req.params.date_debut;

    try {
        const result = await pool.query(
            "DELETE FROM calendriers WHERE date_debut = $1 RETURNING *",
            [date_debut]
        );

        res.json({
            success: true,
            message: `${result.rows.length} entrée(s) calendrier supprimée(s) avec succès`,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression par date de début:", err.message);
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression par date de début",
            error: err.message
        });
    }
});

// GET - Récupérer les entrées calendrier par plage de dates
router.get("/plage/:startDate/:endDate", async (req, res) => {
    const { startDate, endDate } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT * FROM calendriers 
             WHERE date_debut BETWEEN $1 AND $2 
             OR date_fin BETWEEN $1 AND $2
             ORDER BY date_debut, heure_debut`,
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

// GET - Récupérer les créneaux disponibles pour un terrain et une date
router.get("/disponibilites/:nom_terrain/:date", async (req, res) => {
    const { nom_terrain, date } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT * FROM calendriers 
             WHERE nom_terrain = $1 
             AND date_debut = $2
             ORDER BY heure_debut`,
            [nom_terrain, date]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des disponibilités:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des disponibilités",
            error: err.message
        });
    }
});

// GET - Vérifier les conflits de réservation
router.get("/conflits/:nom_terrain/:date_debut/:heure_debut/:date_fin/:heure_fin", async (req, res) => {
    const { nom_terrain, date_debut, heure_debut, date_fin, heure_fin } = req.params;
    
    try {
        const result = await pool.query(
            `SELECT * FROM calendriers 
             WHERE nom_terrain = $1 
             AND (
                 (date_debut = $2 AND heure_debut < $4) OR
                 (date_fin = $3 AND heure_fin > $5) OR
                 (date_debut BETWEEN $2 AND $3)
             )
             AND id != COALESCE($6, -1)`,
            [nom_terrain, date_debut, date_fin, heure_fin, heure_debut, req.query.exclude_id || -1]
        );

        res.json({
            success: true,
            hasConflit: result.rows.length > 0,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la vérification des conflits:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la vérification des conflits",
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
                COUNT(DISTINCT date_debut) as jours_debut_uniques,
                COUNT(DISTINCT nom_terrain) as terrains_differents,
                MIN(date_debut) as date_min,
                MAX(date_fin) as date_max
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