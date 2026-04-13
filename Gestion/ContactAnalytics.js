import express from 'express';
import db from '../db.js';

const router = express.Router();

// ============================================
// 1. STATISTIQUES GÉNÉRALES
// ============================================

router.get('/analytics/stats', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_contacts,
        SUM(CASE WHEN statut = 'En attente' OR statut IS NULL THEN 1 ELSE 0 END) as en_attente,
        SUM(CASE WHEN statut = 'En cours' THEN 1 ELSE 0 END) as en_cours,
        SUM(CASE WHEN statut = 'Résolu' THEN 1 ELSE 0 END) as resolus,
        SUM(CASE WHEN motif = 'Réclamation' THEN 1 ELSE 0 END) as reclamations,
        SUM(CASE WHEN motif = 'Support technique' THEN 1 ELSE 0 END) as support_technique,
        SUM(CASE WHEN motif = 'Demande de démo' THEN 1 ELSE 0 END) as demandes_demo,
        SUM(CASE WHEN motif = 'Information commerciale' THEN 1 ELSE 0 END) as info_commerciale,
        ROUND(CAST(SUM(CASE WHEN statut = 'Résolu' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_resolution
      FROM contact
    `);
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur statistiques', error: err.message });
  }
});

// ============================================
// 2. CONTACTS URGENTS À TRAITER (PRIORITAIRES)
// ============================================

router.get('/analytics/urgent', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, nom, email, motif, sujet, message,
        date_creation,
        CASE 
          WHEN motif = 'Réclamation' THEN 'CRITIQUE'
          WHEN motif = 'Support technique' THEN 'HAUTE'
          WHEN motif = 'Demande de démo' THEN 'MOYENNE'
          ELSE 'BASSE'
        END as priorite,
        CASE 
          WHEN motif = 'Réclamation' THEN 1
          WHEN motif = 'Support technique' THEN 2
          WHEN motif = 'Demande de démo' THEN 3
          ELSE 4
        END as ordre,
        EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 as heures_attente
      FROM contact
      WHERE statut = 'En attente' OR statut IS NULL
      ORDER BY ordre ASC, date_creation ASC
    `);
    
    const critique = result.rows.filter(r => r.priorite === 'CRITIQUE');
    const haute = result.rows.filter(r => r.priorite === 'HAUTE');
    const moyenne = result.rows.filter(r => r.priorite === 'MOYENNE');
    const basse = result.rows.filter(r => r.priorite === 'BASSE');
    
    res.json({
      success: true,
      data: {
        resume: {
          total: result.rows.length,
          critique: critique.length,
          haute: haute.length,
          moyenne: moyenne.length,
          basse: basse.length
        },
        recommandations: {
          critique: critique.length > 0 ? "🔴 URGENT - Traiter les réclamations immédiatement" : null,
          haute: haute.length > 0 ? "🟠 À traiter sous 4h - Support technique" : null,
          alerte_retard: result.rows.filter(r => r.heures_attente > 24).length > 0 ? "⚠️ Contacts en attente depuis plus de 24h" : null
        },
        contacts: {
          critique: critique,
          haute: haute,
          moyenne: moyenne,
          basse: basse
        }
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur contacts urgents', error: err.message });
  }
});

// ============================================
// 3. CONTACTS STAGNANTS (BACKLOG)
// ============================================

router.get('/analytics/backlog', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, nom, email, motif, sujet,
        date_creation,
        EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 as heures_attente,
        CASE 
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 < 24 THEN 'Vert'
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 < 48 THEN 'Orange'
          ELSE 'Rouge'
        END as niveau_alerte
      FROM contact
      WHERE statut = 'En attente' OR statut IS NULL
      ORDER BY date_creation ASC
    `);
    
    const vert = result.rows.filter(r => r.niveau_alerte === 'Vert');
    const orange = result.rows.filter(r => r.niveau_alerte === 'Orange');
    const rouge = result.rows.filter(r => r.niveau_alerte === 'Rouge');
    
    res.json({
      success: true,
      data: {
        synthese: {
          total: result.rows.length,
          vert: vert.length,
          orange: orange.length,
          rouge: rouge.length,
          alerte_critique: rouge.length > 0
        },
        contacts_orange: orange,
        contacts_rouge: rouge,
        action_requise: rouge.length > 0 ? "🚨 Contacter les clients en attente depuis +48h pour s'excuser" : null
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur backlog', error: err.message });
  }
});

// ============================================
// 4. SCORING DES CONTACTS
// ============================================

router.get('/analytics/scoring', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, nom, email, motif, sujet, message,
        date_creation,
        LENGTH(message) as longueur_message,
        (CASE 
          WHEN motif = 'Réclamation' THEN 100
          WHEN motif = 'Support technique' THEN 80
          WHEN motif = 'Demande de démo' THEN 60
          WHEN motif = 'Information commerciale' THEN 40
          ELSE 20
        END) as score_priorite,
        (LENGTH(message) / 10) as score_detail,
        (CASE 
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 > 48 THEN -30
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 > 24 THEN -15
          ELSE 0
        END) as penalite_attente,
        CASE 
          WHEN motif = 'Réclamation' THEN 'CRITIQUE'
          WHEN motif = 'Support technique' THEN 'HAUTE'
          WHEN motif = 'Demande de démo' THEN 'MOYENNE'
          ELSE 'BASSE'
        END as priorite
      FROM contact
      WHERE statut = 'En attente' OR statut IS NULL
      ORDER BY score_priorite DESC, date_creation ASC
    `);
    
    const contactsAvecScore = result.rows.map(row => ({
      ...row,
      score_total: Math.min(Math.max(row.score_priorite + row.score_detail + row.penalite_attente, 0), 100)
    }));
    
    res.json({
      success: true,
      data: {
        resume: {
          total: contactsAvecScore.length,
          score_moyen: (contactsAvecScore.reduce((a,b) => a + b.score_total, 0) / contactsAvecScore.length || 0).toFixed(1)
        },
        contacts: contactsAvecScore,
        regles_scoring: {
          critique: "Score > 80 → Traitement immédiat",
          haute: "Score 60-80 → Traitement sous 4h",
          moyenne: "Score 40-60 → Traitement sous 24h",
          basse: "Score < 40 → Traitement sous 48h"
        }
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur scoring', error: err.message });
  }
});

// ============================================
// 5. ANALYSE PAR MOTIF
// ============================================

router.get('/analytics/by-motif', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        motif,
        COUNT(*) as total,
        SUM(CASE WHEN statut = 'Résolu' THEN 1 ELSE 0 END) as resolus,
        ROUND(CAST(SUM(CASE WHEN statut = 'Résolu' THEN 1 ELSE 0 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 2) as taux_resolution,
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(date_traitement, NOW()) - date_creation)) / 3600), 1) as delai_moyen_heures
      FROM contact
      WHERE motif IS NOT NULL
      GROUP BY motif
      ORDER BY total DESC
    `);
    
    const motifPrincipal = result.rows[0]?.motif;
    const recommandation = motifPrincipal === 'Réclamation' 
      ? "⚠️ Les réclamations sont le motif principal - Auditer le produit/service"
      : motifPrincipal === 'Support technique'
      ? "🛠️ Beaucoup de support technique - Créer une base de connaissances"
      : "📊 Analyser pourquoi ce motif est le plus fréquent";
    
    res.json({
      success: true,
      data: {
        motifs: result.rows,
        motif_principal: motifPrincipal,
        recommandation: recommandation,
        alerte: result.rows.find(r => r.motif === 'Réclamation' && r.total > 5) ? "🔴 Nombre élevé de réclamations" : null
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur analyse motif', error: err.message });
  }
});

// ============================================
// 6. DÉLAIS DE RÉPONSE
// ============================================

router.get('/analytics/response-times', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        ROUND(AVG(EXTRACT(EPOCH FROM (date_premiere_reponse - date_creation)) / 3600), 1) as delai_moyen_heures,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (date_premiere_reponse - date_creation)) / 3600), 1) as delai_median_heures,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (date_premiere_reponse - date_creation)) / 3600 <= 4 THEN 1 END) as reponse_rapide,
        COUNT(CASE WHEN EXTRACT(EPOCH FROM (date_premiere_reponse - date_creation)) / 3600 > 24 THEN 1 END) as reponse_lente,
        COUNT(*) as total_repondu
      FROM contact
      WHERE date_premiere_reponse IS NOT NULL
    `);
    
    const evaluation = result.rows[0].delai_moyen_heures <= 4 ? "Excellent" 
      : result.rows[0].delai_moyen_heures <= 8 ? "Bon" 
      : result.rows[0].delai_moyen_heures <= 24 ? "Moyen" 
      : "À améliorer";
    
    res.json({
      success: true,
      data: {
        ...result.rows[0],
        evaluation: evaluation,
        seuls: {
          objectif: "< 4h",
          actuel: `${result.rows[0].delai_moyen_heures || 0}h`,
          statut: result.rows[0].delai_moyen_heures <= 4 ? "✅ Objectif atteint" : "❌ Objectif non atteint"
        }
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur délais', error: err.message });
  }
});

// ============================================
// 7. CLIENTS À RISQUE (CONTACTENT TROP SOUVENT)
// ============================================

router.get('/analytics/at-risk-clients', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        email, nom,
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN motif = 'Réclamation' THEN 1 END) as reclamations,
        COUNT(CASE WHEN motif = 'Support technique' THEN 1 END) as support,
        MAX(date_creation) as dernier_contact,
        MIN(date_creation) as premier_contact,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - date_creation)) / 86400), 1) as jours_moyen_entre_contacts
      FROM contact
      WHERE email IS NOT NULL
      GROUP BY email, nom
      HAVING COUNT(*) >= 2
      ORDER BY total_contacts DESC
    `);
    
    const clientsRisque = result.rows.filter(r => r.total_contacts >= 5 || r.reclamations >= 2);
    
    res.json({
      success: true,
      data: {
        clients_actifs: result.rows,
        clients_a_risque: clientsRisque,
        recommandation: clientsRisque.length > 0 
          ? "📞 Contacter proactivement ces clients pour comprendre leur insatisfaction"
          : null,
        alerte: clientsRisque.length > 0 ? "⚠️ Clients à risque identifiés" : null
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur clients risque', error: err.message });
  }
});

// ============================================
// 8. ÉVOLUTION TEMPORELLE
// ============================================

router.get('/analytics/evolution', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        DATE_TRUNC('day', date_creation) as jour,
        COUNT(*) as contacts_jour,
        SUM(CASE WHEN motif = 'Réclamation' THEN 1 ELSE 0 END) as reclamations_jour
      FROM contact
      WHERE date_creation >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', date_creation)
      ORDER BY jour DESC
    `);
    
    const moyenne7j = result.rows.slice(0,7).reduce((a,b) => a + parseInt(b.contacts_jour), 0) / 7;
    const moyenne30j = result.rows.reduce((a,b) => a + parseInt(b.contacts_jour), 0) / result.rows.length;
    const tendance = moyenne7j > moyenne30j * 1.2 ? "hausse" : moyenne7j < moyenne30j * 0.8 ? "baisse" : "stable";
    
    res.json({
      success: true,
      data: {
        evolution: result.rows,
        tendance: tendance,
        moyenne_7j: moyenne7j.toFixed(1),
        moyenne_30j: moyenne30j.toFixed(1),
        alerte: tendance === "hausse" ? "📈 Augmentation du volume de contacts - Anticiper les ressources" : null
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur évolution', error: err.message });
  }
});

// ============================================
// 9. TABLEAU DE BORD DÉCISIONNEL QUOTIDIEN
// ============================================

router.get('/analytics/daily-board', async (req, res) => {
  try {
    // Contacts en retard
    const contactsRetard = await db.query(`
      SELECT COUNT(*) as en_retard
      FROM contact
      WHERE (statut = 'En attente' OR statut IS NULL)
      AND date_creation < NOW() - INTERVAL '24 hours'
    `);
    
    // Top motif
    const topMotif = await db.query(`
      SELECT motif, COUNT(*) as nb
      FROM contact
      WHERE date_creation >= NOW() - INTERVAL '7 days'
      GROUP BY motif
      ORDER BY nb DESC
      LIMIT 1
    `);
    
    // Réclamations non traitées
    const reclamationsNonTraitees = await db.query(`
      SELECT COUNT(*) as reclamations
      FROM contact
      WHERE motif = 'Réclamation'
      AND (statut = 'En attente' OR statut IS NULL)
    `);
    
    // Clients excessifs
    const clientsExcessifs = await db.query(`
      SELECT email, nom, COUNT(*) as contacts
      FROM contact
      WHERE date_creation >= NOW() - INTERVAL '30 days'
      GROUP BY email, nom
      HAVING COUNT(*) > 3
      ORDER BY contacts DESC
    `);
    
    // Délai moyen réponse
    const delaiMoyen = await db.query(`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (date_premiere_reponse - date_creation)) / 3600), 1) as delai
      FROM contact
      WHERE date_premiere_reponse IS NOT NULL
      AND date_creation >= NOW() - INTERVAL '7 days'
    `);
    
    const actions = [];
    if (contactsRetard.rows[0].en_retard > 0) actions.push("📞 Traiter les contacts en attente depuis +24h");
    if (reclamationsNonTraitees.rows[0].reclamations > 0) actions.push("🔴 PRIORITÉ ABSOLUE - Traiter les réclamations");
    if ((delaiMoyen.rows[0].delai || 0) > 4) actions.push("⏱️ Délai de réponse trop long - Optimiser les process");
    if (clientsExcessifs.rows.length > 0) actions.push("📞 Contacter proactivement les clients excessifs");
    if (topMotif.rows[0]?.motif === 'Réclamation') actions.push("⚠️ Les réclamations sont en hausse - Alerter le service qualité");
    
    res.json({
      success: true,
      data: {
        alertes: {
          contacts_en_retard: contactsRetard.rows[0].en_retard,
          reclamations_non_traitees: reclamationsNonTraitees.rows[0].reclamations,
          delai_reponse_actuel: `${delaiMoyen.rows[0].delai || 0}h`,
          objectif_delai: "4h"
        },
        top_motif_semaine: topMotif.rows[0],
        clients_excessifs: clientsExcessifs.rows,
        actions_prioritaires: actions,
        synthese: {
          niveau_urgence: reclamationsNonTraitees.rows[0].reclamations > 0 ? "CRITIQUE" : contactsRetard.rows[0].en_retard > 5 ? "ÉLEVÉ" : "NORMAL",
          message: reclamationsNonTraitees.rows[0].reclamations > 0 
            ? "🚨 Réclamations en attente - Intervention immédiate requise"
            : "Situation normale - Suivre les process standards"
        }
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur tableau bord', error: err.message });
  }
});

// ============================================
// 10. METTRE À JOUR LE STATUT D'UN CONTACT
// ============================================

router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;
    
    const validStatuts = ['En attente', 'En cours', 'Résolu'];
    if (!validStatuts.includes(statut)) {
      return res.status(400).json({ success: false, message: 'Statut invalide' });
    }
    
    const sql = `
      UPDATE contact 
      SET statut = $1, 
          date_traitement = CASE WHEN $1 = 'Résolu' THEN NOW() ELSE date_traitement END,
          date_premiere_reponse = CASE WHEN date_premiere_reponse IS NULL AND $1 != 'En attente' THEN NOW() ELSE date_premiere_reponse END
      WHERE id = $2
      RETURNING *
    `;
    
    const result = await db.query(sql, [statut, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contact non trouvé' });
    }
    
    res.json({
      success: true,
      message: `Statut mis à jour : ${statut}`,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur mise à jour statut', error: err.message });
  }
});

// ============================================
// 11. TABLEAU DE BORD EXÉCUTIF (VISION GLOBALE)
// ============================================

router.get('/analytics/executive', async (req, res) => {
  try {
    const [
      stats,
      motifs,
      tendance,
      satisfaction
    ] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN statut != 'Résolu' THEN 1 END) as open,
          ROUND(CAST(COUNT(CASE WHEN statut = 'Résolu' THEN 1 END) AS DECIMAL) / NULLIF(COUNT(*), 0) * 100, 1) as resolution_rate
        FROM contact
        WHERE date_creation >= DATE_TRUNC('month', NOW())
      `),
      db.query(`
        SELECT motif, COUNT(*) as count
        FROM contact
        WHERE date_creation >= DATE_TRUNC('month', NOW())
        GROUP BY motif
        ORDER BY count DESC
      `),
      db.query(`
        SELECT 
          COUNT(*) as this_month,
          LAG(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', NOW())) as last_month
        FROM contact
        WHERE date_creation >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        GROUP BY DATE_TRUNC('month', date_creation)
      `),
      db.query(`
        SELECT ROUND(AVG(note), 1) as csat
        FROM contact_satisfaction
        WHERE date_evaluation >= DATE_TRUNC('month', NOW())
      `)
    ]);
    
    const evolution = tendance.rows[0]?.this_month - (tendance.rows[0]?.last_month || 0);
    
    res.json({
      success: true,
      data: {
        mois_cours: {
          total: parseInt(stats.rows[0].total) || 0,
          open: parseInt(stats.rows[0].open) || 0,
          taux_resolution: parseFloat(stats.rows[0].resolution_rate) || 0,
          csat: satisfaction.rows[0]?.csat || 0
        },
        evolution_vs_mois_prec: evolution,
        top_motifs: motifs.rows,
        note_globale: satisfaction.rows[0]?.csat >= 4.5 ? "Excellent" 
          : satisfaction.rows[0]?.csat >= 4 ? "Bon" 
          : satisfaction.rows[0]?.csat >= 3 ? "Moyen" 
          : "À améliorer"
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur dashboard exécutif', error: err.message });
  }
});

export default router;