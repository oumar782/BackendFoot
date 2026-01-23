import express from "express";
import pool from "../db.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configuration de multer pour l'upload d'images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../uploads/clients');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'client-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées (jpeg, jpg, png, gif)'));
    }
  }
});

// Middleware CORS pour toutes les méthodes
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }
  
  next();
});

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
    heure_reservation = null,
    photo_base64 = null
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

  // Gérer la photo base64
  let photoUrl = photo_abonne;
  if (photo_base64) {
    try {
      const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const fileName = `client-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
      const uploadDir = path.join(__dirname, '../../uploads/clients');
      
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, buffer);
      photoUrl = `/uploads/clients/${fileName}`;
    } catch (error) {
      console.error('Erreur lors du traitement de la photo:', error);
    }
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
        photoUrl,
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
    
    if (err.code === '23505') {
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
    
    // Convertir les URLs relatives en absolues pour les photos
    const clientsWithAbsoluteUrls = result.rows.map(client => ({
      ...client,
      photo_abonne: client.photo_abonne ? 
        `${req.protocol}://${req.get('host')}${client.photo_abonne}` : 
        null
    }));
    
    res.json({
      success: true,
      count: clientsWithAbsoluteUrls.length,
      data: clientsWithAbsoluteUrls
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

    // Convertir l'URL de la photo
    const client = result.rows[0];
    if (client.photo_abonne) {
      client.photo_abonne = `${req.protocol}://${req.get('host')}${client.photo_abonne}`;
    }

    res.json({
      success: true,
      data: client
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

// READ - Récupérer les clients avec abonnement actif
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

// UPDATE - Mettre à jour la photo d'un abonné (base64)
router.post("/:id/photo-base64", async (req, res) => {
  const id = req.params.id;
  const { photo_base64 } = req.body;

  if (!photo_base64) {
    return res.status(400).json({
      success: false,
      message: "Photo base64 requise"
    });
  }

  try {
    // Extraire les données base64
    const base64Data = photo_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Générer un nom de fichier unique
    const fileName = `client-${id}-${Date.now()}.jpg`;
    const uploadDir = path.join(__dirname, '../../uploads/clients');
    
    // Créer le dossier s'il n'existe pas
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    // Sauvegarder le fichier
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);
    
    const photoUrl = `/uploads/clients/${fileName}`;

    // Mettre à jour la base de données
    const result = await pool.query(
      `UPDATE clients 
       SET photo_abonne = $1
       WHERE idclient = $2 
       RETURNING *`,
      [photoUrl, id]
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
      data: {
        ...result.rows[0],
        photo_abonne: `${req.protocol}://${req.get('host')}${photoUrl}`
      }
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

// UPLOAD - Upload d'une photo via form-data
router.post("/:id/upload-photo", upload.single('photo'), async (req, res) => {
  const id = req.params.id;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Aucun fichier uploadé"
    });
  }

  try {
    const photoUrl = `/uploads/clients/${req.file.filename}`;

    const result = await pool.query(
      `UPDATE clients 
       SET photo_abonne = $1
       WHERE idclient = $2 
       RETURNING *`,
      [photoUrl, id]
    );

    if (result.rows.length === 0) {
      // Supprimer le fichier uploadé si le client n'existe pas
      fs.unlinkSync(req.file.path);
      return res.status(404).json({
        success: false,
        message: "Client non trouvé"
      });
    }

    console.log("✅ Photo client uploadée:", result.rows[0]);
    
    res.json({
      success: true,
      message: "Photo uploadée avec succès",
      data: {
        ...result.rows[0],
        photo_abonne: `${req.protocol}://${req.get('host')}${photoUrl}`
      }
    });
  } catch (err) {
    // Supprimer le fichier en cas d'erreur
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error("❌ Erreur lors de l'upload de la photo:", err.message);
    res.status(500).json({
      success: false,
      message: "Erreur serveur lors de l'upload de la photo",
      error: err.message
    });
  }
});

// DELETE - Supprimer un client
router.delete("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // Récupérer le client pour supprimer sa photo
    const clientResult = await pool.query(
      "SELECT photo_abonne FROM clients WHERE idclient = $1",
      [id]
    );

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

    // Supprimer la photo du client si elle existe
    if (clientResult.rows.length > 0 && clientResult.rows[0].photo_abonne) {
      const photoPath = path.join(__dirname, '../../', clientResult.rows[0].photo_abonne);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
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

// SEARCH - Rechercher des clients
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

// GENERER CARTE - Route pour générer les informations de la carte
router.get("/:id/carte-info", async (req, res) => {
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

    const client = result.rows[0];
    
    // Générer un code QR fictif (en production, utilisez une vraie librairie QR)
    const qrCodeData = JSON.stringify({
      id: client.idclient,
      nom: client.nom,
      prenom: client.prenom,
      type_abonnement: client.type_abonnement,
      date_fin: client.date_fin
    });

    const carteInfo = {
      ...client,
      qr_code: qrCodeData,
      date_emission: new Date().toISOString().split('T')[0]
    };

    res.json({
      success: true,
      data: carteInfo
    });
  } catch (err) {
    console.error("❌ Erreur lors de la récupération des infos carte:", err.message);
    res.status(500).json({
      success: false,
      message: "Erreur serveur lors de la récupération des informations",
      error: err.message
    });
  }
});

// Route pour servir les images uploadées
router.use('/uploads/clients', express.static(path.join(__dirname, '../../uploads/clients')));

export default router;