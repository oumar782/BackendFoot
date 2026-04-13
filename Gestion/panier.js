import express from 'express';
import db from '../db.js';
 
const router = express.Router();
 
// ==================== API PANIER COMPLET ====================
 
// 🛒 GET - Récupérer le panier d'un utilisateur
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
 
    const sql = `
      SELECT 
        p.id,
        p.user_id,
        p.produit_id,
        p.nom_produit,
        p.image_produit,
        p.prix_unitaire,
        p.prix_original,
        p.quantite,
        p.taille,
        p.couleur,
        p.materiau,
        p.categorie,
        p.date_ajout,
        p.statut,
        pr.description,
        pr.pourcentage_reduction,
        pr.badge,
        pr.stock_disponible
      FROM panier p
      LEFT JOIN produits pr ON p.produit_id = pr.id
      WHERE p.user_id = $1 AND p.statut = 'actif'
      ORDER BY p.date_ajout DESC
    `;
 
    const result = await db.query(sql, [userId]);
 
    // Calculer les totaux
    const totalArticles = result.rows.reduce((sum, item) => sum + item.quantite, 0);
    const totalPrix = result.rows.reduce((sum, item) => sum + (item.prix_unitaire * item.quantite), 0);
    const totalReduction = result.rows.reduce((sum, item) => {
      const reduction = item.prix_original ? (item.prix_original - item.prix_unitaire) * item.quantite : 0;
      return sum + reduction;
    }, 0);
 
    res.json({
      success: true,
      data: {
        items: result.rows,
        resume: {
          total_articles: totalArticles,
          sous_total: totalPrix,
          total_reduction: totalReduction,
          total_general: totalPrix,
          frais_livraison: totalPrix >= 1500 ? 0 : 29.00,
          economie_livraison: totalPrix >= 1500 ? 29.00 : 0
        }
      }
    });
 
  } catch (error) {
    console.error('❌ Erreur récupération panier:', error);
    res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message 
    });
  }
});
 
// ➕ POST - Ajouter un article au panier
router.post('/ajouter', async (req, res) => {
  try {
    const {
      user_id,
      produit_id,
      nom_produit,
      image_produit,
      prix_unitaire,
      prix_original,
      quantite = 1,
      taille,
      couleur,
      materiau,
      categorie
    } = req.body;
 
    // Validation
    if (!user_id || !produit_id || !nom_produit || !prix_unitaire || !taille) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis manquants'
      });
    }
 
    // Vérifier si l'article existe déjà dans le panier
    const checkSql = `
      SELECT id, quantite FROM panier 
      WHERE user_id = $1 AND produit_id = $2 AND taille = $3 AND statut = 'actif'
    `;
    const existingItem = await db.query(checkSql, [user_id, produit_id, taille]);
 
    if (existingItem.rows.length > 0) {
      // Mettre à jour la quantité
      const updateSql = `
        UPDATE panier 
        SET quantite = quantite + $1, date_ajout = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `;
      const result = await db.query(updateSql, [quantite, existingItem.rows[0].id]);
 
      res.json({
        success: true,
        message: 'Quantité mise à jour dans le panier',
        data: result.rows[0]
      });
    } else {
      // Ajouter nouvel article
      const insertSql = `
        INSERT INTO panier (
          user_id, produit_id, nom_produit, image_produit, 
          prix_unitaire, prix_original, quantite, taille, 
          couleur, materiau, categorie
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;
 
      const params = [
        user_id, produit_id, nom_produit, image_produit,
        prix_unitaire, prix_original, quantite, taille,
        couleur, materiau, categorie
      ];
 
      const result = await db.query(insertSql, params);
 
      res.status(201).json({
        success: true,
        message: 'Article ajouté au panier avec succès',
        data: result.rows[0]
      });
    }
 
  } catch (error) {
    console.error('❌ Erreur ajout panier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});
 
// 🔄 PUT - Mettre à jour la quantité d'un article
router.put('/mettre-a-jour/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { quantite } = req.body;
 
    if (!quantite || quantite < 1) {
      return res.status(400).json({
        success: false,
        message: 'La quantité doit être supérieure à 0'
      });
    }
 
    const sql = `
      UPDATE panier 
      SET quantite = $1, date_ajout = CURRENT_TIMESTAMP
      WHERE id = $2 AND statut = 'actif'
      RETURNING *
    `;
 
    const result = await db.query(sql, [quantite, itemId]);
 
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Article non trouvé dans le panier'
      });
    }
 
    res.json({
      success: true,
      message: 'Quantité mise à jour avec succès',
      data: result.rows[0]
    });
 
  } catch (error) {
    console.error('❌ Erreur mise à jour panier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});
 
// 🗑️ DELETE - Supprimer un article du panier
router.delete('/supprimer/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
 
    const sql = `
      UPDATE panier 
      SET statut = 'supprime'
      WHERE id = $1 AND statut = 'actif'
      RETURNING *
    `;
 
    const result = await db.query(sql, [itemId]);
 
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Article non trouvé dans le panier'
      });
    }
 
    res.json({
      success: true,
      message: 'Article supprimé du panier',
      data: result.rows[0]
    });
 
  } catch (error) {
    console.error('❌ Erreur suppression panier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});
 
// 🧹 DELETE - Vider le panier
router.delete('/vider/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
 
    const sql = `
      UPDATE panier 
      SET statut = 'supprime'
      WHERE user_id = $1 AND statut = 'actif'
    `;
 
    await db.query(sql, [userId]);
 
    res.json({
      success: true,
      message: 'Panier vidé avec succès'
    });
 
  } catch (error) {
    console.error('❌ Erreur vidage panier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});
 
// 📊 GET - Statistiques du panier
router.get('/statistiques/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
 
    const sql = `
      SELECT 
        COUNT(*) as nombre_articles,
        SUM(quantite) as total_quantites,
        SUM(prix_unitaire * quantite) as valeur_totale,
        SUM(CASE WHEN prix_original > prix_unitaire 
            THEN (prix_original - prix_unitaire) * quantite 
            ELSE 0 END) as totale_economies,
        COUNT(DISTINCT categorie) as categories_differentes,
        MIN(date_ajout) as premier_ajout,
        MAX(date_ajout) as dernier_ajout
      FROM panier
      WHERE user_id = $1 AND statut = 'actif'
    `;
 
    const result = await db.query(sql, [userId]);
 
    res.json({
      success: true,
      data: result.rows[0]
    });
 
  } catch (error) {
    console.error('❌ Erreur statistiques panier:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});
 
// 🎁 POST - Appliquer un code promo
router.post('/appliquer-promo/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { code_promo } = req.body;
 
    if (!code_promo) {
      return res.status(400).json({
        success: false,
        message: 'Code promo requis'
      });
    }
 
    // Vérifier si le code promo est valide
    const promoSql = `
      SELECT * FROM codes_promo 
      WHERE code = $1 AND 
            actif = true AND 
            date_debut <= CURRENT_DATE AND 
            date_fin >= CURRENT_DATE
    `;
 
    const promoResult = await db.query(promoSql, [code_promo]);
 
    if (promoResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Code promo invalide ou expiré'
      });
    }
 
    const promo = promoResult.rows[0];
 
    // Mettre à jour le panier avec la promo
    const updateSql = `
      UPDATE panier 
      SET code_promo_applique = $1, reduction_promo = $2
      WHERE user_id = $3 AND statut = 'actif'
      RETURNING *
    `;
 
    const result = await db.query(updateSql, [code_promo, promo.pourcentage_reduction, userId]);
 
    res.json({
      success: true,
      message: 'Code promo appliqué avec succès',
      data: {
        promo: promo,
        items_updated: result.rows.length
      }
    });
 
  } catch (error) {
    console.error('❌ Erreur application promo:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});
 
export default router;
 