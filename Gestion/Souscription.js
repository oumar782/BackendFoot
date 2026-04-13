import express from 'express';
const router = express.Router();
import db from '../db.js';

// Route pour créer une nouvelle souscription (CREATE)
router.post('/', (req, res) => {
    const { 
        nom, 
        prenom, 
        email, 
        telephone, 
        plan, 
        type_facturation, 
        prix_paye, 
        mode_paiement, 
        date_debut, 
        date_fin,
        statut 
    } = req.body;
    
    // Validation des données
    if (!nom || !prenom || !email || !telephone || !plan || !type_facturation || !prix_paye || !mode_paiement || !date_debut || !date_fin) {
        return res.status(400).json({ 
            success: false,
            message: 'Tous les champs sont requis' 
        });
    }

    // Validation des valeurs enum
    const plansValides = ['starter', 'pro', 'enterprise'];
    const facturationsValides = ['mensuel', 'annuel'];
    const paiementsValides = ['Carte', 'Especes', 'Mobile Money', 'Virement'];
    const statutsValides = ['en_attente', 'active', 'suspendue', 'annulee', 'expiree'];

    if (!plansValides.includes(plan)) {
        return res.status(400).json({ 
            success: false,
            message: 'Plan invalide. Valeurs acceptées: starter, pro, enterprise' 
        });
    }

    if (!facturationsValides.includes(type_facturation)) {
        return res.status(400).json({ 
            success: false,
            message: 'Type de facturation invalide. Valeurs acceptées: mensuel, annuel' 
        });
    }

    if (!paiementsValides.includes(mode_paiement)) {
        return res.status(400).json({ 
            success: false,
            message: 'Mode de paiement invalide' 
        });
    }

    const statutFinal = statut && statutsValides.includes(statut) ? statut : 'en_attente';

    const sql = `
        INSERT INTO souscriptions 
        (nom, prenom, email, telephone, plan, type_facturation, prix_paye, mode_paiement, date_debut, date_fin, statut, created_at, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
        RETURNING *
    `;
    
    db.query(sql, [nom, prenom, email, telephone, plan, type_facturation, prix_paye, mode_paiement, date_debut, date_fin, statutFinal])
        .then(result => {
            res.status(201).json({
                success: true,
                message: 'Souscription créée avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la création de la souscription',
                error: err.message 
            });
        });
});

// Route pour récupérer les statistiques des souscriptions
router.get('/stats', async (req, res) => {
    try {
        const [totalResult, attenteResult, activeResult, suspendueResult, annuleeResult, expireeResult] = await Promise.all([
            db.query('SELECT COUNT(*) FROM souscriptions'),
            db.query(`SELECT COUNT(*) FROM souscriptions WHERE statut = 'en_attente'`),
            db.query(`SELECT COUNT(*) FROM souscriptions WHERE statut = 'active'`),
            db.query(`SELECT COUNT(*) FROM souscriptions WHERE statut = 'suspendue'`),
            db.query(`SELECT COUNT(*) FROM souscriptions WHERE statut = 'annulee'`),
            db.query(`SELECT COUNT(*) FROM souscriptions WHERE statut = 'expiree'`)
        ]);

        // Statistiques supplémentaires
        const [revenusMensuels, revenusAnnuel] = await Promise.all([
            db.query(`SELECT SUM(prix_paye) as total FROM souscriptions WHERE type_facturation = 'mensuel' AND statut = 'active'`),
            db.query(`SELECT SUM(prix_paye * 12) as total FROM souscriptions WHERE type_facturation = 'annuel' AND statut = 'active'`)
        ]);

        const [parPlan] = await db.query(`
            SELECT plan, COUNT(*) as count, SUM(prix_paye) as revenus 
            FROM souscriptions 
            WHERE statut = 'active' 
            GROUP BY plan
        `);

        res.json({
            success: true,
            data: {
                total: parseInt(totalResult.rows[0].count),
                enAttente: parseInt(attenteResult.rows[0].count),
                active: parseInt(activeResult.rows[0].count),
                suspendue: parseInt(suspendueResult.rows[0].count),
                annulee: parseInt(annuleeResult.rows[0].count),
                expiree: parseInt(expireeResult.rows[0].count),
                revenus: {
                    mensuels: parseFloat(revenusMensuels.rows[0].total) || 0,
                    annuels: parseFloat(revenusAnnuel.rows[0].total) || 0,
                    total: (parseFloat(revenusMensuels.rows[0].total) || 0) + (parseFloat(revenusAnnuel.rows[0].total) || 0)
                },
                repartitionParPlan: parPlan.rows
            }
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur serveur',
            error: err.message 
        });
    }
});

// Route pour récupérer toutes les souscriptions (READ ALL)
router.get('/', (req, res) => {
    const sql = 'SELECT * FROM souscriptions ORDER BY created_at DESC';
    
    db.query(sql)
        .then(result => {
            res.status(200).json({
                success: true,
                data: result.rows
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la récupération des souscriptions',
                error: err.message 
            });
        });
});

// Route pour récupérer une souscription spécifique (READ ONE)
router.get('/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = 'SELECT * FROM souscriptions WHERE id = $1';
    
    db.query(sql, [id])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Souscription non trouvée' 
                });
            }
            res.status(200).json({
                success: true,
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la récupération de la souscription',
                error: err.message 
            });
        });
});

// Route pour récupérer les souscriptions par email
router.get('/email/:email', (req, res) => {
    const { email } = req.params;
    
    const sql = 'SELECT * FROM souscriptions WHERE email = $1 ORDER BY created_at DESC';
    
    db.query(sql, [email])
        .then(result => {
            res.status(200).json({
                success: true,
                data: result.rows
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la récupération des souscriptions',
                error: err.message 
            });
        });
});

// Route pour récupérer les souscriptions par statut
router.get('/statut/:statut', (req, res) => {
    const { statut } = req.params;
    
    const statutsValides = ['en_attente', 'active', 'suspendue', 'annulee', 'expiree'];
    if (!statutsValides.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: 'Statut invalide'
        });
    }
    
    const sql = 'SELECT * FROM souscriptions WHERE statut = $1 ORDER BY created_at DESC';
    
    db.query(sql, [statut])
        .then(result => {
            res.status(200).json({
                success: true,
                data: result.rows
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la récupération des souscriptions',
                error: err.message 
            });
        });
});

// Route pour mettre à jour une souscription (UPDATE)
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { 
        nom, 
        prenom, 
        email, 
        telephone, 
        plan, 
        type_facturation, 
        prix_paye, 
        mode_paiement, 
        date_debut, 
        date_fin, 
        statut 
    } = req.body;
    
    // Validation des données
    if (!nom || !prenom || !email || !telephone || !plan || !type_facturation || !prix_paye || !mode_paiement || !date_debut || !date_fin || !statut) {
        return res.status(400).json({ 
            success: false,
            message: 'Tous les champs sont requis' 
        });
    }

    const sql = `
        UPDATE souscriptions 
        SET nom = $1, 
            prenom = $2, 
            email = $3, 
            telephone = $4, 
            plan = $5, 
            type_facturation = $6, 
            prix_paye = $7, 
            mode_paiement = $8, 
            date_debut = $9, 
            date_fin = $10, 
            statut = $11,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $12 
        RETURNING *
    `;
    
    db.query(sql, [nom, prenom, email, telephone, plan, type_facturation, prix_paye, mode_paiement, date_debut, date_fin, statut, id])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Souscription non trouvée' 
                });
            }
            res.status(200).json({
                success: true,
                message: 'Souscription mise à jour avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la mise à jour de la souscription',
                error: err.message 
            });
        });
});

// Route pour mettre à jour le statut uniquement (PATCH)
router.patch('/:id/statut', (req, res) => {
    const { id } = req.params;
    const { statut } = req.body;
    
    if (!statut) {
        return res.status(400).json({
            success: false,
            message: 'Le statut est requis'
        });
    }
    
    const statutsValides = ['en_attente', 'active', 'suspendue', 'annulee', 'expiree'];
    if (!statutsValides.includes(statut)) {
        return res.status(400).json({
            success: false,
            message: 'Statut invalide'
        });
    }
    
    const sql = `
        UPDATE souscriptions 
        SET statut = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $2 
        RETURNING *
    `;
    
    db.query(sql, [statut, id])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Souscription non trouvée' 
                });
            }
            res.status(200).json({
                success: true,
                message: 'Statut mis à jour avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la mise à jour du statut',
                error: err.message 
            });
        });
});

// Route pour supprimer une souscription (DELETE)
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    
    // Validation stricte de l'ID
    if (!id || !Number.isInteger(Number(id))) {
        return res.status(400).json({
            success: false,
            message: 'ID doit être un nombre entier'
        });
    }
    
    const souscriptionId = parseInt(id, 10);
    
    const sql = 'DELETE FROM souscriptions WHERE id = $1 RETURNING *';
    
    db.query(sql, [souscriptionId])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Aucune souscription trouvée avec cet ID'
                });
            }
            res.json({
                success: true,
                message: 'Souscription supprimée avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur DB:', err);
            res.status(500).json({
                success: false,
                message: 'Erreur de base de données'
            });
        });
});

// Route pour obtenir les souscriptions expirées
router.get('/expired/check', async (req, res) => {
    try {
        const sql = `
            UPDATE souscriptions 
            SET statut = 'expiree', updated_at = CURRENT_TIMESTAMP 
            WHERE date_fin < CURRENT_DATE AND statut = 'active'
            RETURNING *
        `;
        
        const result = await db.query(sql);
        
        res.json({
            success: true,
            message: `${result.rows.length} souscription(s) marquée(s) comme expirée(s)`,
            data: result.rows
        });
    } catch (err) {
        console.error('Erreur:', err);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la vérification des souscriptions expirées',
            error: err.message
        });
    }
});

export default router;