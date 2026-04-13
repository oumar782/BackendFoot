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
        COUNT(DISTINCT email) as contacts_uniques,
        SUM(CASE WHEN motif = 'Réclamation' THEN 1 ELSE 0 END) as reclamations,
        SUM(CASE WHEN motif = 'Support technique' THEN 1 ELSE 0 END) as support_technique,
        SUM(CASE WHEN motif = 'Demande de démo' THEN 1 ELSE 0 END) as demandes_demo,
        SUM(CASE WHEN motif = 'Information commerciale' THEN 1 ELSE 0 END) as info_commerciale,
        ROUND(AVG(LENGTH(message)), 0) as longueur_moyenne_message
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
// 2. CONTACTS URGENTS PAR MOTIF
// ============================================

router.get('/analytics/urgent', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, nom, email, motif, sujet, message,
        CASE 
          WHEN motif = 'Réclamation' THEN 'CRITIQUE'
          WHEN motif = 'Support technique' THEN 'HAUTE'
          WHEN motif = 'Demande de démo' THEN 'MOYENNE'
          ELSE 'BASSE'
        END as priorite
      FROM contact
      ORDER BY 
        CASE 
          WHEN motif = 'Réclamation' THEN 1
          WHEN motif = 'Support technique' THEN 2
          WHEN motif = 'Demande de démo' THEN 3
          ELSE 4
        END ASC
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
          haute: haute.length > 0 ? "🟠 À traiter rapidement - Support technique" : null
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
// 3. SCORING DES CONTACTS
// ============================================

router.get('/analytics/scoring', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, nom, email, motif, sujet, message,
        LENGTH(message) as longueur_message,
        (CASE 
          WHEN motif = 'Réclamation' THEN 100
          WHEN motif = 'Support technique' THEN 80
          WHEN motif = 'Demande de démo' THEN 60
          WHEN motif = 'Information commerciale' THEN 40
          ELSE 20
        END) as score_priorite,
        (CASE 
          WHEN LENGTH(message) > 500 THEN 20
          WHEN LENGTH(message) > 200 THEN 15
          WHEN LENGTH(message) > 100 THEN 10
          ELSE 5
        END) as score_detail,
        CASE 
          WHEN motif = 'Réclamation' THEN 'CRITIQUE'
          WHEN motif = 'Support technique' THEN 'HAUTE'
          WHEN motif = 'Demande de démo' THEN 'MOYENNE'
          ELSE 'BASSE'
        END as priorite
      FROM contact
      ORDER BY score_priorite DESC
    `);
    
    const contactsAvecScore = result.rows.map(row => ({
      ...row,
      score_total: Math.min(row.score_priorite + row.score_detail, 100)
    }));
    
    res.json({
      success: true,
      data: {
        resume: {
          total: contactsAvecScore.length,
          score_moyen: (contactsAvecScore.reduce((a,b) => a + b.score_total, 0) / contactsAvecScore.length || 0).toFixed(1)
        },
        contacts: contactsAvecScore,
        priorites: {
          urgent: contactsAvecScore.filter(c => c.score_total >= 80),
          a_suivre: contactsAvecScore.filter(c => c.score_total >= 60 && c.score_total < 80),
          standard: contactsAvecScore.filter(c => c.score_total < 60)
        }
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur scoring', error: err.message });
  }
});

// ============================================
// 4. ANALYSE PAR MOTIF
// ============================================

router.get('/analytics/by-motif', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        motif,
        COUNT(*) as total,
        COUNT(DISTINCT email) as contacts_uniques
      FROM contact
      WHERE motif IS NOT NULL
      GROUP BY motif
      ORDER BY total DESC
    `);
    
    const motifPrincipal = result.rows[0]?.motif;
    let recommandation = "";
    
    if (motifPrincipal === 'Réclamation') {
      recommandation = "⚠️ Les réclamations sont le motif principal - Auditer le produit/service";
    } else if (motifPrincipal === 'Support technique') {
      recommandation = "🛠️ Beaucoup de support technique - Créer une base de connaissances";
    } else if (motifPrincipal === 'Demande de démo') {
      recommandation = "📊 Fort intérêt commercial - Renforcer l'équipe sales";
    } else {
      recommandation = "📋 Analyser pourquoi ce motif est le plus fréquent";
    }
    
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
// 5. TOP ÉMETTEURS (CLIENTS LES PLUS ACTIFS)
// ============================================

router.get('/analytics/top-senders', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        email, 
        nom,
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN motif = 'Réclamation' THEN 1 END) as reclamations,
        STRING_AGG(DISTINCT motif, ', ') as motifs
      FROM contact
      WHERE email IS NOT NULL
      GROUP BY email, nom
      ORDER BY total_contacts DESC
      LIMIT 10
    `);
    
    const clientsRisque = result.rows.filter(r => r.total_contacts >= 3 || r.reclamations >= 2);
    
    res.json({
      success: true,
      data: {
        top_emetteurs: result.rows,
        clients_a_surveiller: clientsRisque,
        recommandation: clientsRisque.length > 0 
          ? "📞 Contacter proactivement ces clients"
          : null
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur top émetteurs', error: err.message });
  }
});

// ============================================
// 6. ANALYSE DES MESSAGES (LONGUEUR ET CONTENU)
// ============================================

router.get('/analytics/messages-analysis', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total,
        ROUND(AVG(LENGTH(message)), 0) as longueur_moyenne,
        COUNT(CASE WHEN LENGTH(message) < 50 THEN 1 END) as messages_courts,
        COUNT(CASE WHEN LENGTH(message) BETWEEN 50 AND 200 THEN 1 END) as messages_moyens,
        COUNT(CASE WHEN LENGTH(message) > 200 THEN 1 END) as messages_longs,
        ROUND(AVG(LENGTH(message)) FILTER (WHERE motif = 'Réclamation'), 0) as longueur_moyenne_reclamation,
        ROUND(AVG(LENGTH(message)) FILTER (WHERE motif = 'Support technique'), 0) as longueur_moyenne_support
      FROM contact
    `);
    
    res.json({
      success: true,
      data: {
        ...result.rows[0],
        interpretation: {
          messages_courts: result.rows[0].messages_courts > result.rows[0].messages_longs ? "Majorité de messages courts - Peuvent manquer de détails" : "Majorité de messages détaillés",
          qualite: result.rows[0].longueur_moyenne > 150 ? "Bonne qualité de détail" : "Messages relativement courts"
        }
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur analyse messages', error: err.message });
  }
});

// ============================================
// 7. TABLEAU DE BORD DÉCISIONNEL
// ============================================

router.get('/analytics/daily-board', async (req, res) => {
  try {
    // Top motif global
    const topMotif = await db.query(`
      SELECT motif, COUNT(*) as nb
      FROM contact
      GROUP BY motif
      ORDER BY nb DESC
      LIMIT 1
    `);
    
    // Réclamations
    const reclamations = await db.query(`
      SELECT COUNT(*) as reclamations
      FROM contact
      WHERE motif = 'Réclamation'
    `);
    
    // Clients excessifs (plus de 3 contacts)
    const clientsExcessifs = await db.query(`
      SELECT email, nom, COUNT(*) as contacts
      FROM contact
      WHERE email IS NOT NULL
      GROUP BY email, nom
      HAVING COUNT(*) > 3
      ORDER BY contacts DESC
    `);
    
    // Support technique vs Demandes démo
    const comparatif = await db.query(`
      SELECT 
        COUNT(CASE WHEN motif = 'Support technique' THEN 1 END) as support,
        COUNT(CASE WHEN motif = 'Demande de démo' THEN 1 END) as demandes_demo
      FROM contact
    `);
    
    const actions = [];
    if (reclamations.rows[0].reclamations > 0) actions.push("🔴 PRIORITÉ - Traiter les réclamations en premier");
    if (clientsExcessifs.rows.length > 0) actions.push("📞 Contacter proactivement les clients excessifs");
    if (topMotif.rows[0]?.motif === 'Réclamation') actions.push("⚠️ Les réclamations sont le motif principal");
    if (comparatif.rows[0].support > comparatif.rows[0].demandes_demo * 2) actions.push("🛠️ Beaucoup de support technique - Investiguer");
    
    let niveauUrgence = "NORMAL";
    if (reclamations.rows[0].reclamations > 10) niveauUrgence = "CRITIQUE";
    else if (reclamations.rows[0].reclamations > 3) niveauUrgence = "ÉLEVÉ";
    
    res.json({
      success: true,
      data: {
        alertes: {
          total_reclamations: reclamations.rows[0].reclamations,
          clients_excessifs: clientsExcessifs.rows.length
        },
        comparatif_support_vs_demo: {
          support: parseInt(comparatif.rows[0].support) || 0,
          demandes_demo: parseInt(comparatif.rows[0].demandes_demo) || 0,
          ratio: (comparatif.rows[0].support / NULLIF(comparatif.rows[0].demandes_demo, 0)).toFixed(1)
        },
        top_motif_global: topMotif.rows[0],
        clients_excessifs: clientsExcessifs.rows,
        actions_prioritaires: actions,
        niveau_urgence: niveauUrgence
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur tableau bord', error: err.message });
  }
});

// ============================================
// 8. TABLEAU DE BORD EXÉCUTIF (SANS DATE)
// ============================================

router.get('/analytics/executive', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_contacts,
        COUNT(DISTINCT email) as contacts_uniques,
        COUNT(CASE WHEN motif = 'Réclamation' THEN 1 END) as reclamations,
        COUNT(CASE WHEN motif = 'Support technique' THEN 1 END) as support,
        COUNT(CASE WHEN motif = 'Demande de démo' THEN 1 END) as demandes_demo,
        COUNT(CASE WHEN motif = 'Information commerciale' THEN 1 END) as info_commerciale,
        ROUND(COUNT(CASE WHEN motif = 'Réclamation' THEN 1 END)::DECIMAL / NULLIF(COUNT(*), 0) * 100, 1) as taux_reclamation,
        ROUND(AVG(LENGTH(message)), 0) as longueur_moyenne_message
      FROM contact
    `);
    
    let noteGlobale = "Bon";
    let recommandation = "";
    
    if (result.rows[0].taux_reclamation > 20) {
      noteGlobale = "Critique";
      recommandation = "🔴 Taux de réclamation élevé (>20%) - Action prioritaire";
    } else if (result.rows[0].taux_reclamation > 10) {
      noteGlobale = "À améliorer";
      recommandation = "🟠 Taux de réclamation modéré - À surveiller";
    } else if (result.rows[0].support > result.rows[0].demandes_demo * 2) {
      noteGlobale = "Déséquilibré";
      recommandation = "🛠️ Beaucoup de support technique - Revoir la documentation";
    } else {
      recommandation = "✅ Situation équilibrée - Maintenir les efforts";
    }
    
    res.json({
      success: true,
      data: {
        synthese: {
          total_contacts: parseInt(result.rows[0].total_contacts) || 0,
          contacts_uniques: parseInt(result.rows[0].contacts_uniques) || 0,
          taux_reclamation: parseFloat(result.rows[0].taux_reclamation) || 0,
          longueur_moyenne_message: parseInt(result.rows[0].longueur_moyenne_message) || 0
        },
        details: {
          reclamations: parseInt(result.rows[0].reclamations) || 0,
          support_technique: parseInt(result.rows[0].support) || 0,
          demandes_demo: parseInt(result.rows[0].demandes_demo) || 0,
          info_commerciale: parseInt(result.rows[0].info_commerciale) || 0
        },
        note_globale: noteGlobale,
        recommandation: recommandation
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur dashboard exécutif', error: err.message });
  }
});

// ============================================
// 9. ANALYSE DES SUJETS LES PLUS FRÉQUENTS
// ============================================

router.get('/analytics/top-subjects', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        sujet,
        COUNT(*) as occurrences,
        COUNT(DISTINCT email) as contacts_distincts,
        STRING_AGG(DISTINCT motif, ', ') as motifs_associes
      FROM contact
      WHERE sujet IS NOT NULL AND sujet != ''
      GROUP BY sujet
      ORDER BY occurrences DESC
      LIMIT 10
    `);
    
    res.json({
      success: true,
      data: {
        top_sujets: result.rows,
        recommandation: result.rows[0]?.occurrences > 5 
          ? `📌 Le sujet "${result.rows[0].sujet}" revient ${result.rows[0].occurrences} fois - Créer une réponse type`
          : null
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur top sujets', error: err.message });
  }
});

export default router;