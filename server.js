import express from 'express';
import db from '../db.js';

const router = express.Router();

// ✅ Appliquer CORS spécifiquement pour cette route
router.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "https://footspace-reserve.netlify.app", 
    "https://frabjous-gaufre-31e862.netlify.app",
    "https://footspace-solutions.vercel.app"
  ];
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// Options pour les requêtes preflight
router.options('*', (req, res) => {
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).send();
});

// GET tous les clients
router.get('/', async (req, res) => {
  try {
    console.log('📥 Requête GET /api/clients reçue');
    const result = await db.query('SELECT * FROM clients ORDER BY idclient DESC');
    
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des clients:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des clients',
      error: error.message
    });
  }
});

// GET client par ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📥 Requête GET /api/clients/${id} reçue`);
    
    const result = await db.query('SELECT * FROM clients WHERE idclient = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client non trouvé'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error(`❌ Erreur lors de la récupération du client ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération du client',
      error: error.message
    });
  }
});

// POST nouveau client
router.post('/', async (req, res) => {
  try {
    console.log('📥 Requête POST /api/clients reçue:', req.body);
    
    const { nomclient, prenom, email, telephone, motdepasse } = req.body;
    
    // Validation des données requises
    if (!nomclient || !prenom || !email || !telephone) {
      return res.status(400).json({
        success: false,
        message: 'Nom, prénom, email et téléphone sont obligatoires'
      });
    }
    
    const result = await db.query(
      `INSERT INTO clients (nomclient, prenom, email, telephone, motdepasse) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [nomclient, prenom, email, telephone, motdepasse || null]
    );
    
    res.status(201).json({
      success: true,
      message: 'Client créé avec succès',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Erreur lors de la création du client:', error);
    
    // Gestion des erreurs de contrainte unique (email dupliqué)
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Un client avec cet email existe déjà'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la création du client',
      error: error.message
    });
  }
});

// PUT modifier un client
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📥 Requête PUT /api/clients/${id} reçue:`, req.body);
    
    const { nomclient, prenom, email, telephone, motdepasse } = req.body;
    
    const result = await db.query(
      `UPDATE clients 
       SET nomclient = $1, prenom = $2, email = $3, telephone = $4, motdepasse = $5
       WHERE idclient = $6 
       RETURNING *`,
      [nomclient, prenom, email, telephone, motdepasse, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client non trouvé'
      });
    }
    
    res.json({
      success: true,
      message: 'Client modifié avec succès',
      data: result.rows[0]
    });
  } catch (error) {
    console.error(`❌ Erreur lors de la modification du client ${req.params.id}:`, error);
    
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Un client avec cet email existe déjà'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la modification du client',
      error: error.message
    });
  }
});

// DELETE supprimer un client
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📥 Requête DELETE /api/clients/${id} reçue`);
    
    const result = await db.query(
      'DELETE FROM clients WHERE idclient = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client non trouvé'
      });
    }
    
    res.json({
      success: true,
      message: 'Client supprimé avec succès',
      data: result.rows[0]
    });
  } catch (error) {
    console.error(`❌ Erreur lors de la suppression du client ${req.params.id}:`, error);
    
    // Gestion des erreurs de clé étrangère
    if (error.code === '23503') {
      return res.status(409).json({
        success: false,
        message: 'Impossible de supprimer le client car il a des réservations associées'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la suppression du client',
      error: error.message
    });
  }
});

export default router;
