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
        EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 as heures_attente
      FROM contact
      ORDER BY 
        CASE 
          WHEN motif = 'Réclamation' THEN 1
          WHEN motif = 'Support technique' THEN 2
          WHEN motif = 'Demande de démo' THEN 3
          ELSE 4
        END ASC,
        date_creation ASC
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
          haute: haute.length > 0 ? "🟠 À traiter rapidement - Support technique" : null,
          alerte_retard: result.rows.filter(r => r.heures_attente > 48).length > 0 ? "⚠️ Contacts en attente depuis plus de 48h" : null
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
// 3. CONTACTS STAGNANTS (ANCIENS)
// ============================================

router.get('/analytics/backlog', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id, nom, email, motif, sujet,
        date_creation,
        EXTRACT(EPOCH FROM (NOW() - date_creation)) / 24 as jours_attente,
        CASE 
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 < 24 THEN 'Récent'
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 < 72 THEN 'Ancien'
          ELSE 'Très ancien'
        END as anciennete
      FROM contact
      ORDER BY date_creation ASC
    `);
    
    const recent = result.rows.filter(r => r.anciennete === 'Récent');
    const ancien = result.rows.filter(r => r.anciennete === 'Ancien');
    const tresAncien = result.rows.filter(r => r.anciennete === 'Très ancien');
    
    res.json({
      success: true,
      data: {
        synthese: {
          total: result.rows.length,
          recent: recent.length,
          ancien: ancien.length,
          tres_ancien: tresAncien.length
        },
        contacts_anciens: ancien,
        contacts_tres_anciens: tresAncien,
        action_requise: tresAncien.length > 0 ? "📞 Prioriser les contacts très anciens" : null
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
        (CASE 
          WHEN LENGTH(message) > 500 THEN 20
          WHEN LENGTH(message) > 200 THEN 15
          WHEN LENGTH(message) > 100 THEN 10
          ELSE 5
        END) as score_detail,
        CASE 
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 > 72 THEN -20
          WHEN EXTRACT(EPOCH FROM (NOW() - date_creation)) / 3600 > 24 THEN -10
          ELSE 0
        END as penalite_attente,
        CASE 
          WHEN motif = 'Réclamation' THEN 'CRITIQUE'
          WHEN motif = 'Support technique' THEN 'HAUTE'
          WHEN motif = 'Demande de démo' THEN 'MOYENNE'
          ELSE 'BASSE'
        END as priorite
      FROM contact
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
// 5. ANALYSE PAR MOTIF
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
// 6. TOP ÉMETTEURS (CLIENTS LES PLUS ACTIFS)
// ============================================

router.get('/analytics/top-senders', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        email, 
        nom,
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN motif = 'Réclamation' THEN 1 END) as reclamations,
        MAX(date_creation) as dernier_contact,
        MIN(date_creation) as premier_contact
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
// 7. ÉVOLUTION TEMPORELLE
// ============================================

router.get('/analytics/evolution', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        DATE_TRUNC('day', date_creation) as jour,
        COUNT(*) as contacts_jour,
        COUNT(CASE WHEN motif = 'Réclamation' THEN 1 END) as reclamations_jour
      FROM contact
      WHERE date_creation >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', date_creation)
      ORDER BY jour DESC
    `);
    
    const moyenne7j = result.rows.slice(0,7).reduce((a,b) => a + parseInt(b.contacts_jour), 0) / 7;
    const moyenne30j = result.rows.reduce((a,b) => a + parseInt(b.contacts_jour), 0) / result.rows.length;
    let tendance = "stable";
    
    if (moyenne7j > moyenne30j * 1.2) tendance = "hausse";
    else if (moyenne7j < moyenne30j * 0.8) tendance = "baisse";
    
    res.json({
      success: true,
      data: {
        evolution: result.rows,
        tendance: tendance,
        moyenne_7j: moyenne7j.toFixed(1),
        moyenne_30j: moyenne30j.toFixed(1),
        alerte: tendance === "hausse" ? "📈 Augmentation du volume de contacts" : null
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur évolution', error: err.message });
  }
});

// ============================================
// 8. TABLEAU DE BORD DÉCISIONNEL QUOTIDIEN
// ============================================

router.get('/analytics/daily-board', async (req, res) => {
  try {
    // Contacts très anciens (> 72h)
    const contactsAnciens = await db.query(`
      SELECT COUNT(*) as tres_anciens
      FROM contact
      WHERE date_creation < NOW() - INTERVAL '72 hours'
    `);
    
    // Top motif de la semaine
    const topMotif = await db.query(`
      SELECT motif, COUNT(*) as nb
      FROM contact
      WHERE date_creation >= NOW() - INTERVAL '7 days'
      GROUP BY motif
      ORDER BY nb DESC
      LIMIT 1
    `);
    
    // Réclamations non traitées (anciennes)
    const reclamationsAnciennes = await db.query(`
      SELECT COUNT(*) as reclamations
      FROM contact
      WHERE motif = 'Réclamation'
      AND date_creation < NOW() - INTERVAL '24 hours'
    `);
    
    // Clients excessifs (plus de 3 contacts en 30 jours)
    const clientsExcessifs = await db.query(`
      SELECT email, nom, COUNT(*) as contacts
      FROM contact
      WHERE date_creation >= NOW() - INTERVAL '30 days'
      GROUP BY email, nom
      HAVING COUNT(*) > 3
      ORDER BY contacts DESC
    `);
    
    // Volume de la semaine vs semaine dernière
    const volume = await db.query(`
      SELECT 
        COUNT(CASE WHEN date_creation >= DATE_TRUNC('week', NOW()) THEN 1 END) as cette_semaine,
        COUNT(CASE WHEN date_creation >= DATE_TRUNC('week', NOW() - INTERVAL '1 week') 
                   AND date_creation < DATE_TRUNC('week', NOW()) THEN 1 END) as semaine_derniere
      FROM contact
    `);
    
    const actions = [];
    if (contactsAnciens.rows[0].tres_anciens > 0) actions.push("📞 Traiter les contacts très anciens (+72h)");
    if (reclamationsAnciennes.rows[0].reclamations > 0) actions.push("🔴 PRIORITÉ - Traiter les réclamations en attente");
    if (clientsExcessifs.rows.length > 0) actions.push("📞 Contacter proactivement les clients excessifs");
    if (topMotif.rows[0]?.motif === 'Réclamation') actions.push("⚠️ Les réclamations sont en hausse");
    
    const evolutionVolume = volume.rows[0].cette_semaine - volume.rows[0].semaine_derniere;
    
    res.json({
      success: true,
      data: {
        alertes: {
          contacts_tres_anciens: contactsAnciens.rows[0].tres_anciens,
          reclamations_non_traitees: reclamationsAnciennes.rows[0].reclamations
        },
        volume: {
          cette_semaine: parseInt(volume.rows[0].cette_semaine) || 0,
          semaine_derniere: parseInt(volume.rows[0].semaine_derniere) || 0,
          evolution: evolutionVolume,
          tendance: evolutionVolume > 0 ? "📈 Hausse" : evolutionVolume < 0 ? "📉 Baisse" : "➡️ Stable"
        },
        top_motif_semaine: topMotif.rows[0],
        clients_excessifs: clientsExcessifs.rows,
        actions_prioritaires: actions,
        niveau_urgence: reclamationsAnciennes.rows[0].reclamations > 0 ? "CRITIQUE" : contactsAnciens.rows[0].tres_anciens > 5 ? "ÉLEVÉ" : "NORMAL"
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur tableau bord', error: err.message });
  }
});

// ============================================
// 9. ANALYSE DES MESSAGES (LONGUEUR ET CONTENU)
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
          messages_courts: "Messages très courts - Peuvent manquer de détails",
          messages_longs: "Messages détaillés - Clients investis"
        }
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur analyse messages', error: err.message });
  }
});

// ============================================
// 10. TABLEAU DE BORD EXÉCUTIF (SANS TABLE EXTERNE)
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
        ROUND(COUNT(CASE WHEN motif = 'Réclamation' THEN 1 END)::DECIMAL / NULLIF(COUNT(*), 0) * 100, 1) as taux_reclamation,
        ROUND(AVG(LENGTH(message)), 0) as longueur_moyenne_message
      FROM contact
      WHERE date_creation >= DATE_TRUNC('month', NOW())
    `);
    
    const evolution = await db.query(`
      SELECT 
        COUNT(CASE WHEN date_creation >= DATE_TRUNC('month', NOW()) THEN 1 END) as ce_mois,
        COUNT(CASE WHEN date_creation >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
                   AND date_creation < DATE_TRUNC('month', NOW()) THEN 1 END) as mois_dernier
      FROM contact
    `);
    
    const evolutionValue = (evolution.rows[0].ce_mois || 0) - (evolution.rows[0].mois_dernier || 0);
    
    let noteGlobale = "Bon";
    if (result.rows[0].taux_reclamation > 20) noteGlobale = "À améliorer";
    else if (result.rows[0].taux_reclamation > 10) noteGlobale = "Moyen";
    else noteGlobale = "Excellent";
    
    res.json({
      success: true,
      data: {
        mois_cours: {
          total: parseInt(result.rows[0].total_contacts) || 0,
          contacts_uniques: parseInt(result.rows[0].contacts_uniques) || 0,
          reclamations: parseInt(result.rows[0].reclamations) || 0,
          support: parseInt(result.rows[0].support) || 0,
          demandes_demo: parseInt(result.rows[0].demandes_demo) || 0,
          taux_reclamation: parseFloat(result.rows[0].taux_reclamation) || 0,
          longueur_moyenne_message: parseInt(result.rows[0].longueur_moyenne_message) || 0
        },
        evolution_vs_mois_prec: evolutionValue,
        note_globale: noteGlobale,
        recommandation: result.rows[0].taux_reclamation > 20 
          ? "🔴 Taux de réclamation élevé - Action prioritaire"
          : result.rows[0].support > result.rows[0].demandes_demo
          ? "🛠️ Plus de support que de demandes commerciales"
          : "✅ Situation équilibrée"
      }
    });
  } catch (err) {
    console.error('Erreur:', err);
    res.status(500).json({ success: false, message: 'Erreur dashboard exécutif', error: err.message });
  }
});

export default router;