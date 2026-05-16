import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ============================================
// FONCTIONS UTILITAIRES OPTIMISÉES
// ============================================

function calculerEvolution(valeurCourante, valeurReference) {
  if (!valeurReference || valeurReference === 0) return 0;
  return ((parseFloat(valeurCourante || 0) - parseFloat(valeurReference)) / parseFloat(valeurReference)) * 100;
}

function calculerTCAC(valeurDepart, valeurArrivee, nbPeriodes) {
  if (!valeurDepart || valeurDepart === 0 || nbPeriodes === 0) return 0;
  const ratio = parseFloat(valeurArrivee) / parseFloat(valeurDepart);
  return (Math.pow(ratio, 1 / nbPeriodes) - 1) * 100;
}

function getSaisonnalite(mois) {
  const saisons = {
    12: 'HIVER', 1: 'HIVER', 2: 'HIVER',
    3: 'PRINTEMPS', 4: 'PRINTEMPS', 5: 'PRINTEMPS',
    6: 'ETE', 7: 'ETE', 8: 'ETE',
    9: 'AUTOMNE', 10: 'AUTOMNE', 11: 'AUTOMNE'
  };
  return saisons[mois] || 'INCONNU';
}

function getJourSemaine(jour) {
  const jours = {
    0: 'DIMANCHE', 1: 'LUNDI', 2: 'MARDI', 3: 'MERCREDI',
    4: 'JEUDI', 5: 'VENDREDI', 6: 'SAMEDI'
  };
  return jours[jour];
}

// ============================================
// ROUTES SPÉCIALISÉES RÉSERVATIONS
// ============================================

// 📊 Dashboard principal réservations
router.get('/dashboard-reservations', async (req, res) => {
  try {
    const [global, evolution, parJour, parTerrain] = await Promise.all([
      // KPIs globaux
      db.query(`
        SELECT 
          COUNT(*) as total_reservations,
          COUNT(DISTINCT email) as clients_uniques,
          AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne,
          COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée', 'annulée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      `),
      
      // Évolution vs période précédente
      db.query(`
        SELECT 
          COUNT(*) as reservations_courantes
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
      `),
      
      // Réservations par jour (dernière semaine)
      db.query(`
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY EXTRACT(DOW FROM datereservation)
        ORDER BY jour_semaine
      `),
      
      // Top terrains par réservations
      db.query(`
        SELECT 
          numeroterrain,
          nomterrain,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY numeroterrain, nomterrain
        ORDER BY reservations DESC
        LIMIT 5
      `)
    ]);

    const totalCourant = evolution.rows[0]?.reservations_courantes || 0;
    const totalPrecedent = global.rows[0]?.total_reservations || 0;
    const evolutionReservations = calculerEvolution(totalCourant, totalPrecedent);

    res.json({
      success: true,
      periode: '30 derniers jours',
      indicateurs: {
        total_reservations: parseInt(global.rows[0]?.total_reservations || 0),
        clients_uniques: parseInt(global.rows[0]?.clients_uniques || 0),
        duree_moyenne_heures: parseFloat(global.rows[0]?.duree_moyenne || 0),
        taux_annulation: global.rows[0]?.total_reservations > 0 
          ? ((global.rows[0]?.annulations || 0) / global.rows[0]?.total_reservations * 100).toFixed(2)
          : "0.00",
        evolution_reservations: evolutionReservations,
        tendance: evolutionReservations > 15 ? 'FORTE CROISSANCE' :
                  evolutionReservations > 5 ? 'CROISSANCE' :
                  evolutionReservations > -5 ? 'STABLE' : 'BAISSE'
      },
      reservations_par_jour: parJour.rows.map(r => ({
        jour: getJourSemaine(parseInt(r.jour_semaine)),
        reservations: parseInt(r.reservations || 0),
        clients_uniques: parseInt(r.clients_uniques || 0)
      })),
      top_terrains: parTerrain.rows.map(t => ({
        terrain: t.nomterrain,
        reservations: parseInt(t.reservations || 0),
        clients_uniques: parseInt(t.clients_uniques || 0)
      }))
    });
  } catch (error) {
    console.error('❌ Erreur dashboard réservations:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// 📊 Analyse horaire des réservations
router.get('/analyse-horaire', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        EXTRACT(HOUR FROM heurereservation) as heure,
        COUNT(*) as reservations,
        COUNT(DISTINCT email) as clients_uniques,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations,
        AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '30 days'
        AND EXTRACT(HOUR FROM heurereservation) BETWEEN 6 AND 23
      GROUP BY EXTRACT(HOUR FROM heurereservation)
      ORDER BY heure
    `);

    const creneaux = result.rows.map(r => ({
      heure: parseInt(r.heure),
      reservations: parseInt(r.reservations || 0),
      clients_uniques: parseInt(r.clients_uniques || 0),
      taux_annulation: r.reservations > 0 
        ? ((r.annulations || 0) / r.reservations * 100).toFixed(2)
        : "0.00",
      duree_moyenne: parseFloat(r.duree_moyenne || 0)
    }));

    // Analyses supplémentaires
    const heuresPointes = creneaux.filter(c => c.reservations > 20);
    const heuresCreuses = creneaux.filter(c => c.reservations < 5);
    const meilleureHeure = creneaux.reduce((max, c) => c.reservations > max.reservations ? c : max, { reservations: 0 });
    const meilleureFidelisation = creneaux.reduce((max, c) => 
      (c.reservations / c.clients_uniques) > (max.reservations / max.clients_uniques) ? c : max, 
      { reservations: 0, clients_uniques: 1 }
    );

    res.json({
      success: true,
      periode: '30 derniers jours',
      distribution_horaire: creneaux,
      analyses: {
        heures_de_pointe: heuresPointes.map(h => `${h.heure}h - ${h.reservations} résas`),
        heures_creuses: heuresCreuses.map(h => `${h.heure}h - ${h.reservations} résas`),
        meilleur_creneau: {
          heure: meilleureHeure.heure,
          reservations: meilleureHeure.reservations
        },
        meilleur_creneau_fidelisation: {
          heure: meilleureFidelisation.heure,
          ratio_reservations_client: (meilleureFidelisation.reservations / meilleureFidelisation.clients_uniques).toFixed(2)
        },
        recommandations: heuresCreuses.length > 0 
          ? [`Proposer des offres sur les créneaux: ${heuresCreuses.map(h => `${h.heure}h`).join(', ')}`]
          : ['Bonne répartition des réservations sur la journée']
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse horaire:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// 📊 Analyse par type de terrain
router.get('/analyse-par-type-terrain', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        typeterrain,
        COUNT(*) as reservations,
        COUNT(DISTINCT numeroterrain) as nb_terrains,
        COUNT(DISTINCT email) as clients_uniques,
        AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY typeterrain
      ORDER BY reservations DESC
    `);

    const data = result.rows.map(r => ({
      type_terrain: r.typeterrain || 'Non spécifié',
      reservations: parseInt(r.reservations || 0),
      nb_terrains: parseInt(r.nb_terrains || 0),
      reservations_par_terrain: r.nb_terrains > 0 
        ? (r.reservations / r.nb_terrains).toFixed(2)
        : "0.00",
      clients_uniques: parseInt(r.clients_uniques || 0),
      taux_rotation: r.nb_terrains > 0 
        ? (r.reservations / r.nb_terrains / 90).toFixed(2)
        : "0.00",
      taux_annulation: r.reservations > 0 
        ? ((r.annulations || 0) / r.reservations * 100).toFixed(2)
        : "0.00",
      duree_moyenne: parseFloat(r.duree_moyenne || 0)
    }));

    const totalReservations = data.reduce((sum, t) => sum + t.reservations, 0);
    
    res.json({
      success: true,
      periode: '90 derniers jours',
      types_terrain: data,
      resume: {
        total_reservations: totalReservations,
        type_plus_populaire: data[0]?.type_terrain || 'N/A',
        type_meilleur_taux_rotation: data.reduce((best, t) => 
          parseFloat(t.taux_rotation) > parseFloat(best.taux_rotation) ? t : best, data[0]
        )?.type_terrain || 'N/A'
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse type terrain:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// 📊 Évolution mensuelle des réservations
router.get('/evolution-mensuelle', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        DATE_TRUNC('month', datereservation) as mois,
        COUNT(*) as reservations,
        COUNT(DISTINCT email) as nouveaux_clients,
        COUNT(DISTINCT CASE 
          WHEN datereservation = (
            SELECT MIN(datereservation) 
            FROM reservation r2 
            WHERE r2.email = reservation.email
          ) THEN email 
        END) as premier_achat
      FROM reservation
      WHERE statut IN ('confirmée', 'payé', 'terminée')
        AND datereservation >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', datereservation)
      ORDER BY mois DESC
    `);

    const data = result.rows.map((row, index, array) => {
      const reservations = parseInt(row.reservations || 0);
      const evolution = index < array.length - 1 
        ? calculerEvolution(reservations, array[index + 1].reservations)
        : 0;
      
      return {
        mois: row.mois,
        reservations: reservations,
        nouveaux_clients: parseInt(row.nouveaux_clients || 0),
        clients_fideles: parseInt(row.nouveaux_clients || 0) > 0
          ? (reservations - (row.nouveaux_clients || 0))
          : reservations,
        evolution: evolution,
        saison: getSaisonnalie(new Date(row.mois).getMonth() + 1)
      };
    });

    // Calcul du TCAC
    const tcac = data.length >= 2
      ? calculerTCAC(data[data.length-1].reservations, data[0].reservations, data.length)
      : 0;

    res.json({
      success: true,
      periode: '12 derniers mois',
      donnees: data,
      indicateurs: {
        moyenne_mensuelle: (data.reduce((sum, m) => sum + m.reservations, 0) / data.length).toFixed(0),
        mois_creux: data.reduce((min, m) => m.reservations < min.reservations ? m : min, data[0])?.mois,
        mois_record: data.reduce((max, m) => m.reservations > max.reservations ? m : max, data[0])?.mois,
        tcac_annuel: tcac.toFixed(2),
        tendance_globale: tcac > 15 ? 'CROISSANCE RAPIDE' :
                          tcac > 5 ? 'CROISSANCE' :
                          tcac > 0 ? 'LÉGÈRE CROISSANCE' : 'STAGNATION'
      }
    });
  } catch (error) {
    console.error('❌ Erreur evolution mensuelle:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// Helper pour la saisonnalité
function getSaisonnalie(mois) {
  const saisons = {
    12: 'HIVER', 1: 'HIVER', 2: 'HIVER',
    3: 'PRINTEMPS', 4: 'PRINTEMPS', 5: 'PRINTEMPS',
    6: 'ETE', 7: 'ETE', 8: 'ETE',
    9: 'AUTOMNE', 10: 'AUTOMNE', 11: 'AUTOMNE'
  };
  return saisons[mois] || 'INCONNU';
}

// 📊 Analyse des réservations par client
router.get('/analyse-clients-reservations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        email,
        COUNT(*) as nb_reservations,
        COUNT(DISTINCT EXTRACT(MONTH FROM datereservation)) as mois_actifs,
        MIN(datereservation) as premiere_reservation,
        MAX(datereservation) as derniere_reservation,
        AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne,
        COUNT(CASE WHEN statut = 'annulée' THEN 1 END) as annulations
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '180 days'
      GROUP BY email
      HAVING COUNT(*) >= 2
      ORDER BY nb_reservations DESC
      LIMIT 100
    `);

    const clients = result.rows.map(c => {
      const nbReservations = parseInt(c.nb_reservations || 0);
      const moisActifs = parseInt(c.mois_actifs || 0);
      const aujourdhui = new Date();
      const derniereResa = new Date(c.derniere_reservation);
      const joursInactivite = Math.floor((aujourdhui - derniereResa) / (1000 * 60 * 60 * 24));
      
      let profil = 'OCCASIONNEL';
      if (nbReservations >= 20) profil = 'SUPER FIDÈLE';
      else if (nbReservations >= 10) profil = 'TRÈS FIDÈLE';
      else if (nbReservations >= 5) profil = 'FIDÈLE';
      else if (moisActifs >= 2) profil = 'RÉGULIER';
      
      if (joursInactivite > 60 && nbReservations >= 5) profil = 'À RISQUE DE PERTE';
      
      return {
        email: c.email,
        nb_reservations: nbReservations,
        mois_actifs: moisActifs,
        frequence_mensuelle: moisActifs > 0 ? (nbReservations / moisActifs).toFixed(2) : "0.00",
        anciennete_jours: Math.floor((aujourdhui - new Date(c.premiere_reservation)) / (1000 * 60 * 60 * 24)),
        jours_depuis_derniere_resa: joursInactivite,
        taux_annulation: nbReservations > 0 ? ((c.annulations || 0) / nbReservations * 100).toFixed(2) : "0.00",
        duree_moyenne: parseFloat(c.duree_moyenne || 0),
        profil: profil
      };
    });

    // Distribution par profil
    const distribution = clients.reduce((acc, client) => {
      acc[client.profil] = (acc[client.profil] || 0) + 1;
      return acc;
    }, {});

    // Clients à risque
    const clientsARisque = clients.filter(c => c.profil === 'À RISQUE DE PERTE');

    res.json({
      success: true,
      periode: '6 derniers mois',
      clients_analyses: clients.slice(0, 20),
      distribution_profils: distribution,
      alertes: {
        clients_actifs: clients.filter(c => c.jours_depuis_derniere_resa <= 30).length,
        clients_a_risque: clientsARisque.length,
        recommandations: clientsARisque.length > 0 
          ? [`Contacter ${clientsARisque.length} clients à risque de perdre`]
          : []
      }
    });
  } catch (error) {
    console.error('❌ Erreur analyse clients:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// 📊 Comparaison hebdomadaire
router.get('/comparaison-hebdomadaire', async (req, res) => {
  try {
    const result = await db.query(`
      WITH 
      jours_semaine AS (
        SELECT generate_series(0, 6) as jour_num
      ),
      semaine_courante AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY EXTRACT(DOW FROM datereservation)
      ),
      semaine_precedente AS (
        SELECT 
          EXTRACT(DOW FROM datereservation) as jour_semaine,
          COUNT(*) as reservations,
          COUNT(DISTINCT email) as clients_uniques
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '14 days'
          AND datereservation < CURRENT_DATE - INTERVAL '7 days'
        GROUP BY EXTRACT(DOW FROM datereservation)
      )
      SELECT 
        js.jour_num,
        COALESCE(sc.reservations, 0) as resas_courantes,
        COALESCE(sp.reservations, 0) as resas_precedentes,
        COALESCE(sc.clients_uniques, 0) as clients_courants,
        COALESCE(sp.clients_uniques, 0) as clients_precedents
      FROM jours_semaine js
      LEFT JOIN semaine_courante sc ON js.jour_num = sc.jour_semaine
      LEFT JOIN semaine_precedente sp ON js.jour_num = sp.jour_semaine
      ORDER BY js.jour_num
    `);

    const comparaison = result.rows.map(r => ({
      jour: getJourSemaine(parseInt(r.jour_num)),
      reservations: {
        courant: parseInt(r.resas_courantes || 0),
        precedent: parseInt(r.resas_precedentes || 0),
        evolution: calculerEvolution(r.resas_courantes, r.resas_precedentes)
      },
      clients: {
        courant: parseInt(r.clients_courants || 0),
        precedent: parseInt(r.clients_precedents || 0),
        evolution: calculerEvolution(r.clients_courants, r.clients_precedents)
      }
    }));

    const totalCourant = comparaison.reduce((sum, j) => sum + j.reservations.courant, 0);
    const totalPrecedent = comparaison.reduce((sum, j) => sum + j.reservations.precedent, 0);
    const evolutionGlobale = calculerEvolution(totalCourant, totalPrecedent);

    const meilleurJour = comparaison.reduce((best, j) => 
      j.reservations.courant > best.reservations.courant ? j : best, 
      comparaison[0]
    );

    res.json({
      success: true,
      comparaison_journaliere: comparaison,
      synthese: {
        total_semaine_courante: totalCourant,
        total_semaine_precedente: totalPrecedent,
        evolution_globale: evolutionGlobale,
        meilleur_jour: meilleurJour.jour,
        pire_jour: comparaison.reduce((worst, j) => 
          j.reservations.courant < worst.reservations.courant ? j : worst, 
          comparaison[0]
        ).jour,
        jours_en_hausse: comparaison.filter(j => j.reservations.evolution > 0).length,
        jours_en_baisse: comparaison.filter(j => j.reservations.evolution < 0).length
      }
    });
  } catch (error) {
    console.error('❌ Erreur comparaison hebdomadaire:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// 📊 Prévisions réservations (basées sur tendance)
router.get('/previsions-reservations', async (req, res) => {
  try {
    const result = await db.query(`
      WITH mensuel AS (
        SELECT 
          DATE_TRUNC('month', datereservation) as mois,
          COUNT(*) as reservations
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND datereservation >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', datereservation)
        ORDER BY mois
      )
      SELECT 
        mois,
        reservations
      FROM mensuel
    `);

    if (result.rows.length < 3) {
      return res.json({
        success: true,
        message: 'Données insuffisantes pour les prévisions',
        donnees: result.rows
      });
    }

    const historique = result.rows.map(r => ({
      mois: r.mois,
      reservations: parseInt(r.reservations || 0)
    }));

    // Calcul de la tendance linéaire
    const n = historique.length;
    const indices = historique.map((_, i) => i);
    const reservations = historique.map(h => h.reservations);
    
    const moyenneX = indices.reduce((a, b) => a + b, 0) / n;
    const moyenneY = reservations.reduce((a, b) => a + b, 0) / n;
    
    let numerateur = 0, denominateur = 0;
    for (let i = 0; i < n; i++) {
      numerateur += (indices[i] - moyenneX) * (reservations[i] - moyenneY);
      denominateur += Math.pow(indices[i] - moyenneX, 2);
    }
    
    const pente = denominateur !== 0 ? numerateur / denominateur : 0;
    const intercept = moyenneY - pente * moyenneX;
    
    // Prévisions pour les 3 prochains mois
    const previsions = [];
    for (let i = 1; i <= 3; i++) {
      const prevision = pente * (n + i - 1) + intercept;
      const croissance = i === 1 ? ((prevision - reservations[n-1]) / reservations[n-1] * 100) : 0;
      
      previsions.push({
        mois: new Date(new Date().setMonth(new Date().getMonth() + i)).toISOString().slice(0, 7),
        reservations_prevues: Math.max(0, Math.round(prevision)),
        croissance_estimee: croissance.toFixed(2),
        confiance: n >= 6 ? 'MOYENNE' : 'FAIBLE'
      });
    }

    res.json({
      success: true,
      historique: historique,
      previsions: previsions,
      analyse_tendance: {
        pente_mensuelle: pente.toFixed(2),
        reservations_moyennes: moyenneY.toFixed(0),
        saisonnalite_detectee: n >= 12 ? 'OUI' : 'NON (données insuffisantes)',
        recommandations: pente > 10 ? 'Prévoir augmentation capacité' :
                        pente < -5 ? 'Action marketing urgente' :
                        'Tendance stable maintenir efforts'
      }
    });
  } catch (error) {
    console.error('❌ Erreur previsions reservations:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// 📊 Analyse des annulations
router.get('/analyse-annulations', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        DATE_TRUNC('week', datereservation) as semaine,
        COUNT(*) as total_reservations,
        SUM(CASE WHEN statut = 'annulée' THEN 1 ELSE 0 END) as annulations,
        AVG(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as duree_moyenne,
        EXTRACT(HOUR FROM heurereservation) as heure_reservation
      FROM reservation
      WHERE datereservation >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY DATE_TRUNC('week', datereservation), EXTRACT(HOUR FROM heurereservation)
      ORDER BY semaine DESC
    `);

    const tauxAnnulationGlobal = result.rows.reduce((sum, r) => sum + (r.annulations || 0), 0) / 
                                 result.rows.reduce((sum, r) => sum + (r.total_reservations || 0), 0) * 100;

    const annulationsParHeure = result.rows.reduce((acc, r) => {
      const heure = r.heure_reservation;
      if (!acc[heure]) acc[heure] = { total: 0, annulees: 0 };
      acc[heure].total += parseInt(r.total_reservations || 0);
      acc[heure].annulees += parseInt(r.annulations || 0);
      return acc;
    }, {});

    const heuresCritiques = Object.entries(annulationsParHeure)
      .map(([heure, data]) => ({
        heure: parseInt(heure),
        taux: data.total > 0 ? (data.annulees / data.total * 100).toFixed(2) : 0
      }))
      .filter(h => h.taux > 15)
      .sort((a, b) => b.taux - a.taux);

    res.json({
      success: true,
      periode: '90 derniers jours',
      indicateurs: {
        taux_annulation_global: tauxAnnulationGlobal.toFixed(2),
        moyenne_annulations_semaine: (result.rows.reduce((sum, r) => sum + (r.annulations || 0), 0) / 13).toFixed(1),
        pire_semaine: result.rows.reduce((worst, r) => 
          ((r.annulations || 0) / (r.total_reservations || 1)) > worst.taux ? 
          { semaine: r.semaine, taux: (r.annulations || 0) / (r.total_reservations || 1) } : worst, 
          { taux: 0 }
        ).semaine
      },
      heures_risque_annulation: heuresCritiques,
      recommandations: heuresCritiques.length > 0 
        ? ['Mettre en place rappels SMS avant réservation', 'Offrir option de rebooking facile']
        : ['Taux d\'annulation sous contrôle']
    });
  } catch (error) {
    console.error('❌ Erreur analyse annulations:', error.message);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ============================================
// ROUTE DE TEST ET SANTÉ
// ============================================

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API d\'analyse de réservations optimisée fonctionnelle',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    focus: '100% réservations et métriques associées',
    endpoints_disponibles: [
      '/dashboard-reservations',
      '/analyse-horaire',
      '/analyse-par-type-terrain',
      '/evolution-mensuelle',
      '/analyse-clients-reservations',
      '/comparaison-hebdomadaire',
      '/previsions-reservations',
      '/analyse-annulations',
      '/test',
      '/sante'
    ]
  });
});

router.get('/sante', async (req, res) => {
  try {
    const test = await db.query('SELECT NOW() as timestamp');
    const count = await db.query('SELECT COUNT(*) as total FROM reservation');
    
    res.json({
      success: true,
      status: 'OK',
      timestamp: test.rows[0].timestamp,
      base_de_donnees: 'connectée',
      total_reservations: parseInt(count.rows[0].total),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'ERREUR',
      message: error.message
    });
  }
});

export default router;