import express from 'express';
const router = express.Router();
import db from '../db.js';

// Route pour créer une nouvelle démonstration (CREATE)
router.post('/', (req, res) => {
    const { nom, email, nombreterrains, message, entreprise } = req.body;
    
    // Validation des données
    if (!nom || !email || !entreprise || !nombreterrains || !message) {
        return res.status(400).json({ 
            success: false,
            message: 'Tous les champs sont requis' 
        });
    }

    const sql = `
        INSERT INTO demonstration 
        (nom, email, entreprise, nombreterrains, message, statut, date_demande) 
        VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
        RETURNING *
    `;
    
    db.query(sql, [nom, email, entreprise, nombreterrains, message, 'En attente'])
        .then(result => {
            res.status(201).json({
                success: true,
                message: 'Démonstration créée avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la création de la démonstration',
                error: err.message 
            });
        });
});

// Route pour récupérer les statistiques des démonstrations
router.get('/statsde', async (req, res) => {
    try {
        const [totalResult, attenteResult, confirmeResult, realiseResult, annuleResult] = await Promise.all([
            db.query('SELECT COUNT(*) FROM demonstration'),
            db.query(`SELECT COUNT(*) FROM demonstration WHERE statut = 'En attente'`),
            db.query(`SELECT COUNT(*) FROM demonstration WHERE statut = 'Confirmé'`),
            db.query(`SELECT COUNT(*) FROM demonstration WHERE statut = 'Réalisé'`),
            db.query(`SELECT COUNT(*) FROM demonstration WHERE statut = 'Annulé'`)
        ]);

        res.json({
            success: true,
            data: {
                total: parseInt(totalResult.rows[0].count),
                enAttente: parseInt(attenteResult.rows[0].count),
                confirme: parseInt(confirmeResult.rows[0].count),
                realise: parseInt(realiseResult.rows[0].count),
                annule: parseInt(annuleResult.rows[0].count)
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

// Route pour récupérer toutes les démonstrations (READ ALL)
router.get('/', (req, res) => {
    const sql = 'SELECT * FROM demonstration ORDER BY date_demande DESC';
    
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
                message: 'Erreur lors de la récupération des démonstrations',
                error: err.message 
            });
        });
});

// Route pour récupérer une démonstration spécifique (READ ONE)
router.get('/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = 'SELECT * FROM demonstration WHERE id_demonstration = $1';
    
    db.query(sql, [id])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Démonstration non trouvée' 
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
                message: 'Erreur lors de la récupération de la démonstration',
                error: err.message 
            });
        });
});

// Route pour mettre à jour une démonstration (UPDATE)
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { nom, email, entreprise, nombreterrains, message, statut } = req.body;
    
    // Validation des données
    if (!nom || !email || !entreprise || !nombreterrains || !message || !statut) {
        return res.status(400).json({ 
            success: false,
            message: 'Tous les champs sont requis' 
        });
    }

    const sql = `
        UPDATE demonstration 
        SET nom = $1, email = $2, entreprise = $3, nombreterrains = $4, message = $5, statut = $6 
        WHERE id_demonstration = $7 
        RETURNING *
    `;
    
    db.query(sql, [nom, email, entreprise, nombreterrains, message, statut, id])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Démonstration non trouvée' 
                });
            }
            res.status(200).json({
                success: true,
                message: 'Démonstration mise à jour avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la mise à jour de la démonstration',
                error: err.message 
            });
        });
});

// Route pour supprimer une démonstration (DELETE)
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    
    // Validation stricte de l'ID
    if (!id || !Number.isInteger(Number(id))) {
      return res.status(400).json({
        success: false,
        message: 'ID doit être un nombre entier'
      });
    }
  
    const demonstrationId = parseInt(id, 10);
  
    const sql = 'DELETE FROM demonstration WHERE id_demonstration = $1 RETURNING *';
    
    db.query(sql, [demonstrationId])
      .then(result => {
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Aucune démonstration trouvée avec cet ID'
          });
        }
        res.json({
          success: true,
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

export default router;