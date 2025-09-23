import express from "express";
import pool from "../db.js";

const router = express.Router();

// CREATE - Créer un nouveau client
router.post("/", async (req, res) => {
    const {
        nom,
        prenom,
        email,
        telephone,
        statut = 'actif' // Valeur par défaut
    } = req.body;

    // Validation des champs requis
    if (!nom || !prenom || !email || !telephone) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: nom, prenom, email et telephone sont obligatoires"
        });
    }

    // Validation du format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Format d'email invalide"
        });
    }

    // Validation du statut
    const statutsValides = ['actif', 'inactif', 'en attente'];
    if (statut && !statutsValides.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Les valeurs autorisées sont: actif, inactif, en attente"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO clients 
             (nom, prenom, email, telephone, statut) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING *`,
            [
                nom,
                prenom,
                email,
                telephone,
                statut
            ]
        );

        console.log("✅ Client créé:", result.rows[0]);
        
        res.status(201).json({
            success: true,
            message: "Client créé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la création du client:", err.message);
        
        if (err.code === '23505') { // violation de contrainte unique (email)
            return res.status(409).json({
                success: false,
                message: "Un client avec cet email existe déjà"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création du client",
            error: err.message
        });
    }
});

// READ - Récupérer tous les clients
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM clients ORDER BY nom, prenom"
        );
        
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des clients:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des clients",
            error: err.message
        });
    }
});

// READ - Récupérer les clients par statut
router.get("/statut/:statut", async (req, res) => {
    const statut = req.params.statut;
    const statutsValides = ['actif', 'inactif', 'en attente'];
    
    if (!statutsValides.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Les valeurs autorisées sont: actif, inactif, en attente"
        });
    }

    try {
        const result = await pool.query(
            "SELECT * FROM clients WHERE statut = $1 ORDER BY nom, prenom",
            [statut]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des clients par statut:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des clients",
            error: err.message
        });
    }
});

// READ - Récupérer un client spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            "SELECT * FROM clients WHERE idclient = $1",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération du client:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération du client",
            error: err.message
        });
    }
});

// READ - Récupérer un client par email
router.get("/email/:email", async (req, res) => {
    const email = req.params.email;
    
    try {
        const result = await pool.query(
            "SELECT * FROM clients WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération du client:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération du client",
            error: err.message
        });
    }
});

// UPDATE - Modifier un client
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        nom,
        prenom,
        email,
        telephone,
        statut
    } = req.body;

    // Validation des champs requis
    if (!nom || !prenom || !email || !telephone) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: nom, prenom, email et telephone sont obligatoires"
        });
    }

    // Validation du format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Format d'email invalide"
        });
    }

    // Validation du statut
    const statutsValides = ['actif', 'inactif', 'en attente'];
    if (statut && !statutsValides.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide. Les valeurs autorisées sont: actif, inactif, en attente"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE clients 
             SET nom = $1, prenom = $2, email = $3, telephone = $4, statut = $5
             WHERE idclient = $6 
             RETURNING *`,
            [
                nom,
                prenom,
                email,
                telephone,
                statut,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        console.log("✅ Client modifié:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Client modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification du client:", err.message);
        
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: "Un client avec cet email existe déjà"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification du client",
            error: err.message
        });
    }
});

// UPDATE - Modifier uniquement le statut d'un client
router.patch("/:id/statut", async (req, res) => {
    const id = req.params.id;
    const { statut } = req.body;

    // Validation du statut
    const statutsValides = ['actif', 'inactif', 'en attente'];
    if (!statut || !statutsValides.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: "Statut invalide ou manquant. Les valeurs autorisées sont: actif, inactif, en attente"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE clients 
             SET statut = $1
             WHERE idclient = $2 
             RETURNING *`,
            [statut, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        console.log("✅ Statut client modifié:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Statut client modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification du statut:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification du statut",
            error: err.message
        });
    }
});

// DELETE - Supprimer un client
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            "DELETE FROM clients WHERE idclient = $1 RETURNING *",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        console.log("✅ Client supprimé:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Client supprimé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression du client:", err.message);
        
        if (err.code === '23503') {
            return res.status(409).json({
                success: false,
                message: "Impossible de supprimer ce client car il est lié à des réservations ou terrains"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression du client",
            error: err.message
        });
    }
});

// SEARCH - Rechercher des clients par nom, prénom, email ou statut
router.get("/recherche/:term", async (req, res) => {
    const term = req.params.term;
    
    try {
        const result = await pool.query(
            `SELECT * FROM clients 
             WHERE nom ILIKE $1 OR prenom ILIKE $1 OR email ILIKE $1 OR statut ILIKE $1
             ORDER BY nom, prenom`,
            [`%${term}%`]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la recherche des clients:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la recherche des clients",
            error: err.message
        });
    }
});

export default router;