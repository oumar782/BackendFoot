// routes/upload.js
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import pool from "../db.js";

const router = express.Router();

// Configuration de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configuration du stockage Cloudinary avec multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'terrains',
    format: async (req, file) => 'jpg', // ou png, webp, etc.
    transformation: [
      { width: 800, height: 600, crop: 'limit' },
      { quality: 'auto' }
    ]
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées'), false);
    }
  }
});

// Route pour uploader une image
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Aucun fichier uploadé"
      });
    }

    res.json({
      success: true,
      message: "Image uploadée avec succès",
      data: {
        url: req.file.path,
        public_id: req.file.filename
      }
    });
  } catch (error) {
    console.error("❌ Erreur upload:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'upload",
      error: error.message
    });
  }
});

// Route pour supprimer une image
router.delete('/image/:public_id', async (req, res) => {
  try {
    const { public_id } = req.params;
    
    const result = await cloudinary.uploader.destroy(public_id);
    
    if (result.result === 'ok') {
      res.json({
        success: true,
        message: "Image supprimée avec succès"
      });
    } else {
      res.status(404).json({
        success: false,
        message: "Image non trouvée"
      });
    }
  } catch (error) {
    console.error("❌ Erreur suppression:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression",
      error: error.message
    });
  }
});

export default router;