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
        statut = 'actif',
        type_abonnement = null,
        date_debut = null,
        date_fin = null,
        prix_total = null,
        mode_paiement = null,
        photo_abonne = null,
        heure_reservation = null
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

    // Validation du type d'abonnement si fourni
    const typesAbonnementValides = ['mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel', null];
    if (type_abonnement && !typesAbonnementValides.includes(type_abonnement)) {
        return res.status(400).json({
            success: false,
            message: "Type d'abonnement invalide. Valeurs autorisées: mensuel, trimestriel, semestriel, annuel, ponctuel"
        });
    }

    // Validation des dates si fournies
    if (date_debut && date_fin) {
        const debut = new Date(date_debut);
        const fin = new Date(date_fin);
        if (debut > fin) {
            return res.status(400).json({
                success: false,
                message: "La date de début doit être antérieure à la date de fin"
            });
        }
    }

    // Validation du prix total si fourni
    if (prix_total !== null && prix_total < 0) {
        return res.status(400).json({
            success: false,
            message: "Le prix total ne peut pas être négatif"
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO clients 
             (nom, prenom, email, telephone, statut, type_abonnement, 
              date_debut, date_fin, prix_total, mode_paiement, photo_abonne, heure_reservation) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
             RETURNING *`,
            [
                nom,
                prenom,
                email,
                telephone,
                statut,
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                mode_paiement,
                photo_abonne,
                heure_reservation
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

// READ - Récupérer les clients par type d'abonnement
router.get("/abonnement/:type", async (req, res) => {
    const type = req.params.type;
    const typesValides = ['mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'];
    
    if (!typesValides.includes(type)) {
        return res.status(400).json({
            success: false,
            message: "Type d'abonnement invalide. Valeurs autorisées: mensuel, trimestriel, semestriel, annuel, ponctuel"
        });
    }

    try {
        const result = await pool.query(
            "SELECT * FROM clients WHERE type_abonnement = $1 ORDER BY nom, prenom",
            [type]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des clients par type d'abonnement:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des clients",
            error: err.message
        });
    }
});

// READ - Récupérer les clients avec abonnement actif (date actuelle entre date_debut et date_fin)
router.get("/abonnement-actif/actifs", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM clients 
             WHERE type_abonnement IS NOT NULL 
             AND date_debut <= CURRENT_DATE 
             AND date_fin >= CURRENT_DATE
             AND statut = 'actif'
             ORDER BY nom, prenom`
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des clients avec abonnement actif:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des clients",
            error: err.message
        });
    }
});

// READ - Récupérer les clients avec abonnement expiré
router.get("/abonnement-expire/expires", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM clients 
             WHERE type_abonnement IS NOT NULL 
             AND date_fin < CURRENT_DATE
             AND statut = 'actif'
             ORDER BY date_fin DESC`
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des clients avec abonnement expiré:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des clients",
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
        statut,
        type_abonnement,
        date_debut,
        date_fin,
        prix_total,
        mode_paiement,
        photo_abonne,
        heure_reservation
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

    // Validation du type d'abonnement
    const typesAbonnementValides = ['mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel', null];
    if (type_abonnement && !typesAbonnementValides.includes(type_abonnement)) {
        return res.status(400).json({
            success: false,
            message: "Type d'abonnement invalide. Valeurs autorisées: mensuel, trimestriel, semestriel, annuel, ponctuel"
        });
    }

    // Validation des dates
    if (date_debut && date_fin) {
        const debut = new Date(date_debut);
        const fin = new Date(date_fin);
        if (debut > fin) {
            return res.status(400).json({
                success: false,
                message: "La date de début doit être antérieure à la date de fin"
            });
        }
    }

    // Validation du prix total
    if (prix_total !== null && prix_total < 0) {
        return res.status(400).json({
            success: false,
            message: "Le prix total ne peut pas être négatif"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE clients 
             SET nom = $1, prenom = $2, email = $3, telephone = $4, statut = $5,
                 type_abonnement = $6, date_debut = $7, date_fin = $8, prix_total = $9,
                 mode_paiement = $10, photo_abonne = $11, heure_reservation = $12
             WHERE idclient = $13 
             RETURNING *`,
            [
                nom,
                prenom,
                email,
                telephone,
                statut,
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                mode_paiement,
                photo_abonne,
                heure_reservation,
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

// UPDATE - Modifier les informations d'abonnement
router.patch("/:id/abonnement", async (req, res) => {
    const id = req.params.id;
    const {
        type_abonnement,
        date_debut,
        date_fin,
        prix_total,
        mode_paiement
    } = req.body;

    // Validation du type d'abonnement
    const typesAbonnementValides = ['mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel', null];
    if (type_abonnement && !typesAbonnementValides.includes(type_abonnement)) {
        return res.status(400).json({
            success: false,
            message: "Type d'abonnement invalide. Valeurs autorisées: mensuel, trimestriel, semestriel, annuel, ponctuel"
        });
    }

    // Validation des dates si fournies
    if (date_debut && date_fin) {
        const debut = new Date(date_debut);
        const fin = new Date(date_fin);
        if (debut > fin) {
            return res.status(400).json({
                success: false,
                message: "La date de début doit être antérieure à la date de fin"
            });
        }
    }

    // Validation du prix total si fourni
    if (prix_total !== null && prix_total < 0) {
        return res.status(400).json({
            success: false,
            message: "Le prix total ne peut pas être négatif"
        });
    }

    try {
        // Construction dynamique de la requête UPDATE
        let query = `UPDATE clients SET `;
        const values = [];
        const setClauses = [];
        let paramIndex = 1;

        if (type_abonnement !== undefined) {
            setClauses.push(`type_abonnement = $${paramIndex}`);
            values.push(type_abonnement);
            paramIndex++;
        }

        if (date_debut !== undefined) {
            setClauses.push(`date_debut = $${paramIndex}`);
            values.push(date_debut);
            paramIndex++;
        }

        if (date_fin !== undefined) {
            setClauses.push(`date_fin = $${paramIndex}`);
            values.push(date_fin);
            paramIndex++;
        }

        if (prix_total !== undefined) {
            setClauses.push(`prix_total = $${paramIndex}`);
            values.push(prix_total);
            paramIndex++;
        }

        if (mode_paiement !== undefined) {
            setClauses.push(`mode_paiement = $${paramIndex}`);
            values.push(mode_paiement);
            paramIndex++;
        }

        if (setClauses.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Aucun champ à modifier"
            });
        }

        query += setClauses.join(", ");
        query += ` WHERE idclient = $${paramIndex} RETURNING *`;
        values.push(id);

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        console.log("✅ Abonnement client modifié:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Informations d'abonnement modifiées avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de l'abonnement:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de l'abonnement",
            error: err.message
        });
    }
});

// UPDATE - Mettre à jour la photo d'un abonné
router.patch("/:id/photo", async (req, res) => {
    const id = req.params.id;
    const { photo_abonne } = req.body;

    if (!photo_abonne) {
        return res.status(400).json({
            success: false,
            message: "URL de la photo requise"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE clients 
             SET photo_abonne = $1
             WHERE idclient = $2 
             RETURNING *`,
            [photo_abonne, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        console.log("✅ Photo client modifiée:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Photo mise à jour avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de la photo:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de la photo",
            error: err.message
        });
    }
});

// UPDATE - Mettre à jour l'heure de réservation
router.patch("/:id/heure-reservation", async (req, res) => {
    const id = req.params.id;
    const { heure_reservation } = req.body;

    if (!heure_reservation) {
        return res.status(400).json({
            success: false,
            message: "Heure de réservation requise"
        });
    }

    // Validation du format de l'heure
    const heureRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (!heureRegex.test(heure_reservation)) {
        return res.status(400).json({
            success: false,
            message: "Format d'heure invalide. Utilisez HH:MM ou HH:MM:SS"
        });
    }

    try {
        const result = await pool.query(
            `UPDATE clients 
             SET heure_reservation = $1
             WHERE idclient = $2 
             RETURNING *`,
            [heure_reservation, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client non trouvé"
            });
        }

        console.log("✅ Heure de réservation modifiée:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Heure de réservation mise à jour avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de l'heure de réservation:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de l'heure de réservation",
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

// SEARCH - Rechercher des clients par nom, prénom, email, statut ou type d'abonnement
router.get("/recherche/:term", async (req, res) => {
    const term = req.params.term;
    
    try {
        const result = await pool.query(
            `SELECT * FROM clients 
             WHERE nom ILIKE $1 OR prenom ILIKE $1 OR email ILIKE $1 OR 
                   statut ILIKE $1 OR type_abonnement ILIKE $1 OR mode_paiement ILIKE $1
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

// STATISTIQUES - Obtenir les statistiques des clients
router.get("/statistiques/totales", async (req, res) => {
    try {
        const [
            totalClients,
            clientsActifs,
            clientsInactifs,
            clientsParStatut,
            clientsParAbonnement,
            revenuTotal,
        ] = await Promise.all([
            pool.query("SELECT COUNT(*) as total FROM clients"),
            pool.query("SELECT COUNT(*) as actifs FROM clients WHERE statut = 'actif'"),
            pool.query("SELECT COUNT(*) as inactifs FROM clients WHERE statut = 'inactif'"),
            pool.query("SELECT statut, COUNT(*) as count FROM clients GROUP BY statut"),
            pool.query("SELECT type_abonnement, COUNT(*) as count FROM clients WHERE type_abonnement IS NOT NULL GROUP BY type_abonnement"),
            pool.query("SELECT COALESCE(SUM(prix_total), 0) as total FROM clients WHERE prix_total IS NOT NULL"),
        ]);

        const statistiques = {
            total: parseInt(totalClients.rows[0].total),
            actifs: parseInt(clientsActifs.rows[0].actifs),
            inactifs: parseInt(clientsInactifs.rows[0].inactifs),
            parStatut: clientsParStatut.rows,
            parAbonnement: clientsParAbonnement.rows,
            revenuTotal: parseFloat(revenuTotal.rows[0].total)
        };

        res.json({
            success: true,
            data: statistiques
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

// FILTRES AVANCÉS - Recherche avec filtres multiples
router.post("/filtres/avances", async (req, res) => {
    const {
        statut,
        type_abonnement,
        date_debut_min,
        date_debut_max,
        date_fin_min,
        date_fin_max,
        prix_min,
        prix_max,
        mode_paiement
    } = req.body;

    try {
        let query = "SELECT * FROM clients WHERE 1=1";
        const values = [];
        let paramIndex = 1;

        if (statut) {
            query += ` AND statut = $${paramIndex}`;
            values.push(statut);
            paramIndex++;
        }

        if (type_abonnement) {
            query += ` AND type_abonnement = $${paramIndex}`;
            values.push(type_abonnement);
            paramIndex++;
        }

        if (date_debut_min) {
            query += ` AND date_debut >= $${paramIndex}`;
            values.push(date_debut_min);
            paramIndex++;
        }

        if (date_debut_max) {
            query += ` AND date_debut <= $${paramIndex}`;
            values.push(date_debut_max);
            paramIndex++;
        }

        if (date_fin_min) {
            query += ` AND date_fin >= $${paramIndex}`;
            values.push(date_fin_min);
            paramIndex++;
        }

        if (date_fin_max) {
            query += ` AND date_fin <= $${paramIndex}`;
            values.push(date_fin_max);
            paramIndex++;
        }

        if (prix_min !== undefined) {
            query += ` AND prix_total >= $${paramIndex}`;
            values.push(prix_min);
            paramIndex++;
        }

        if (prix_max !== undefined) {
            query += ` AND prix_total <= $${paramIndex}`;
            values.push(prix_max);
            paramIndex++;
        }

        if (mode_paiement) {
            query += ` AND mode_paiement = $${paramIndex}`;
            values.push(mode_paiement);
            paramIndex++;
        }

        query += " ORDER BY nom, prenom";

        const result = await pool.query(query, values);

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la recherche filtrée:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la recherche filtrée",
            error: err.message
        });
    }
});

export default router;