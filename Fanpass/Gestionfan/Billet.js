import express from "express";
const router = express.Router();
import db from "../../db.js";


// ============================================
// CREATE - Ajouter un billet
// ============================================
router.post("/", async (req, res) => {
    try {
        const {
            nom_supporter,
            prenom_supporter,
            email,
            equipe_1,
            equipe_2,
            phase_match,
            edition,
            stade,
            ville,
            date_match,
            heure_match,
            type_billet,
            porte,
            tribune,
            rang,
            siege,
            qr_code,
            statut_billet,
            creneau_debut,
            creneau_fin
        } = req.body;

        const result = await db.query(
            `INSERT INTO billets (
                nom_supporter, prenom_supporter, email,
                equipe_1, equipe_2,
                phase_match, edition,
                stade, ville,
                date_match, heure_match,
                type_billet,
                porte, tribune, rang, siege,
                qr_code, statut_billet,
                creneau_debut, creneau_fin
            )
            VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                $11,$12,$13,$14,$15,$16,$17,$18,$19,$20
            )
            RETURNING *`,
            [
                nom_supporter,
                prenom_supporter,
                email,
                equipe_1,
                equipe_2,
                phase_match,
                edition,
                stade,
                ville,
                date_match,
                heure_match,
                type_billet,
                porte,
                tribune,
                rang,
                siege,
                qr_code,
                statut_billet || "actif",
                creneau_debut,
                creneau_fin
            ]
        );

        res.status(201).json({
            success: true,
            message: "Billet créé avec succès",
            data: result.rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la création du billet",
            error: error.message
        });
    }
});


// ============================================
// READ ALL - Tous les billets
// ============================================
router.get("/", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM billets ORDER BY date_creation DESC`
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Erreur récupération billets",
            error: error.message
        });
    }
});


// ============================================
// READ ONE - Par ID
// ============================================
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `SELECT * FROM billets WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Billet introuvable"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Erreur récupération billet",
            error: error.message
        });
    }
});


// ============================================
// READ ONE - Par QR CODE (très utile pour scan)
// ============================================
router.get("/qr/:qr_code", async (req, res) => {
    try {
        const { qr_code } = req.params;

        const result = await db.query(
            `SELECT * FROM billets WHERE qr_code = $1`,
            [qr_code]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "QR code invalide"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Erreur scan QR",
            error: error.message
        });
    }
});


// ============================================
// UPDATE - Modifier un billet
// ============================================
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const {
            nom_supporter,
            prenom_supporter,
            email,
            equipe_1,
            equipe_2,
            phase_match,
            edition,
            stade,
            ville,
            date_match,
            heure_match,
            type_billet,
            porte,
            tribune,
            rang,
            siege,
            statut_billet,
            creneau_debut,
            creneau_fin
        } = req.body;

        const result = await db.query(
            `UPDATE billets SET
                nom_supporter = $1,
                prenom_supporter = $2,
                email = $3,
                equipe_1 = $4,
                equipe_2 = $5,
                phase_match = $6,
                edition = $7,
                stade = $8,
                ville = $9,
                date_match = $10,
                heure_match = $11,
                type_billet = $12,
                porte = $13,
                tribune = $14,
                rang = $15,
                siege = $16,
                statut_billet = $17,
                creneau_debut = $18,
                creneau_fin = $19
            WHERE id = $20
            RETURNING *`,
            [
                nom_supporter,
                prenom_supporter,
                email,
                equipe_1,
                equipe_2,
                phase_match,
                edition,
                stade,
                ville,
                date_match,
                heure_match,
                type_billet,
                porte,
                tribune,
                rang,
                siege,
                statut_billet,
                creneau_debut,
                creneau_fin,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Billet introuvable"
            });
        }

        res.json({
            success: true,
            message: "Billet mis à jour",
            data: result.rows[0]
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Erreur update billet",
            error: error.message
        });
    }
});


// ============================================
// DELETE - Supprimer un billet
// ============================================
router.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `DELETE FROM billets WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Billet introuvable"
            });
        }

        res.json({
            success: true,
            message: "Billet supprimé",
            data: result.rows[0]
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Erreur suppression billet",
            error: error.message
        });
    }
});

export default router;