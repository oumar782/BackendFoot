import express from 'express';
import db from '../db.js';

const router = express.Router();

// 📊 INSIGHTS UTILISATEURS APPROFONDIS - EXTENSION DE USER.JS

// 🔍 Analyse comportementale complète des utilisateurs
router.get('/comportement-complet', async (req, res) => {
  try {
    const { periode = '30jours', segment = null } = req.query;

    let whereClause = `WHERE r.statut = 'confirmée'`;
    let params = [];

    if (periode === '30jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '30 days'`;
    } else if (periode === '7jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '7 days'`;
    } else if (periode === '90jours') {
      whereClause += ` AND r.datereservation >= CURRENT_DATE - INTERVAL '90 days'`;
    }

    // 1. Segmentation comportementale avancée
    const segmentationAvancee = await db.query(`
      WITH comportement_utilisateurs AS (
        SELECT 
          u.iduser,
          u.nom,
          u.prenom,
          u.email,
          u.typeuser,
          COUNT(r.*) as nb_reservations,
          COALESCE(SUM(r.tarif), 0) as depense_totale,
          MIN(r.datereservation) as premiere_reservation,
          MAX(r.datereservation) as derniere_reservation,
          COUNT(DISTINCT r.nomterrain) as terrains_explores,
          COUNT(DISTINCT EXTRACT(DOW FROM r.datereservation)) as jours_utilises,
          COUNT(DISTINCT EXTRACT(HOUR FROM r.heurereservation)) as horaires_utilises,
          ROUND(AVG(r.tarif)::numeric, 2) as tarif_moyen,
          MAX(r.datereservation) - MIN(r.datereservation) as duree_relation_jours,
          CASE 
            WHEN COUNT(r.*) = 1 THEN 'NEW_CLIENT'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '7 days' THEN 'ACTIF_RECENT'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '30 days' THEN 'ACTIF'
            WHEN MAX(r.datereservation) >= CURRENT_DATE - INTERVAL '90 days' THEN 'INACTIF_RECENT'
            ELSE 'INACTIF_LONGUE'
          END as statut_activite
        FROM users u
        LEFT JOIN reservation r ON u.email = r.email
        ${whereClause}
        GROUP BY u.iduser, u.nom, u.prenom, u.email, u.typeuser
      )
      SELECT 
        statut_activite,
        COUNT(*) as nb_utilisateurs,
        SUM(nb_reservations) as total_reservations_segment,
        SUM(depense_totale) as depense_totale_segment,
        ROUND(AVG(nb_reservations)::numeric, 2) as reservations_moyennes_client,
        ROUND(AVG(depense_totale)::numeric, 2) as depense_moyenne_client,
        ROUND(AVG(terrains_explores)::numeric, 2) as diversite_terrains_moyenne,
        ROUND(AVG(duree_relation_jours)::numeric, 2) as duree_relation_moyenne,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2)::numeric as pourcentage_utilisateurs,
        ROUND(SUM(depense_totale) * 100.0 / SUM(SUM(depense_totale)) OVER(), 2)::numeric as part_revenu_total
      FROM comportement_utilisateurs
      GROUP BY statut_activite
      ORDER BY depense_totale_segment DESC
    `, params);

    res.json({
      success: true,
      periode_analysee: periode,
      date_generation: new Date().toISOString(),
      analyses: {
        segmentation_avancee: segmentationAvancee.rows
      }
    });

  } catch (error) {
    console.error('❌ Erreur dans comportement-complet:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse comportementale complète',
      error: error.message
    });
  }
});

export default router;
