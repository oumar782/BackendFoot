// routes/users.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

// 📋 GET - Récupérer tous les utilisateurs
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT iduser, nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport FROM users ORDER BY nom, prenom"
        );
        
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération des utilisateurs:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération des utilisateurs",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer un utilisateur spécifique par ID
router.get("/:id", async (req, res) => {
    const id = req.params.id;
    
    try {
        const result = await pool.query(
            "SELECT iduser, nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport FROM users WHERE iduser = $1",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur non trouvé"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération de l'utilisateur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération de l'utilisateur",
            error: err.message
        });
    }
});

// 📋 GET - Récupérer un utilisateur par email
router.get("/email/:email", async (req, res) => {
    const email = req.params.email;
    
    try {
        const result = await pool.query(
            "SELECT iduser, nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur non trouvé"
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la récupération de l'utilisateur:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la récupération de l'utilisateur",
            error: err.message
        });
    }
});

// ➕ POST - Créer un nouvel utilisateur
router.post("/", async (req, res) => {
    const {
        nom,
        prenom,
        email,
        telephone,
        typeuser,
        idins,
        idcreneaux,
        numeroterrain,
        idrapport,
        mdp
    } = req.body;

    // Validation des champs requis
    if (!nom || !prenom || !email || !telephone || !typeuser || !mdp) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: nom, prenom, email, telephone, typeuser et mdp sont obligatoires"
        });
    }

    try {
        // Hasher le mot de passe
        const hashedPassword = await bcrypt.hash(mdp, 10);

        const result = await pool.query(
            `INSERT INTO users 
             (nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport, mdp) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
             RETURNING iduser, nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport`,
            [
                nom,
                prenom,
                email,
                telephone,
                typeuser,
                idins || null,
                idcreneaux || null,
                numeroterrain || null,
                idrapport || null,
                hashedPassword
            ]
        );

        console.log("✅ Utilisateur créé:", result.rows[0]);
        
        res.status(201).json({
            success: true,
            message: "Utilisateur créé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la création de l'utilisateur:", err.message);
        
        if (err.code === '23505') { // violation de contrainte unique (email)
            return res.status(409).json({
                success: false,
                message: "Un utilisateur avec cet email existe déjà"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la création de l'utilisateur",
            error: err.message
        });
    }
});

// ✏️ PUT - Modifier un utilisateur
router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const {
        nom,
        prenom,
        email,
        telephone,
        typeuser,
        idins,
        idcreneaux,
        numeroterrain,
        idrapport,
        mdp
    } = req.body;

    // Validation des champs requis
    if (!nom || !prenom || !email || !telephone || !typeuser) {
        return res.status(400).json({
            success: false,
            message: "Champs requis manquants: nom, prenom, email, telephone et typeuser sont obligatoires"
        });
    }

    try {
        let sql, params;

        if (mdp) {
            // Hasher le nouveau mot de passe
            const hashedPassword = await bcrypt.hash(mdp, 10);
            sql = `UPDATE users 
                   SET nom = $1, prenom = $2, email = $3, telephone = $4, typeuser = $5, 
                       idins = $6, idcreneaux = $7, numeroterrain = $8, idrapport = $9, mdp = $10
                   WHERE iduser = $11 
                   RETURNING iduser, nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport`;
            params = [
                nom, prenom, email, telephone, typeuser,
                idins || null, idcreneaux || null, numeroterrain || null, idrapport || null,
                hashedPassword, id
            ];
        } else {
            sql = `UPDATE users 
                   SET nom = $1, prenom = $2, email = $3, telephone = $4, typeuser = $5, 
                       idins = $6, idcreneaux = $7, numeroterrain = $8, idrapport = $9
                   WHERE iduser = $10 
                   RETURNING iduser, nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport`;
            params = [
                nom, prenom, email, telephone, typeuser,
                idins || null, idcreneaux || null, numeroterrain || null, idrapport || null,
                id
            ];
        }

        const result = await pool.query(sql, params);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur non trouvé"
            });
        }

        console.log("✅ Utilisateur modifié:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Utilisateur modifié avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la modification de l'utilisateur:", err.message);
        
        if (err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: "Un utilisateur avec cet email existe déjà"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la modification de l'utilisateur",
            error: err.message
        });
    }
});

// 🗑️ DELETE - Supprimer un utilisateur
router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const result = await pool.query(
            "DELETE FROM users WHERE iduser = $1 RETURNING iduser, nom, prenom, email",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur non trouvé"
            });
        }

        console.log("✅ Utilisateur supprimé:", result.rows[0]);
        
        res.json({
            success: true,
            message: "Utilisateur supprimé avec succès",
            data: result.rows[0]
        });
    } catch (err) {
        console.error("❌ Erreur lors de la suppression de l'utilisateur:", err.message);
        
        if (err.code === '23503') {
            return res.status(409).json({
                success: false,
                message: "Impossible de supprimer cet utilisateur car il est lié à d'autres données"
            });
        }
        
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de la suppression de l'utilisateur",
            error: err.message
        });
    }
});

// 🔐 POST - Authentification utilisateur
router.post("/login", async (req, res) => {
    const { email, mdp } = req.body;

    if (!email || !mdp) {
        return res.status(400).json({
            success: false,
            message: "Email et mot de passe sont requis"
        });
    }

    try {
        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Email ou mot de passe incorrect"
            });
        }

        const user = result.rows[0];
        const isPasswordValid = await bcrypt.compare(mdp, user.mdp);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Email ou mot de passe incorrect"
            });
        }

        // Ne pas renvoyer le mot de passe dans la réponse
        const { mdp: _, ...userWithoutPassword } = user;

        res.json({
            success: true,
            message: "Connexion réussie",
            data: userWithoutPassword
        });
    } catch (err) {
        console.error("❌ Erreur lors de l'authentification:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors de l'authentification",
            error: err.message
        });
    }
});

// 🔍 GET - Filtrer les utilisateurs par type
router.get("/type/:typeuser", async (req, res) => {
    const typeuser = req.params.typeuser;
    
    try {
        const result = await pool.query(
            "SELECT iduser, nom, prenom, email, telephone, typeuser, idins, idcreneaux, numeroterrain, idrapport FROM users WHERE typeuser = $1 ORDER BY nom, prenom",
            [typeuser]
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (err) {
        console.error("❌ Erreur lors du filtrage des utilisateurs:", err.message);
        res.status(500).json({
            success: false,
            message: "Erreur serveur lors du filtrage des utilisateurs",
            error: err.message
        });
    }
});

export default router;