import express from 'express';
const router = express.Router();
import db from '../db.js';

// 1️⃣ ANALYSE D'UTILISATION DES TERRAINS
router.get('/analyse/utilisation-terrains', async (req, res) => {
    try {
        const { periode, limit } = req.query;
        let dateFilter = '';
        
        if (periode === 'semaine') {
            dateFilter = "AND datecreneaux >= CURRENT_DATE - INTERVAL '7 days'";
        } else if (periode === 'mois') {
            dateFilter = "AND datecreneaux >= CURRENT_DATE - INTERVAL '30 days'";
        }

        // 1. Terrains les plus réservés
        const terrainsPopulaires = await db.query(`
            SELECT 
                numeroterrain,
                nomterrain,
                typeterrain,
                surfaceterrains,
                COUNT(*) as nombre_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations_confirmees,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_disponibles,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            WHERE 1=1 ${dateFilter}
            GROUP BY numeroterrain, nomterrain, typeterrain, surfaceterrains
            ORDER BY reservations_confirmees DESC
            ${limit ? `LIMIT ${limit}` : ''}
        `);

        // 2. Jours/horaires les plus populaires
        const horairesPopulaires = await db.query(`
            SELECT 
                EXTRACT(DOW FROM datecreneaux) as jour_semaine,
                TO_CHAR(datecreneaux, 'Day') as nom_jour,
                EXTRACT(HOUR FROM heuredebut) as heure_debut,
                COUNT(*) as nombre_reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            WHERE Statut = 'réservé'
            ${dateFilter}
            GROUP BY EXTRACT(DOW FROM datecreneaux), TO_CHAR(datecreneaux, 'Day'), EXTRACT(HOUR FROM heuredebut)
            ORDER BY nombre_reservations DESC
        `);

        // 3. Créneaux morts (rarement réservés)
        const creneauxMorts = await db.query(`
            SELECT 
                EXTRACT(DOW FROM datecreneaux) as jour_semaine,
                TO_CHAR(datecreneaux, 'Day') as nom_jour,
                EXTRACT(HOUR FROM heuredebut) as heure_debut,
                numeroterrain,
                nomterrain,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            WHERE 1=1 ${dateFilter}
            GROUP BY EXTRACT(DOW FROM datecreneaux), TO_CHAR(datecreneaux, 'Day'), EXTRACT(HOUR FROM heuredebut), numeroterrain, nomterrain
            HAVING COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) = 0
            OR (COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)) < 10
            ORDER BY taux_occupation ASC
        `);

        // 4. Distribution horaire globale
        const distributionHoraire = await db.query(`
            SELECT 
                CASE 
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 8 AND 11 THEN 'Matin (8h-12h)'
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 12 AND 17 THEN 'Après-midi (12h-18h)'
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 18 AND 22 THEN 'Soir (18h-22h)'
                    ELSE 'Nuit'
                END as plage_horaire,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            WHERE 1=1 ${dateFilter}
            GROUP BY plage_horaire
            ORDER BY taux_occupation DESC
        `);

        // 5. Durée moyenne des réservations
        const dureeMoyenne = await db.query(`
            SELECT 
                numeroterrain,
                nomterrain,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures,
                COUNT(*) as nombre_reservations
            FROM creneaux
            WHERE Statut = 'réservé'
            ${dateFilter}
            GROUP BY numeroterrain, nomterrain
            ORDER BY duree_moyenne_heures DESC
        `);

        res.json({
            success: true,
            data: {
                terrains_populaires: terrainsPopulaires.rows,
                horaires_peuples: horairesPopulaires.rows,
                creneaux_morts: creneauxMorts.rows,
                distribution_horaire: distributionHoraire.rows,
                duree_moyenne_reservations: dureeMoyenne.rows,
                recommendations: {
                    ajustements_horaires: creneauxMorts.rows.length > 10 ? 
                        "Réduire les créneaux du " + creneauxMorts.rows.slice(0, 3).map(c => c.nom_jour).join(', ') : 
                        "Horaires bien optimisés",
                    promotions: distributionHoraire.rows.filter(p => p.taux_occupation < 50).map(p => p.plage_horaire).join(', ')
                }
            }
        });
    } catch (err) {
        console.error('Erreur analyse utilisation:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de l\'utilisation',
            error: err.message 
        });
    }
});

// 2️⃣ ANALYSE TAUX D'OCCUPATION & PERTES
router.get('/analyse/taux-occupation', async (req, res) => {
    try {
        const { date_debut, date_fin } = req.query;
        let dateCondition = '';
        
        if (date_debut && date_fin) {
            dateCondition = `WHERE datecreneaux BETWEEN '${date_debut}' AND '${date_fin}'`;
        }

        // Statistiques générales d'occupation
        const statsOccupation = await db.query(`
            SELECT 
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_disponibles,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation_global,
                COUNT(DISTINCT datecreneaux) as jours_analyses,
                ROUND(COUNT(CASE WHEN Statut = 'réservé' THEN 1 END)::numeric / COUNT(DISTINCT datecreneaux), 1) as reservations_par_jour,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total,
                SUM(CASE WHEN Statut = 'disponible' THEN tarif ELSE 0 END) as revenu_perdu_potentiel
            FROM creneaux
            ${dateCondition}
        `);

        // Pertes par jour (créneaux disponibles)
        const pertesParJour = await db.query(`
            SELECT 
                datecreneaux,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_non_reserves,
                ROUND((COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_non_occupation,
                SUM(CASE WHEN Statut = 'disponible' THEN EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600 ELSE 0 END) as heures_perdues,
                SUM(CASE WHEN Statut = 'disponible' THEN tarif ELSE 0 END) as revenu_perdu
            FROM creneaux
            ${dateCondition}
            GROUP BY datecreneaux
            ORDER BY datecreneaux DESC
        `);

        // Pertes par terrain
        const pertesParTerrain = await db.query(`
            SELECT 
                numeroterrain,
                nomterrain,
                typeterrain,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_non_reserves,
                ROUND((COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_non_occupation,
                SUM(CASE WHEN Statut = 'disponible' THEN tarif ELSE 0 END) as revenu_perdu,
                ROUND(AVG(CASE WHEN Statut = 'disponible' THEN tarif ELSE NULL END), 2) as tarif_moyen_non_reserve
            FROM creneaux
            ${dateCondition}
            GROUP BY numeroterrain, nomterrain, typeterrain
            ORDER BY revenu_perdu DESC
        `);

        // Analyse hebdomadaire
        const analyseHebdo = await db.query(`
            SELECT 
                EXTRACT(DOW FROM datecreneaux) as jour_numero,
                TO_CHAR(datecreneaux, 'Day') as jour_nom,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                SUM(CASE WHEN Statut = 'disponible' THEN tarif ELSE 0 END) as revenu_perdu,
                ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen_reserve
            FROM creneaux
            ${dateCondition}
            GROUP BY EXTRACT(DOW FROM datecreneaux), TO_CHAR(datecreneaux, 'Day')
            ORDER BY jour_numero
        `);

        // Calcul des totaux pour les recommandations
        const totalHeuresPerdues = pertesParJour.rows.reduce((sum, row) => sum + parseFloat(row.heures_perdues || 0), 0);
        const totalRevenuPerdu = pertesParTerrain.rows.reduce((sum, row) => sum + parseFloat(row.revenu_perdu || 0), 0);
        const joursAnalyse = pertesParJour.rows.length || 1;

        res.json({
            success: true,
            data: {
                stats_globales: statsOccupation.rows[0],
                pertes_par_jour: pertesParJour.rows,
                pertes_par_terrain: pertesParTerrain.rows,
                analyse_hebdomadaire: analyseHebdo.rows,
                resume_perdus: {
                    total_heures_perdues: totalHeuresPerdues.toFixed(1),
                    total_revenu_perdu: totalRevenuPerdu.toFixed(2),
                    moyenne_heures_perdues_par_jour: (totalHeuresPerdues / joursAnalyse).toFixed(1),
                    moyenne_revenu_perdu_par_jour: (totalRevenuPerdu / joursAnalyse).toFixed(2)
                },
                recommendations: {
                    acompte: totalRevenuPerdu > 1000 ? "Exiger un acompte de 30% pour les réservations > 50€" : "Système actuel acceptable",
                    annulation: "Politique d'annulation 48h avant avec pénalité de 20%",
                    automation: totalHeuresPerdues > 100 ? "Automatiser les rappels 24h avant" : "Système manuel suffisant",
                    promotions: analyseHebdo.rows.filter(h => h.taux_occupation < 40).map(h => `-20% le ${h.jour_nom.trim()}`).join(', ')
                }
            }
        });
    } catch (err) {
        console.error('Erreur analyse occupation:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse du taux d\'occupation',
            error: err.message 
        });
    }
});

// 3️⃣ ANALYSE FINANCIÈRE
router.get('/analyse/financiere', async (req, res) => {
    try {
        const { date_debut, date_fin, group_by } = req.query;
        let dateCondition = '';
        let groupByClause = 'numeroterrain';
        
        if (date_debut && date_fin) {
            dateCondition = `WHERE datecreneaux BETWEEN '${date_debut}' AND '${date_fin}'`;
        }
        
        if (group_by === 'type') {
            groupByClause = 'typeterrain';
        } else if (group_by === 'surface') {
            groupByClause = 'surfaceterrains';
        } else if (group_by === 'jour') {
            groupByClause = 'datecreneaux';
        } else if (group_by === 'nom') {
            groupByClause = 'nomterrain';
        }

        // Chiffre d'affaires par critère
        const caParCritere = await db.query(`
            SELECT 
                ${groupByClause},
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations_confirmees,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as chiffre_affaires,
                ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                MAX(tarif) as tarif_max,
                MIN(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END) as tarif_min_reserve,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            ${dateCondition}
            GROUP BY ${groupByClause}
            ORDER BY chiffre_affaires DESC
        `);

        // Analyse par surface
        const analyseSurface = await db.query(`
            SELECT 
                surfaceterrains,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total,
                ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                ROUND((SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(*)), 2) as rendement_par_creneau,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures
            FROM creneaux
            ${dateCondition}
            GROUP BY surfaceterrains
            ORDER BY rendement_par_creneau DESC
        `);

        // Analyse par type de terrain
        const analyseType = await db.query(`
            SELECT 
                typeterrain,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total,
                ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures
            FROM creneaux
            ${dateCondition}
            GROUP BY typeterrain
            ORDER BY ca_total DESC
        `);

        // Rentabilité par terrain détaillée
        const rentabiliteTerrain = await db.query(`
            SELECT 
                numeroterrain,
                nomterrain,
                typeterrain,
                surfaceterrains,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total,
                ROUND((SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(*)), 2) as rendement_moyen_par_creneau,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen_reserve,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures,
                ROUND(SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(DISTINCT datecreneaux), 2) as ca_moyen_par_jour
            FROM creneaux
            ${dateCondition}
            GROUP BY numeroterrain, nomterrain, typeterrain, surfaceterrains
            ORDER BY rendement_moyen_par_creneau DESC
        `);

        // Top 5 des meilleurs créneaux (plus rentables)
        const topCreneaux = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heuredebut) as heure_debut,
                EXTRACT(HOUR FROM heurefin) as heure_fin,
                typeterrain,
                surfaceterrains,
                COUNT(*) as nombre_reservations,
                ROUND(AVG(tarif), 2) as tarif_moyen,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total
            FROM creneaux
            ${dateCondition}
            GROUP BY EXTRACT(HOUR FROM heuredebut), EXTRACT(HOUR FROM heurefin), typeterrain, surfaceterrains
            HAVING COUNT(*) >= 5
            ORDER BY ca_total DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            data: {
                ca_par_critere: caParCritere.rows,
                analyse_surface: analyseSurface.rows,
                analyse_type: analyseType.rows,
                rentabilite_terrains: rentabiliteTerrain.rows,
                top_creneaux: topCreneaux.rows,
                recommendations: {
                    investissement: rentabiliteTerrain.rows.slice(0, 3)
                        .map(t => `${t.nomterrain || `Terrain ${t.numeroterrain}`} (rendement: ${t.rendement_moyen_par_creneau}€/créneau)`).join(', '),
                    revision_tarifs: analyseSurface.rows.filter(s => s.taux_occupation > 80 && s.tarif_moyen < (analyseSurface.rows.reduce((sum, r) => sum + r.tarif_moyen, 0) / analyseSurface.rows.length))
                        .map(s => `Augmenter ${s.surfaceterrains} de 10-15%`).join(', '),
                    developpement: topCreneaux.rows.slice(0, 3)
                        .map(c => `Créneaux ${c.heure_debut}h-${c.heure_fin}h sur ${c.typeterrain}`).join(', ')
                }
            }
        });
    } catch (err) {
        console.error('Erreur analyse financière:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse financière',
            error: err.message 
        });
    }
});

// 4️⃣ ANALYSE DE POLITIQUE DE PRIX
router.get('/analyse/tarification', async (req, res) => {
    try {
        const { terrain, type, surface } = req.query;
        let whereConditions = ['Statut = \'réservé\''];
        
        if (terrain) whereConditions.push(`numeroterrain = '${terrain}'`);
        if (type) whereConditions.push(`typeterrain = '${type}'`);
        if (surface) whereConditions.push(`surfaceterrains = '${surface}'`);

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Analyse de tarification par plage horaire
        const tarifsParHoraire = await db.query(`
            SELECT 
                CASE 
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 8 AND 11 THEN 'Matin (8h-12h)'
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 12 AND 17 THEN 'Après-midi (12h-18h)'
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 18 AND 22 THEN 'Soir (18h-22h)'
                    ELSE 'Nuit'
                END as plage_horaire,
                COUNT(*) as nombre_reservations,
                AVG(tarif) as tarif_moyen,
                MIN(tarif) as tarif_min,
                MAX(tarif) as tarif_max,
                ROUND(STDDEV(tarif), 2) as ecart_type,
                ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM creneaux ${whereClause})), 2) as part_marche,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures
            FROM creneaux
            ${whereClause}
            GROUP BY plage_horaire
            ORDER BY tarif_moyen DESC
        `);

        // Corrélation tarif/occupation
        const correlationTarifOccupation = await db.query(`
            SELECT 
                ROUND(tarif / 5) * 5 as tranche_tarif,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                ROUND(AVG(tarif), 2) as tarif_moyen_tranche,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures
            FROM creneaux
            GROUP BY tranche_tarif
            ORDER BY tranche_tarif
        `);

        // Terrains sous-facturés vs sur-facturés
        const analyseTarifsTerrains = await db.query(`
            WITH stats_categorie AS (
                SELECT 
                    typeterrain,
                    surfaceterrains,
                    AVG(tarif) as tarif_moyen_categorie,
                    COUNT(*) as total_categorie
                FROM creneaux
                WHERE Statut = 'réservé'
                GROUP BY typeterrain, surfaceterrains
            )
            SELECT 
                c.numeroterrain,
                c.nomterrain,
                c.typeterrain,
                c.surfaceterrains,
                COUNT(*) as nombre_reservations,
                ROUND(AVG(c.tarif), 2) as tarif_moyen_terrain,
                s.tarif_moyen_categorie,
                ROUND(AVG(c.tarif) - s.tarif_moyen_categorie, 2) as difference_tarif,
                ROUND((AVG(c.tarif) - s.tarif_moyen_categorie) * 100.0 / s.tarif_moyen_categorie, 2) as pourcentage_difference,
                CASE 
                    WHEN AVG(c.tarif) < s.tarif_moyen_categorie * 0.9 THEN 'Sous-facturé'
                    WHEN AVG(c.tarif) > s.tarif_moyen_categorie * 1.1 THEN 'Sur-facturé'
                    ELSE 'Correctement facturé'
                END as statut_tarif,
                ROUND((COUNT(CASE WHEN c.Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux c
            JOIN stats_categorie s ON c.typeterrain = s.typeterrain AND c.surfaceterrains = s.surfaceterrains
            GROUP BY c.numeroterrain, c.nomterrain, c.typeterrain, c.surfaceterrains, s.tarif_moyen_categorie
            ORDER BY ABS(difference_tarif) DESC
        `);

        // Analyse d'élasticité des prix par type/surface
        const elasticitePrix = await db.query(`
            SELECT 
                typeterrain,
                surfaceterrains,
                ROUND(AVG(tarif), 2) as tarif_moyen,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures,
                CASE 
                    WHEN (COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)) > 80 
                         AND AVG(tarif) < (SELECT AVG(tarif) FROM creneaux WHERE Statut = 'réservé') THEN 'Augmenter prix possible'
                    WHEN (COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)) < 50 
                         AND AVG(tarif) > (SELECT AVG(tarif) FROM creneaux WHERE Statut = 'réservé') THEN 'Baisser prix ou promotions'
                    ELSE 'Prix adapté'
                END as recommandation_prix
            FROM creneaux
            GROUP BY typeterrain, surfaceterrains
            HAVING COUNT(*) >= 10
            ORDER BY taux_occupation DESC
        `);

        // Analyse des créneaux premium
        const creneauxPremium = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heuredebut) as heure,
                typeterrain,
                surfaceterrains,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND(AVG(tarif), 2) as tarif_moyen,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                CASE 
                    WHEN (COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)) > 85 
                         AND AVG(tarif) > (SELECT AVG(tarif) FROM creneaux) THEN 'Créneau premium'
                    ELSE 'Créneau standard'
                END as categorie
            FROM creneaux
            GROUP BY EXTRACT(HOUR FROM heuredebut), typeterrain, surfaceterrains
            HAVING COUNT(*) >= 5
            ORDER BY tarif_moyen DESC
            LIMIT 15
        `);

        res.json({
            success: true,
            data: {
                analyse_plages_horaires: tarifsParHoraire.rows,
                correlation_tarif_occupation: correlationTarifOccupation.rows,
                analyse_tarifs_terrains: analyseTarifsTerrains.rows,
                elasticite_prix: elasticitePrix.rows,
                creneaux_premium: creneauxPremium.rows,
                recommendations: {
                    tarification_dynamique: tarifsParHoraire.rows
                        .filter(p => p.taux_occupation > 80 && p.part_marche > 20)
                        .map(p => `+15% ${p.plage_horaire}`),
                    promotions_strategiques: correlationTarifOccupation.rows
                        .filter(t => t.taux_occupation < 40 && t.tranche_tarif > 30)
                        .map(t => `Pack 10h à ${t.tranche_tarif * 0.8}€/h`),
                    ajustements_urgents: analyseTarifsTerrains.rows
                        .filter(t => t.statut_tarif === 'Sous-facturé' && t.taux_occupation > 70)
                        .map(t => `${t.nomterrain || 'Terrain ' + t.numeroterrain}: +${Math.abs(t.pourcentage_difference).toFixed(1)}%`),
                    packages: creneauxPremium.rows
                        .filter(c => c.categorie === 'Créneau premium')
                        .map(c => `Forfait 20h ${c.typeterrain} ${c.surfaceterrains}`)
                }
            }
        });
    } catch (err) {
        console.error('Erreur analyse tarification:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de tarification',
            error: err.message 
        });
    }
});

// 5️⃣ ANALYSE COMPORTEMENT CLIENT
router.get('/analyse/clients', async (req, res) => {
    try {
        // Clients les plus actifs
        const clientsActifs = await db.query(`
            SELECT 
                Nom,
                COUNT(*) as nombre_reservations,
                COUNT(DISTINCT datecreneaux) as jours_distincts,
                MIN(datecreneaux) as premiere_reservation,
                MAX(datecreneaux) as derniere_reservation,
                SUM(tarif) as montant_total,
                ROUND(AVG(tarif), 2) as panier_moyen,
                ROUND(SUM(tarif) / COUNT(*), 2) as depense_moyenne_par_reservation,
                STRING_AGG(DISTINCT nomterrain, ', ' ORDER BY nomterrain) as terrains_frequentes,
                STRING_AGG(DISTINCT typeterrain, ', ' ORDER BY typeterrain) as types_preferes,
                CASE 
                    WHEN COUNT(*) >= 10 THEN 'VIP'
                    WHEN COUNT(*) BETWEEN 5 AND 9 THEN 'Régulier'
                    WHEN COUNT(*) BETWEEN 2 AND 4 THEN 'Occasionnel'
                    ELSE 'Nouveau'
                END as segment_client,
                EXTRACT(DAYS FROM MAX(datecreneaux) - MIN(datecreneaux)) as duree_client_jours,
                ROUND(COUNT(*) / NULLIF(EXTRACT(DAYS FROM MAX(datecreneaux) - MIN(datecreneaux)), 0) * 30, 1) as frequence_mensuelle
            FROM creneaux
            WHERE Statut = 'réservé' AND Nom IS NOT NULL AND Nom != ''
            GROUP BY Nom
            HAVING COUNT(*) >= 2
            ORDER BY nombre_reservations DESC, montant_total DESC
            LIMIT 50
        `);

        // Habitudes de réservation par client
        const habitudesClients = await db.query(`
            WITH habitudes AS (
                SELECT 
                    Nom,
                    EXTRACT(DOW FROM datecreneaux) as jour_prefere_num,
                    TO_CHAR(datecreneaux, 'Day') as jour_prefere,
                    MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM heuredebut)) as heure_preferee,
                    MODE() WITHIN GROUP (ORDER BY typeterrain) as type_prefere,
                    MODE() WITHIN GROUP (ORDER BY surfaceterrains) as surface_preferee,
                    COUNT(*) as total_reservations,
                    ROUND(AVG(tarif), 2) as tarif_moyen_paye,
                    ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures
                FROM creneaux
                WHERE Statut = 'réservé' AND Nom IS NOT NULL AND Nom != ''
                GROUP BY Nom, EXTRACT(DOW FROM datecreneaux), TO_CHAR(datecreneaux, 'Day')
                HAVING COUNT(*) >= 3
            )
            SELECT * FROM habitudes
            ORDER BY total_reservations DESC
        `);

        // Analyse de fidélité
        const analyseFidelite = await db.query(`
            WITH reservations_client AS (
                SELECT 
                    Nom,
                    datecreneaux,
                    tarif,
                    ROW_NUMBER() OVER (PARTITION BY Nom ORDER BY datecreneaux) as numero_reservation
                FROM creneaux
                WHERE Statut = 'réservé' AND Nom IS NOT NULL
            ),
            stats_fidelite AS (
                SELECT 
                    CASE 
                        WHEN MAX(numero_reservation) = 1 THEN 'Première réservation'
                        WHEN MAX(numero_reservation) = 2 THEN 'Deuxième réservation'
                        WHEN MAX(numero_reservation) BETWEEN 3 AND 5 THEN 'Client actif (3-5)'
                        WHEN MAX(numero_reservation) BETWEEN 6 AND 10 THEN 'Client fidèle (6-10)'
                        ELSE 'Client VIP (11+)'
                    END as niveau_fidelite,
                    COUNT(DISTINCT Nom) as nombre_clients,
                    ROUND(AVG(MAX(numero_reservation) OVER (PARTITION BY niveau_fidelite)), 1) as reservations_moyennes,
                    ROUND(AVG(tarif), 2) as panier_moyen,
                    SUM(tarif) as ca_total_segment
                FROM reservations_client
                GROUP BY Nom, tarif
            )
            SELECT 
                niveau_fidelite,
                COUNT(*) as nombre_clients,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as pourcentage_clients,
                ROUND(AVG(reservations_moyennes), 1) as reservations_moyennes,
                ROUND(AVG(panier_moyen), 2) as panier_moyen,
                SUM(ca_total_segment) as ca_total,
                ROUND(SUM(ca_total_segment) * 100.0 / SUM(SUM(ca_total_segment)) OVER (), 2) as pourcentage_ca
            FROM stats_fidelite
            GROUP BY niveau_fidelite
            ORDER BY 
                CASE niveau_fidelite
                    WHEN 'Client VIP (11+)' THEN 1
                    WHEN 'Client fidèle (6-10)' THEN 2
                    WHEN 'Client actif (3-5)' THEN 3
                    WHEN 'Deuxième réservation' THEN 4
                    WHEN 'Première réservation' THEN 5
                END
        `);

        // Fréquence et régularité
        const frequenceReservation = await db.query(`
            WITH dates_reservations AS (
                SELECT 
                    Nom,
                    datecreneaux,
                    tarif,
                    LAG(datecreneaux) OVER (PARTITION BY Nom ORDER BY datecreneaux) as date_precedente
                FROM creneaux
                WHERE Statut = 'réservé' AND Nom IS NOT NULL
            ),
            intervalles AS (
                SELECT 
                    Nom,
                    COUNT(*) as nombre_reservations,
                    ROUND(AVG(datecreneaux - date_precedente), 1) as intervalle_moyen_jours,
                    MIN(datecreneaux - date_precedente) as intervalle_min_jours,
                    MAX(datecreneaux - date_precedente) as intervalle_max_jours,
                    ROUND(STDDEV(datecreneaux - date_precedente), 1) as ecart_type_intervalle,
                    ROUND(AVG(tarif), 2) as tarif_moyen
                FROM dates_reservations
                WHERE date_precedente IS NOT NULL
                GROUP BY Nom
                HAVING COUNT(*) >= 3
            )
            SELECT 
                *,
                CASE 
                    WHEN intervalle_moyen_jours <= 7 THEN 'Client hebdomadaire'
                    WHEN intervalle_moyen_jours <= 14 THEN 'Client bi-hebdomadaire'
                    WHEN intervalle_moyen_jours <= 30 THEN 'Client mensuel'
                    ELSE 'Client occasionnel'
                END as rythme_reservation
            FROM intervalles
            ORDER BY nombre_reservations DESC
        `);

        // Valorisation client (Lifetime Value)
        const valorisationClient = await db.query(`
            SELECT 
                segment,
                nombre_clients,
                ca_moyen_par_client,
                duree_moyenne_mois,
                ltv_estime
            FROM (
                SELECT 
                    CASE 
                        WHEN COUNT(*) >= 10 THEN 'VIP'
                        WHEN COUNT(*) BETWEEN 5 AND 9 THEN 'Fidèle'
                        WHEN COUNT(*) BETWEEN 2 AND 4 THEN 'Actif'
                        ELSE 'Nouveau'
                    END as segment,
                    COUNT(DISTINCT Nom) as nombre_clients,
                    ROUND(AVG(total_ca), 2) as ca_moyen_par_client,
                    ROUND(AVG(duree_jours/30.0), 1) as duree_moyenne_mois,
                    ROUND(AVG(total_ca) * (AVG(duree_jours/30.0)), 2) as ltv_estime
                FROM (
                    SELECT 
                        Nom,
                        SUM(tarif) as total_ca,
                        EXTRACT(DAYS FROM MAX(datecreneaux) - MIN(datecreneaux)) as duree_jours
                    FROM creneaux
                    WHERE Statut = 'réservé' AND Nom IS NOT NULL
                    GROUP BY Nom
                ) stats
                GROUP BY segment
            ) segments
            ORDER BY 
                CASE segment
                    WHEN 'VIP' THEN 1
                    WHEN 'Fidèle' THEN 2
                    WHEN 'Actif' THEN 3
                    WHEN 'Nouveau' THEN 4
                END
        `);

        res.json({
            success: true,
            data: {
                clients_actifs: clientsActifs.rows,
                habitudes_reservation: habitudesClients.rows,
                analyse_fidelite: analyseFidelite.rows,
                frequence_reservation: frequenceReservation.rows,
                valorisation_client: valorisationClient.rows,
                insights: {
                    top_clients: clientsActifs.rows.slice(0, 10),
                    taux_fidelisation: analyseFidelite.rows.find(f => f.niveau_fidelite.includes('fidèle') || f.niveau_fidelite.includes('VIP'))?.pourcentage_clients || 0,
                    ltv_total: valorisationClient.rows.reduce((sum, row) => sum + (row.ltv_estime * row.nombre_clients), 0),
                    recommandations_fidelisation: [
                        "Programme fidélité: 1 réservation gratuite après 10 payantes",
                        "Offres anniversaire: -20% le mois de leur première réservation",
                        "Abonnements mensuels: tarifs préférentiels pour les réguliers",
                        "Early bird: -15% pour réservation > 7 jours à l'avance"
                    ]
                }
            }
        });
    } catch (err) {
        console.error('Erreur analyse clients:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse des clients',
            error: err.message 
        });
    }
});

// 6️⃣ ANALYSE PERFORMANCE GLOBALE
router.get('/analyse/performance', async (req, res) => {
    try {
        const { periode } = req.query;
        let groupBy, interval;
        
        switch(periode) {
            case 'jour':
                groupBy = 'DATE_TRUNC(\'day\', datecreneaux)';
                interval = 'day';
                break;
            case 'semaine':
                groupBy = 'DATE_TRUNC(\'week\', datecreneaux)';
                interval = 'week';
                break;
            case 'mois':
                groupBy = 'DATE_TRUNC(\'month\', datecreneaux)';
                interval = 'month';
                break;
            default:
                groupBy = 'DATE_TRUNC(\'day\', datecreneaux)';
                interval = 'day';
        }

        // Performance temporelle
        const performanceTemporelle = await db.query(`
            SELECT 
                ${groupBy} as periode,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as chiffre_affaires,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                ROUND(SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(DISTINCT numeroterrain), 2) as ca_par_terrain,
                COUNT(DISTINCT numeroterrain) as terrains_actifs,
                COUNT(DISTINCT Nom) as clients_uniques
            FROM creneaux
            GROUP BY ${groupBy}
            ORDER BY periode DESC
            LIMIT 30
        `);

        // KPIs globaux
        const kpisGlobaux = await db.query(`
            SELECT 
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_disponibles,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as chiffre_affaires_total,
                ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                COUNT(DISTINCT numeroterrain) as nombre_terrains_actifs,
                COUNT(DISTINCT Nom) as nombre_clients_uniques,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation_global,
                ROUND(SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(DISTINCT datecreneaux), 2) as ca_moyen_par_jour,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures,
                ROUND(SUM(CASE WHEN Statut = 'réservé' THEN EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600 ELSE 0 END), 1) as total_heures_vendues
            FROM creneaux
        `);

        // Tendances
        const tendances = await db.query(`
            WITH daily_stats AS (
                SELECT 
                    DATE_TRUNC('day', datecreneaux) as jour,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                    SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_journalier,
                    COUNT(DISTINCT numeroterrain) as terrains_actifs_jour
                FROM creneaux
                GROUP BY DATE_TRUNC('day', datecreneaux)
            ),
            moving_avg AS (
                SELECT 
                    jour,
                    reservations,
                    ca_journalier,
                    AVG(reservations) OVER (ORDER BY jour ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as reservations_moyenne_7j,
                    AVG(ca_journalier) OVER (ORDER BY jour ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as ca_moyen_7j
                FROM daily_stats
            )
            SELECT 
                jour,
                reservations,
                ca_journalier,
                ROUND(reservations_moyenne_7j, 1) as reservations_moyenne_7j,
                ROUND(ca_moyen_7j, 2) as ca_moyen_7j,
                LAG(reservations, 7) OVER (ORDER BY jour) as reservations_semaine_passee,
                LAG(ca_journalier, 7) OVER (ORDER BY jour) as ca_semaine_passee,
                ROUND((reservations - LAG(reservations, 7) OVER (ORDER BY jour)) * 100.0 / NULLIF(LAG(reservations, 7) OVER (ORDER BY jour), 0), 2) as croissance_reservations_7j,
                ROUND((ca_journalier - LAG(ca_journalier, 7) OVER (ORDER BY jour)) * 100.0 / NULLIF(LAG(ca_journalier, 7) OVER (ORDER BY jour), 0), 2) as croissance_ca_7j
            FROM moving_avg
            ORDER BY jour DESC
            LIMIT 30
        `);

        // Corrélations avancées
        const correlations = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heuredebut) as heure,
                typeterrain,
                surfaceterrains,
                COUNT(*) as nombre_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                ROUND(AVG(tarif), 2) as tarif_moyen,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total,
                ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures,
                ROUND(SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(*), 2) as rendement_par_creneau
            FROM creneaux
            GROUP BY EXTRACT(HOUR FROM heuredebut), typeterrain, surfaceterrains
            HAVING COUNT(*) >= 5
            ORDER BY rendement_par_creneau DESC
            LIMIT 20
        `);

        // Indicateurs de croissance
        const indicateursCroissance = await db.query(`
            WITH monthly_stats AS (
                SELECT 
                    DATE_TRUNC('month', datecreneaux) as mois,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                    SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_mensuel,
                    COUNT(DISTINCT Nom) as nouveaux_clients,
                    COUNT(DISTINCT numeroterrain) as terrains_actifs,
                    ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                    ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
                FROM creneaux
                GROUP BY DATE_TRUNC('month', datecreneaux)
            )
            SELECT 
                TO_CHAR(mois, 'YYYY-MM') as mois,
                reservations,
                ca_mensuel,
                nouveaux_clients,
                terrains_actifs,
                tarif_moyen,
                taux_occupation,
                LAG(reservations) OVER (ORDER BY mois) as reservations_mois_precedent,
                LAG(ca_mensuel) OVER (ORDER BY mois) as ca_mois_precedent,
                ROUND((reservations - LAG(reservations) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(reservations) OVER (ORDER BY mois), 0), 2) as croissance_reservations_pct,
                ROUND((ca_mensuel - LAG(ca_mensuel) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(ca_mensuel) OVER (ORDER BY mois), 0), 2) as croissance_ca_pct,
                ROUND(ca_mensuel / NULLIF(terrains_actifs, 0), 2) as ca_par_terrain
            FROM monthly_stats
            ORDER BY mois DESC
            LIMIT 12
        `);

        // Score de performance global
        const scorePerformance = await db.query(`
            SELECT 
                ROUND(AVG(taux_occupation), 2) as score_occupation,
                ROUND(AVG(croissance_ca_pct), 2) as score_croissance,
                ROUND(AVG(ca_par_terrain), 2) as score_productivite,
                ROUND(AVG(taux_occupation) * 0.4 + AVG(croissance_ca_pct) * 0.3 + AVG(ca_par_terrain) * 0.3, 2) as score_global
            FROM (
                SELECT 
                    taux_occupation,
                    croissance_ca_pct,
                    ca_par_terrain
                FROM indicateursCroissance
            ) stats
        `);

        res.json({
            success: true,
            data: {
                performance_temporelle: performanceTemporelle.rows,
                kpis_globaux: kpisGlobaux.rows[0],
                tendances: tendances.rows,
                correlations: correlations.rows,
                indicateurs_croissance: indicateursCroissance.rows,
                score_performance: scorePerformance.rows[0],
                recommendations: {
                    expansion: kpisGlobaux.rows[0]?.taux_occupation_global > 85 ? 
                        "Nouveau terrain recommandé - Occupation >85%" : 
                        "Optimisation nécessaire avant expansion",
                    investissement: correlations.rows.slice(0, 3)
                        .map(c => `${c.typeterrain} ${c.surfaceterrains} à ${c.heure}h`).join(', '),
                    optimisation: tendances.rows.filter(t => t.croissance_reservations_7j < -10).length > 5 ?
                        "Campagne marketing urgente - Baisse persistante" :
                        "Performance stable - Maintenir la stratégie",
                    priorites: [
                        "Augmenter taux occupation <50%",
                        "Développer créneaux premium",
                        "Fidéliser top 20% clients"
                    ]
                }
            }
        });
    } catch (err) {
        console.error('Erreur analyse performance:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de l\'analyse de performance',
            error: err.message 
        });
    }
});

// RAPPORT SYNTHÈSE COMPLET
router.get('/analyse/synthese', async (req, res) => {
    try {
        // Récupérer tous les KPIs en parallèle
        const [kpis, terrainsPopulaires, clientsTop, tendancesCA, meilleuresPerf] = await Promise.all([
            db.query(`
                SELECT 
                    COUNT(*) as total_creneaux,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                    SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as chiffre_affaires_total,
                    ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation_global,
                    ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                    COUNT(DISTINCT numeroterrain) as nombre_terrains,
                    COUNT(DISTINCT Nom) as nombre_clients,
                    ROUND(SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(DISTINCT datecreneaux), 2) as ca_moyen_journalier,
                    ROUND(AVG(EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600), 2) as duree_moyenne_heures
                FROM creneaux
                WHERE datecreneaux >= CURRENT_DATE - INTERVAL '90 days'
            `),
            db.query(`
                SELECT numeroterrain, nomterrain, 
                       COUNT(*) as reservations,
                       SUM(tarif) as ca_total,
                       ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
                FROM creneaux 
                WHERE datecreneaux >= CURRENT_DATE - INTERVAL '90 days'
                GROUP BY numeroterrain, nomterrain
                ORDER BY ca_total DESC 
                LIMIT 5
            `),
            db.query(`
                SELECT Nom, 
                       COUNT(*) as reservations, 
                       SUM(tarif) as depense_totale,
                       ROUND(AVG(tarif), 2) as panier_moyen,
                       MAX(datecreneaux) as derniere_visite
                FROM creneaux 
                WHERE Statut = 'réservé' AND Nom IS NOT NULL
                AND datecreneaux >= CURRENT_DATE - INTERVAL '90 days'
                GROUP BY Nom 
                ORDER BY depense_totale DESC 
                LIMIT 10
            `),
            db.query(`
                WITH daily_ca AS (
                    SELECT DATE_TRUNC('day', datecreneaux) as jour, 
                           SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca
                    FROM creneaux
                    WHERE datecreneaux >= CURRENT_DATE - INTERVAL '30 days'
                    GROUP BY DATE_TRUNC('day', datecreneaux)
                )
                SELECT ROUND(AVG(ca), 2) as ca_moyen_30j,
                       MAX(ca) as ca_max_30j,
                       MIN(ca) as ca_min_30j,
                       ROUND(STDDEV(ca), 2) as ecart_type_ca,
                       COUNT(*) as jours_actifs_30j
                FROM daily_ca
            `),
            db.query(`
                SELECT 
                    typeterrain,
                    surfaceterrains,
                    EXTRACT(HOUR FROM heuredebut) as heure,
                    COUNT(*) as total_creneaux,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                    ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                    ROUND(AVG(tarif), 2) as tarif_moyen,
                    SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total
                FROM creneaux
                WHERE datecreneaux >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY typeterrain, surfaceterrains, EXTRACT(HOUR FROM heuredebut)
                HAVING COUNT(*) >= 5 AND COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) >= 3
                ORDER BY taux_occupation DESC, ca_total DESC
                LIMIT 10
            `)
        ]);

        // Analyse des opportunités
        const opportunites = await db.query(`
            SELECT 
                'Heures creuses sous-utilisées' as categorie,
                COUNT(*) as opportunites,
                ROUND(SUM(tarif) * 0.25, 2) as gain_potentiel_mensuel,
                STRING_AGG(DISTINCT typeterrain || ' ' || surfaceterrains, ', ') as combinaisons
            FROM creneaux
            WHERE Statut = 'disponible' 
            AND EXTRACT(HOUR FROM heuredebut) BETWEEN 14 AND 16
            AND datecreneaux >= CURRENT_DATE - INTERVAL '30 days'
            UNION ALL
            SELECT 
                'Terrains sous-performants' as categorie,
                COUNT(DISTINCT numeroterrain) as opportunites,
                ROUND(SUM(tarif) * 0.15, 2) as gain_potentiel_mensuel,
                STRING_AGG(DISTINCT nomterrain, ', ') as terrains
            FROM creneaux c1
            WHERE Statut = 'disponible'
            AND datecreneaux >= CURRENT_DATE - INTERVAL '30 days'
            AND (SELECT COUNT(*) FROM creneaux c2 
                 WHERE c2.numeroterrain = c1.numeroterrain 
                 AND Statut = 'réservé'
                 AND datecreneaux >= CURRENT_DATE - INTERVAL '30 days') < 5
            UNION ALL
            SELECT 
                'Clients à re-fidéliser' as categorie,
                COUNT(DISTINCT Nom) as opportunites,
                ROUND(COUNT(DISTINCT Nom) * 150, 2) as gain_potentiel_mensuel,
                STRING_AGG(DISTINCT Nom, ', ') as clients
            FROM creneaux
            WHERE Nom IS NOT NULL
            AND Statut = 'réservé'
            AND datecreneaux < CURRENT_DATE - INTERVAL '60 days'
            AND datecreneaux >= CURRENT_DATE - INTERVAL '180 days'
        `);

        // Alertes et points d'attention
        const alertes = await db.query(`
            SELECT 
                CASE 
                    WHEN taux_occupation < 40 THEN 'Occupation critique'
                    WHEN croissance < -15 THEN 'Déclin important'
                    WHEN tarif_moyen < seuil_bas THEN 'Tarif trop bas'
                    ELSE 'Performance correcte'
                END as type_alerte,
                COUNT(*) as occurrences
            FROM (
                SELECT 
                    numeroterrain,
                    ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                    ROUND(AVG(tarif), 2) as tarif_moyen,
                    0 as croissance, -- À calculer si historique disponible
                    50 as seuil_bas -- Seuil à ajuster
                FROM creneaux
                WHERE datecreneaux >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY numeroterrain
            ) stats
            GROUP BY type_alerte
        `);

        res.json({
            success: true,
            data: {
                resume_90j: kpis.rows[0],
                highlights: {
                    top_terrains: terrainsPopulaires.rows,
                    meilleurs_clients: clientsTop.rows,
                    tendances_ca: tendancesCA.rows[0],
                    meilleures_performances: meilleuresPerf.rows
                },
                opportunites: opportunites.rows,
                alertes: alertes.rows,
                score_sante: {
                    occupation: kpis.rows[0]?.taux_occupation_global > 70 ? 'Bonne' : 'À améliorer',
                    croissance: tendancesCA.rows[0]?.ca_moyen_30j > (kpis.rows[0]?.ca_moyen_journalier || 0) ? 'Positive' : 'Stagnante',
                    rentabilite: kpis.rows[0]?.tarif_moyen > 30 ? 'Bonne' : 'Faible',
                    fidelisation: clientsTop.rows.length > 5 ? 'Élevée' : 'Moyenne'
                },
                actions_recommandees: [
                    {
                        priorite: "Haute",
                        actions: [
                            "Promotions ciblées heures 14h-16h: -25%",
                            "Relance clients inactifs > 60 jours",
                            "Optimisation créneaux < 40% occupation"
                        ],
                        impact_estime: "+15-20% CA mensuel"
                    },
                    {
                        priorite: "Moyenne",
                        actions: [
                            "Programme fidélité pour top 20 clients",
                            "Packages mensuels terrain+équipement",
                            "Tarification dynamique week-end"
                        ],
                        impact_estime: "+10% fidélisation"
                    },
                    {
                        priorite: "Basse",
                        actions: [
                            "Refonte fiches terrains sous-performants",
                            "Formation staff vente croisée",
                            "Analyse concurrentielle tarifs"
                        ],
                        impact_estime: "Optimisation long terme"
                    }
                ]
            }
        });
    } catch (err) {
        console.error('Erreur synthèse:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Erreur lors de la génération de la synthèse',
            error: err.message 
        });
    }
});

// CRUD DE BASE
router.post('/', (req, res) => {
    const { datecreneaux, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif } = req.body;
    
    // Validation des données
    if (!datecreneaux || !heuredebut || !heurefin || !Statut || !numeroterrain || !typeterrain || !surfaceterrains || !tarif) {
        return res.status(400).json({ 
            success: false,
            message: 'Champs requis: datecreneaux, heuredebut, heurefin, Statut, numeroterrain, typeterrain, surfaceterrains, tarif' 
        });
    }

    const sql = `
        INSERT INTO creneaux 
        (datecreneaux, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
        RETURNING *
    `;
    
    db.query(sql, [datecreneaux, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif])
        .then(result => {
            res.status(201).json({
                success: true,
                message: 'Créneau créé avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la création du créneau',
                error: err.message 
            });
        });
});

router.get('/', (req, res) => {
    const sql = 'SELECT * FROM creneaux ORDER BY datecreneaux DESC, heuredebut DESC';
    
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
                message: 'Erreur lors de la récupération des créneaux',
                error: err.message 
            });
        });
});

router.get('/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = 'SELECT * FROM creneaux WHERE idcreneaux = $1';
    
    db.query(sql, [id])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Créneau non trouvé' 
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
                message: 'Erreur lors de la récupération du créneau',
                error: err.message 
            });
        });
});

router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { datecreneaux, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif } = req.body;
    
    if (!datecreneaux || !heuredebut || !heurefin || !Statut || !numeroterrain || !typeterrain || !surfaceterrains || !tarif) {
        return res.status(400).json({ 
            success: false,
            message: 'Tous les champs sont requis' 
        });
    }

    const sql = `
        UPDATE creneaux 
        SET datecreneaux = $1, heuredebut = $2, heurefin = $3, Statut = $4, 
            numeroterrain = $5, typeterrain = $6, Nom = $7, 
            nomterrain = $8, surfaceterrains = $9, tarif = $10
        WHERE idcreneaux = $11 
        RETURNING *
    `;
    
    db.query(sql, [datecreneaux, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif, id])
        .then(result => {
            if (result.rows.length === 0) {
                return res.status(404).json({ 
                    success: false,
                    message: 'Créneau non trouvé' 
                });
            }
            res.status(200).json({
                success: true,
                message: 'Créneau mis à jour avec succès',
                data: result.rows[0]
            });
        })
        .catch(err => {
            console.error('Erreur SQL:', err.message);
            res.status(500).json({ 
                success: false,
                message: 'Erreur lors de la mise à jour du créneau',
                error: err.message 
            });
        });
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;
    
    if (!id || !Number.isInteger(Number(id))) {
      return res.status(400).json({
        success: false,
        message: 'ID doit être un nombre entier'
      });
    }
  
    const creneauId = parseInt(id, 10);
  
    const sql = 'DELETE FROM creneaux WHERE idcreneaux = $1 RETURNING *';
    
    db.query(sql, [creneauId])
      .then(result => {
        if (result.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Aucun créneau trouvé avec cet ID'
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