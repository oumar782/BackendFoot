import express from 'express';
const router = express.Router();
import db from '../db.js';

// 1️⃣ ANALYSE D'UTILISATION DES TERRAINS
// Route pour l'utilisation des terrains (plus réservés, horaires, créneaux morts)
router.get('/analyse/utilisation-terrains', async (req, res) => {
    try {
        const { periode, limit } = req.query;
        let dateFilter = '';
        
        if (periode === 'semaine') {
            dateFilter = "AND Date >= CURRENT_DATE - INTERVAL '7 days'";
        } else if (periode === 'mois') {
            dateFilter = "AND Date >= CURRENT_DATE - INTERVAL '30 days'";
        }

        // 1. Terrains les plus réservés
        const terrainsPopulaires = await db.query(`
            SELECT 
                numeroterrain,
                nomterrain,
                typeterrain,
                surfaceterrains,
                COUNT(*) as nombre_reservations,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations_confirmees,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_disponibles,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            WHERE 1=1 ${dateFilter}
            GROUP BY numeroterrain, nomterrain, typeterrain, surfaceterrains
            ORDER BY nombre_reservations DESC
            ${limit ? `LIMIT ${limit}` : ''}
        `);

        // 2. Jours/horaires les plus populaires
        const horairesPopulaires = await db.query(`
            SELECT 
                EXTRACT(DOW FROM Date) as jour_semaine,
                TO_CHAR(Date, 'Day') as nom_jour,
                EXTRACT(HOUR FROM heuredebut) as heure_debut,
                COUNT(*) as nombre_reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            WHERE Statut = 'réservé'
            ${dateFilter}
            GROUP BY EXTRACT(DOW FROM Date), TO_CHAR(Date, 'Day'), EXTRACT(HOUR FROM heuredebut)
            ORDER BY nombre_reservations DESC
        `);

        // 3. Créneaux morts (rarement réservés)
        const creneauxMorts = await db.query(`
            SELECT 
                EXTRACT(DOW FROM Date) as jour_semaine,
                TO_CHAR(Date, 'Day') as nom_jour,
                EXTRACT(HOUR FROM heuredebut) as heure_debut,
                numeroterrain,
                nomterrain,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            WHERE 1=1 ${dateFilter}
            GROUP BY EXTRACT(DOW FROM Date), TO_CHAR(Date, 'Day'), EXTRACT(HOUR FROM heuredebut), numeroterrain, nomterrain
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

        res.json({
            success: true,
            data: {
                terrains_populaires: terrainsPopulaires.rows,
                horaires_peuples: horairesPopulaires.rows,
                creneaux_morts: creneauxMorts.rows,
                distribution_horaire: distributionHoraire.rows,
                recommendations: {
                    ajustements_horaires: creneauxMorts.rows.length > 10 ? "Considérez la réduction des créneaux peu fréquentés" : "Horaires bien optimisés",
                    promotions: distributionHoraire.rows.find(p => p.taux_occupation < 50) ? 
                        "Promotions recommandées pour les plages à faible occupation" : 
                        "Taux d'occupation globalement bon"
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
            dateCondition = `WHERE Date BETWEEN '${date_debut}' AND '${date_fin}'`;
        }

        // Statistiques générales d'occupation
        const statsOccupation = await db.query(`
            SELECT 
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_disponibles,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation_global,
                COUNT(DISTINCT Date) as jours_analyses,
                ROUND(COUNT(CASE WHEN Statut = 'réservé' THEN 1 END)::numeric / COUNT(DISTINCT Date), 1) as reservations_par_jour
            FROM creneaux
            ${dateCondition}
        `);

        // Pertes par jour (créneaux disponibles)
        const pertesParJour = await db.query(`
            SELECT 
                Date,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) as creneaux_non_reserves,
                ROUND((COUNT(CASE WHEN Statut = 'disponible' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_non_occupation,
                SUM(CASE WHEN Statut = 'disponible' THEN EXTRACT(EPOCH FROM (heurefin - heuredebut))/3600 ELSE 0 END) as heures_perdues
            FROM creneaux
            ${dateCondition}
            GROUP BY Date
            ORDER BY Date DESC
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
                SUM(CASE WHEN Statut = 'disponible' THEN tarif ELSE 0 END) as revenu_perdu
            FROM creneaux
            ${dateCondition}
            GROUP BY numeroterrain, nomterrain, typeterrain
            ORDER BY revenu_perdu DESC
        `);

        // Analyse hebdomadaire
        const analyseHebdo = await db.query(`
            SELECT 
                EXTRACT(DOW FROM Date) as jour_numero,
                TO_CHAR(Date, 'Day') as jour_nom,
                COUNT(*) as total_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                SUM(CASE WHEN Statut = 'disponible' THEN tarif ELSE 0 END) as revenu_perdu
            FROM creneaux
            ${dateCondition}
            GROUP BY EXTRACT(DOW FROM Date), TO_CHAR(Date, 'Day')
            ORDER BY jour_numero
        `);

        // Calcul des totaux pour les recommandations
        const totalHeuresPerdues = pertesParJour.rows.reduce((sum, row) => sum + parseFloat(row.heures_perdues || 0), 0);
        const totalRevenuPerdu = pertesParTerrain.rows.reduce((sum, row) => sum + parseFloat(row.revenu_perdu || 0), 0);

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
                    moyenne_heures_perdues_par_jour: (totalHeuresPerdues / (pertesParJour.rows.length || 1)).toFixed(1)
                },
                recommendations: {
                    acompte: totalHeuresPerdues > 50 ? "Considérez l'exigence d'un acompte de 30%" : "Système actuel acceptable",
                    annulation: "Politique d'annulation 48h avant recommandée",
                    automation: totalHeuresPerdues > 100 ? "Automatisez les rappels de réservation" : "Niveau d'automatisation adéquat"
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
            dateCondition = `WHERE Date BETWEEN '${date_debut}' AND '${date_fin}'`;
        }
        
        if (group_by === 'type') {
            groupByClause = 'typeterrain';
        } else if (group_by === 'surface') {
            groupByClause = 'surfaceterrains';
        } else if (group_by === 'jour') {
            groupByClause = 'Date';
        }

        // Chiffre d'affaires par critère
        const caParCritere = await db.query(`
            SELECT 
                ${groupByClause},
                COUNT(*) as nombre_reservations,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations_confirmees,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as chiffre_affaires,
                AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END) as tarif_moyen,
                MAX(tarif) as tarif_max,
                MIN(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END) as tarif_min_reserve
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
                ROUND((SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(*)), 2) as rendement_par_creneau
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
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            ${dateCondition}
            GROUP BY typeterrain
            ORDER BY ca_total DESC
        `);

        // Rentabilité par terrain
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
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux
            ${dateCondition}
            GROUP BY numeroterrain, nomterrain, typeterrain, surfaceterrains
            ORDER BY rendement_moyen_par_creneau DESC
        `);

        res.json({
            success: true,
            data: {
                ca_par_critere: caParCritere.rows,
                analyse_surface: analyseSurface.rows,
                analyse_type: analyseType.rows,
                rentabilite_terrains: rentabiliteTerrain.rows,
                recommendations: {
                    investissement: rentabiliteTerrain.rows.slice(0, 3).map(t => t.nomterrain || `Terrain ${t.numeroterrain}`).join(', '),
                    revision_tarifs: analyseSurface.rows.filter(s => s.taux_occupation < 50).map(s => s.surfaceterrains).join(', '),
                    priorites: caParCritere.rows.slice(0, 5)
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
        const { terrain, type } = req.query;
        let whereConditions = ['Statut = \'réservé\''];
        
        if (terrain) whereConditions.push(`numeroterrain = '${terrain}'`);
        if (type) whereConditions.push(`typeterrain = '${type}'`);

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        // Analyse de tarification par plage horaire
        const tarifsParHoraire = await db.query(`
            SELECT 
                CASE 
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 8 AND 11 THEN 'Matin'
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 12 AND 17 THEN 'Après-midi'
                    WHEN EXTRACT(HOUR FROM heuredebut) BETWEEN 18 AND 22 THEN 'Soir'
                    ELSE 'Nuit'
                END as plage_horaire,
                COUNT(*) as nombre_reservations,
                AVG(tarif) as tarif_moyen,
                MIN(tarif) as tarif_min,
                MAX(tarif) as tarif_max,
                ROUND(STDDEV(tarif), 2) as ecart_type,
                ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM creneaux ${whereClause})), 2) as part_marche
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
                ROUND(AVG(tarif), 2) as tarif_moyen_tranche
            FROM creneaux
            GROUP BY tranche_tarif
            ORDER BY tranche_tarif
        `);

        // Terrains sous-facturés
        const terrainsSousFactures = await db.query(`
            SELECT 
                numeroterrain,
                nomterrain,
                typeterrain,
                surfaceterrains,
                AVG(tarif) as tarif_moyen_terrain,
                (SELECT AVG(tarif) FROM creneaux c2 WHERE c2.surfaceterrains = c1.surfaceterrains AND c2.typeterrain = c1.typeterrain) as tarif_moyen_categorie,
                COUNT(*) as nombre_reservations,
                ROUND(AVG(tarif) - (SELECT AVG(tarif) FROM creneaux c2 WHERE c2.surfaceterrains = c1.surfaceterrains AND c2.typeterrain = c1.typeterrain), 2) as difference_tarif,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
            FROM creneaux c1
            GROUP BY numeroterrain, nomterrain, typeterrain, surfaceterrains
            HAVING AVG(tarif) < (SELECT AVG(tarif) FROM creneaux c2 WHERE c2.surfaceterrains = c1.surfaceterrains AND c2.typeterrain = c1.typeterrain) * 0.9
            ORDER BY difference_tarif ASC
        `);

        // Analyse d'élasticité des prix
        const elasticitePrix = await db.query(`
            WITH stats_par_terrain AS (
                SELECT 
                    numeroterrain,
                    nomterrain,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tarif) as tarif_median,
                    AVG(tarif) as tarif_moyen,
                    COUNT(*) as total_creneaux,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                    ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation
                FROM creneaux
                GROUP BY numeroterrain, nomterrain
            )
            SELECT 
                *,
                CASE 
                    WHEN taux_occupation > 80 AND tarif_median < (SELECT AVG(tarif_median) FROM stats_par_terrain) THEN 'Prix trop bas - Augmenter possible'
                    WHEN taux_occupation < 50 AND tarif_median > (SELECT AVG(tarif_median) FROM stats_par_terrain) THEN 'Prix trop haut - Baisser ou promouvoir'
                    ELSE 'Prix adapté'
                END as recommandation_prix
            FROM stats_par_terrain
            ORDER BY taux_occupation DESC
        `);

        res.json({
            success: true,
            data: {
                analyse_plages_horaires: tarifsParHoraire.rows,
                correlation_tarif_occupation: correlationTarifOccupation.rows,
                terrains_sous_factures: terrainsSousFactures.rows,
                elasticite_prix: elasticitePrix.rows,
                recommendations: {
                    tarification_dynamique: tarifsParHoraire.rows.filter(p => p.part_marche > 30 && p.nombre_reservations > 10)
                        .map(p => `Augmenter ${p.plage_horaire} de 10%`),
                    promotions: correlationTarifOccupation.rows.filter(t => t.taux_occupation < 40)
                        .map(t => `Promo tranche ${t.tranche_tarif}€`),
                    ajustements: terrainsSousFactures.rows.map(t => `${t.nomterrain || 'Terrain ' + t.numeroterrain}: +${Math.abs(t.difference_tarif).toFixed(2)}€`)
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
                COUNT(DISTINCT Date) as jours_distincts,
                MIN(Date) as premiere_reservation,
                MAX(Date) as derniere_reservation,
                SUM(tarif) as montant_total,
                AVG(tarif) as panier_moyen,
                STRING_AGG(DISTINCT nomterrain, ', ') as terrains_frequentes,
                CASE 
                    WHEN COUNT(*) >= 10 THEN 'VIP'
                    WHEN COUNT(*) BETWEEN 5 AND 9 THEN 'Régulier'
                    WHEN COUNT(*) BETWEEN 2 AND 4 THEN 'Occasionnel'
                    ELSE 'Nouveau'
                END as segment_client
            FROM creneaux
            WHERE Statut = 'réservé' AND Nom IS NOT NULL AND Nom != ''
            GROUP BY Nom
            HAVING COUNT(*) >= 2
            ORDER BY nombre_reservations DESC
            LIMIT 50
        `);

        // Habitudes de réservation par client
        const habitudesClients = await db.query(`
            SELECT 
                Nom,
                EXTRACT(DOW FROM Date) as jour_prefere_num,
                TO_CHAR(Date, 'Day') as jour_prefere,
                MODE() WITHIN GROUP (ORDER BY EXTRACT(HOUR FROM heuredebut)) as heure_preferee,
                COUNT(*) as total_reservations,
                AVG(tarif) as tarif_moyen_paye
            FROM creneaux
            WHERE Statut = 'réservé' AND Nom IS NOT NULL AND Nom != ''
            GROUP BY Nom, EXTRACT(DOW FROM Date), TO_CHAR(Date, 'Day')
            HAVING COUNT(*) >= 3
            ORDER BY total_reservations DESC
        `);

        // Analyse de fidélité
        const analyseFidelite = await db.query(`
            WITH reservations_client AS (
                SELECT 
                    Nom,
                    Date,
                    ROW_NUMBER() OVER (PARTITION BY Nom ORDER BY Date) as numero_reservation
                FROM creneaux
                WHERE Statut = 'réservé' AND Nom IS NOT NULL
            ),
            stats_fidelite AS (
                SELECT 
                    CASE 
                        WHEN MAX(numero_reservation) = 1 THEN 'Première réservation'
                        WHEN MAX(numero_reservation) = 2 THEN 'Deuxième réservation'
                        WHEN MAX(numero_reservation) BETWEEN 3 AND 5 THEN 'Client actif'
                        WHEN MAX(numero_reservation) BETWEEN 6 AND 10 THEN 'Client fidèle'
                        ELSE 'Client VIP'
                    END as niveau_fidelite,
                    COUNT(DISTINCT Nom) as nombre_clients,
                    ROUND(AVG(MAX(numero_reservation) OVER (PARTITION BY niveau_fidelite)), 1) as reservations_moyennes
                FROM reservations_client
                GROUP BY Nom
            )
            SELECT 
                niveau_fidelite,
                COUNT(*) as nombre_clients,
                ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as pourcentage_total
            FROM stats_fidelite
            GROUP BY niveau_fidelite
            ORDER BY 
                CASE niveau_fidelite
                    WHEN 'Client VIP' THEN 1
                    WHEN 'Client fidèle' THEN 2
                    WHEN 'Client actif' THEN 3
                    WHEN 'Deuxième réservation' THEN 4
                    WHEN 'Première réservation' THEN 5
                END
        `);

        // Fréquence de réservation
        const frequenceReservation = await db.query(`
            WITH dates_reservations AS (
                SELECT 
                    Nom,
                    Date,
                    LAG(Date) OVER (PARTITION BY Nom ORDER BY Date) as date_precedente
                FROM creneaux
                WHERE Statut = 'réservé' AND Nom IS NOT NULL
            )
            SELECT 
                Nom,
                COUNT(*) as nombre_reservations,
                ROUND(AVG(Date - date_precedente), 1) as intervalle_moyen_jours,
                MIN(Date - date_precedente) as intervalle_min_jours,
                MAX(Date - date_precedente) as intervalle_max_jours
            FROM dates_reservations
            WHERE date_precedente IS NOT NULL
            GROUP BY Nom
            HAVING COUNT(*) >= 3
            ORDER BY nombre_reservations DESC
        `);

        res.json({
            success: true,
            data: {
                clients_actifs: clientsActifs.rows,
                habitudes_reservation: habitudesClients.rows,
                analyse_fidelite: analyseFidelite.rows,
                frequence_reservation: frequenceReservation.rows,
                insights: {
                    top_clients: clientsActifs.rows.slice(0, 10),
                    taux_fidelisation: analyseFidelite.rows.find(f => f.niveau_fidelite === 'Client fidèle' || f.niveau_fidelite === 'Client VIP')?.pourcentage_total || 0,
                    recommandations_fidelisation: [
                        "Créer un programme de fidélité pour les clients avec 5+ réservations",
                        "Offres personnalisées basées sur les horaires préférés",
                        "Abonnements mensuels pour les clients réguliers"
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
                groupBy = 'DATE_TRUNC(\'day\', Date)';
                interval = 'day';
                break;
            case 'semaine':
                groupBy = 'DATE_TRUNC(\'week\', Date)';
                interval = 'week';
                break;
            case 'mois':
                groupBy = 'DATE_TRUNC(\'month\', Date)';
                interval = 'month';
                break;
            default:
                groupBy = 'DATE_TRUNC(\'day\', Date)';
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
                ROUND(SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(DISTINCT numeroterrain), 2) as ca_par_terrain
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
                ROUND(SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) / COUNT(DISTINCT Date), 2) as ca_moyen_par_jour
            FROM creneaux
        `);

        // Tendances
        const tendances = await db.query(`
            WITH daily_stats AS (
                SELECT 
                    DATE_TRUNC('day', Date) as jour,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                    SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_journalier
                FROM creneaux
                GROUP BY DATE_TRUNC('day', Date)
            )
            SELECT 
                jour,
                reservations,
                ca_journalier,
                LAG(reservations, 7) OVER (ORDER BY jour) as reservations_semaine_passee,
                LAG(ca_journalier, 7) OVER (ORDER BY jour) as ca_semaine_passee,
                ROUND((reservations - LAG(reservations, 7) OVER (ORDER BY jour)) * 100.0 / NULLIF(LAG(reservations, 7) OVER (ORDER BY jour), 0), 2) as croissance_reservations,
                ROUND((ca_journalier - LAG(ca_journalier, 7) OVER (ORDER BY jour)) * 100.0 / NULLIF(LAG(ca_journalier, 7) OVER (ORDER BY jour), 0), 2) as croissance_ca
            FROM daily_stats
            ORDER BY jour DESC
            LIMIT 30
        `);

        // Corrélations avancées
        const correlations = await db.query(`
            SELECT 
                EXTRACT(HOUR FROM heuredebut) as heure,
                numeroterrain,
                nomterrain,
                typeterrain,
                AVG(tarif) as tarif_moyen,
                COUNT(*) as nombre_creneaux,
                COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation,
                SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_total
            FROM creneaux
            GROUP BY EXTRACT(HOUR FROM heuredebut), numeroterrain, nomterrain, typeterrain
            HAVING COUNT(*) >= 5
            ORDER BY ca_total DESC
            LIMIT 50
        `);

        // Indicateurs de croissance
        const indicateursCroissance = await db.query(`
            WITH monthly_stats AS (
                SELECT 
                    DATE_TRUNC('month', Date) as mois,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as reservations,
                    SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca_mensuel,
                    COUNT(DISTINCT Nom) as nouveaux_clients
                FROM creneaux
                GROUP BY DATE_TRUNC('month', Date)
            )
            SELECT 
                TO_CHAR(mois, 'YYYY-MM') as mois,
                reservations,
                ca_mensuel,
                nouveaux_clients,
                LAG(reservations) OVER (ORDER BY mois) as reservations_mois_precedent,
                LAG(ca_mensuel) OVER (ORDER BY mois) as ca_mois_precedent,
                ROUND((reservations - LAG(reservations) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(reservations) OVER (ORDER BY mois), 0), 2) as croissance_reservations_pct,
                ROUND((ca_mensuel - LAG(ca_mensuel) OVER (ORDER BY mois)) * 100.0 / NULLIF(LAG(ca_mensuel) OVER (ORDER BY mois), 0), 2) as croissance_ca_pct
            FROM monthly_stats
            ORDER BY mois DESC
            LIMIT 12
        `);

        res.json({
            success: true,
            data: {
                performance_temporelle: performanceTemporelle.rows,
                kpis_globaux: kpisGlobaux.rows[0],
                tendances: tendances.rows,
                correlations: correlations.rows,
                indicateurs_croissance: indicateursCroissance.rows,
                recommendations: {
                    expansion: kpisGlobaux.rows[0]?.taux_occupation_global > 80 ? 
                        "Considérez l'ouverture d'un nouveau terrain" : 
                        "Optimisez d'abord l'occupation actuelle",
                    investissement: correlations.rows.slice(0, 3).map(c => c.nomterrain || `Terrain ${c.numeroterrain}`).join(', '),
                    optimisation: tendances.rows.filter(t => t.croissance_reservations < 0).length > 10 ?
                        "Action marketing nécessaire pour relancer la croissance" :
                        "Croissance stable, maintenir les efforts"
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
        // Récupérer les KPIs principaux
        const [kpis, terrainsPopulaires, clientsTop, tendancesCA] = await Promise.all([
            db.query(`
                SELECT 
                    COUNT(*) as total_creneaux,
                    COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) as creneaux_reserves,
                    SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as chiffre_affaires_total,
                    ROUND((COUNT(CASE WHEN Statut = 'réservé' THEN 1 END) * 100.0 / COUNT(*)), 2) as taux_occupation_global,
                    ROUND(AVG(CASE WHEN Statut = 'réservé' THEN tarif ELSE NULL END), 2) as tarif_moyen,
                    COUNT(DISTINCT numeroterrain) as nombre_terrains,
                    COUNT(DISTINCT Nom) as nombre_clients
                FROM creneaux
            `),
            db.query(`
                SELECT numeroterrain, nomterrain, COUNT(*) as reservations
                FROM creneaux 
                WHERE Statut = 'réservé'
                GROUP BY numeroterrain, nomterrain
                ORDER BY reservations DESC 
                LIMIT 3
            `),
            db.query(`
                SELECT Nom, COUNT(*) as reservations, SUM(tarif) as depense_totale
                FROM creneaux 
                WHERE Statut = 'réservé' AND Nom IS NOT NULL
                GROUP BY Nom 
                ORDER BY reservations DESC 
                LIMIT 5
            `),
            db.query(`
                WITH daily_ca AS (
                    SELECT DATE_TRUNC('day', Date) as jour, 
                           SUM(CASE WHEN Statut = 'réservé' THEN tarif ELSE 0 END) as ca
                    FROM creneaux
                    WHERE Date >= CURRENT_DATE - INTERVAL '30 days'
                    GROUP BY DATE_TRUNC('day', Date)
                )
                SELECT ROUND(AVG(ca), 2) as ca_moyen_30j,
                       MAX(ca) as ca_max_30j,
                       MIN(ca) as ca_min_30j
                FROM daily_ca
            `)
        ]);

        // Analyse rapide des opportunités
        const opportunites = await db.query(`
            SELECT 
                'Heures creuses' as categorie,
                COUNT(*) as opportunites,
                ROUND(SUM(tarif) * 0.3, 2) as gain_potentiel
            FROM creneaux
            WHERE Statut = 'disponible' 
            AND EXTRACT(HOUR FROM heuredebut) BETWEEN 14 AND 16
            UNION ALL
            SELECT 
                'Terrains sous-utilisés' as categorie,
                COUNT(DISTINCT numeroterrain) as opportunites,
                ROUND(SUM(tarif) * 0.2, 2) as gain_potentiel
            FROM creneaux c1
            WHERE Statut = 'disponible'
            AND (SELECT COUNT(*) FROM creneaux c2 WHERE c2.numeroterrain = c1.numeroterrain AND Statut = 'réservé') < 10
        `);

        res.json({
            success: true,
            data: {
                resume: kpis.rows[0],
                highlights: {
                    top_terrains: terrainsPopulaires.rows,
                    meilleurs_clients: clientsTop.rows,
                    tendances_ca: tendancesCA.rows[0]
                },
                opportunites_principales: opportunites.rows,
                actions_recommandees: [
                    {
                        priorite: "Haute",
                        action: "Promotions heures creuses (14h-16h)",
                        impact: "Augmentation occupation 15%"
                    },
                    {
                        priorite: "Moyenne",
                        action: "Fidélisation top clients",
                        impact: "Augmentation CA 20%"
                    },
                    {
                        priorite: "Basse",
                        action: "Ajustement tarifs terrains peu occupés",
                        impact: "Optimisation ressources"
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

// CRUD de base pour les créneaux
router.post('/', (req, res) => {
    const { Date, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif } = req.body;
    
    // Validation des données
    if (!Date || !heuredebut || !heurefin || !Statut || !numeroterrain || !typeterrain || !surfaceterrains || !tarif) {
        return res.status(400).json({ 
            success: false,
            message: 'Champs requis: Date, heuredebut, heurefin, Statut, numeroterrain, typeterrain, surfaceterrains, tarif' 
        });
    }

    const sql = `
        INSERT INTO creneaux 
        (Date, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
        RETURNING *
    `;
    
    db.query(sql, [Date, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif])
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

// Route pour récupérer tous les créneaux
router.get('/', (req, res) => {
    const sql = 'SELECT * FROM creneaux ORDER BY Date DESC, heuredebut DESC';
    
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

// Route pour récupérer un créneau spécifique
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

// Route pour mettre à jour un créneau
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { Date, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif } = req.body;
    
    // Validation des données
    if (!Date || !heuredebut || !heurefin || !Statut || !numeroterrain || !typeterrain || !surfaceterrains || !tarif) {
        return res.status(400).json({ 
            success: false,
            message: 'Tous les champs sont requis' 
        });
    }

    const sql = `
        UPDATE creneaux 
        SET Date = $1, heuredebut = $2, heurefin = $3, Statut = $4, 
            numeroterrain = $5, typeterrain = $6, Nom = $7, 
            nomterrain = $8, surfaceterrains = $9, tarif = $10
        WHERE idcreneaux = $11 
        RETURNING *
    `;
    
    db.query(sql, [Date, heuredebut, heurefin, Statut, numeroterrain, typeterrain, Nom, nomterrain, surfaceterrains, tarif, id])
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

// Route pour supprimer un créneau
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    
    // Validation stricte de l'ID
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