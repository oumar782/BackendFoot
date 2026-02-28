import express from 'express';
const router = express.Router();
import db from '../db.js';

// ============================================
// 1. KPIs FONDAMENTAUX ET VUE D'ENSEMBLE
// ============================================

/**
 * @route   GET /api/analytics/dashboard-executif
 * @desc    Vue macro pour la direction (KPIs stratégiques)
 */
router.get('/dashboard-executif', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        const firstDayOfQuarter = new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1).toISOString().split('T')[0];
        const firstDayOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
        const lastDayOfLastMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().split('T')[0];

        // Requêtes parallèles pour les KPIs principaux
        const [
            totalClients,
            clientsActifs,
            clientsActifsMoisPrec,
            revenuTotal,
            revenuMensuel,
            revenuMoisPrecedent,
            revenuTrimestriel,
            revenuAnnuel,
            panierMoyen,
            frequenceRenouvellement,
            topTypeAbonnement,
            heureReservPlusDemandee,
            modePaiementPlusRentable,
            abonneLePlusAncien,
            abonnePlusGrandDepensier,
            acquisitionParMois
        ] = await Promise.all([
            db.query('SELECT COUNT(*) as total FROM clients'),
            db.query(`SELECT COUNT(*) as actifs FROM clients WHERE statut = 'actif' AND date_fin >= $1`, [today]),
            db.query(`SELECT COUNT(*) as actifs_mois_prec FROM clients WHERE statut = 'actif' AND date_fin >= $1 AND date_debut <= $2`, [lastDayOfLastMonth, lastDayOfLastMonth]),
            db.query('SELECT COALESCE(SUM(prix_total), 0) as total FROM clients'),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as mensuel FROM clients WHERE date_debut >= $1`, [firstDayOfMonth]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as mois_precedent FROM clients WHERE date_debut >= $1 AND date_debut < $2`, [firstDayOfMonth, lastDayOfLastMonth]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as trimestriel FROM clients WHERE date_debut >= $1`, [firstDayOfQuarter]),
            db.query(`SELECT COALESCE(SUM(prix_total), 0) as annuel FROM clients WHERE date_debut >= $1`, [firstDayOfYear]),
            db.query('SELECT COALESCE(AVG(prix_total), 0) as moyen FROM clients WHERE prix_total > 0'),
            db.query(`SELECT COALESCE(AVG(nb_abonnements), 0) as frequence FROM (SELECT email, COUNT(*) as nb_abonnements FROM clients GROUP BY email) as sub`),
            db.query(`SELECT type_abonnement, COUNT(*) as count FROM clients GROUP BY type_abonnement ORDER BY count DESC LIMIT 1`),
            db.query(`SELECT heure_reservation, COUNT(*) as count FROM clients WHERE heure_reservation IS NOT NULL GROUP BY heure_reservation ORDER BY count DESC LIMIT 1`),
            db.query(`SELECT mode_paiement, COALESCE(SUM(prix_total), 0) as total_revenu FROM clients WHERE mode_paiement IS NOT NULL GROUP BY mode_paiement ORDER BY total_revenu DESC LIMIT 1`),
            db.query(`SELECT nom, prenom, email, date_debut FROM clients ORDER BY date_debut ASC LIMIT 1`),
            db.query(`SELECT nom, prenom, email, SUM(prix_total) as total_depense FROM clients GROUP BY nom, prenom, email ORDER BY total_depense DESC LIMIT 1`),
            db.query(`SELECT TO_CHAR(date_debut, 'YYYY-MM') as mois, COUNT(*) as nouveaux FROM clients WHERE date_debut > CURRENT_DATE - INTERVAL '12 months' GROUP BY TO_CHAR(date_debut, 'YYYY-MM') ORDER BY mois`)
        ]);

        const total = parseInt(totalClients.rows[0].total);
        const actifs = parseInt(clientsActifs.rows[0].actifs);
        const actifsMoisPrec = parseInt(clientsActifsMoisPrec.rows[0].actifs_mois_prec);

        res.json({
            success: true,
            data: {
                kpis_strategiques: {
                    parc_clients: {
                        total,
                        actifs,
                        inactifs: total - actifs,
                        taux_evolution_mensuel_actifs: actifsMoisPrec > 0 ? ((actifs - actifsMoisPrec) / actifsMoisPrec * 100).toFixed(2) + '%' : 'N/A'
                    },
                    revenus: {
                        total: parseFloat(revenuTotal.rows[0].total),
                        mensuel: parseFloat(revenuMensuel.rows[0].mensuel),
                        trimestriel: parseFloat(revenuTrimestriel.rows[0].trimestriel),
                        annuel: parseFloat(revenuAnnuel.rows[0].annuel),
                        variation_mensuelle: {
                            valeur: parseFloat(revenuMoisPrecedent.rows[0].mois_precedent),
                            evolution: parseFloat(revenuMoisPrecedent.rows[0].mois_precedent) > 0 ?
                                ((parseFloat(revenuMensuel.rows[0].mensuel) - parseFloat(revenuMoisPrecedent.rows[0].mois_precedent)) / parseFloat(revenuMoisPrecedent.rows[0].mois_precedent) * 100).toFixed(2) + '%'
                                : 'N/A'
                        }
                    },
                    indicateurs_performance: {
                        panier_moyen: parseFloat(panierMoyen.rows[0].moyen),
                        frequence_renouvellement_moyenne: parseFloat(frequenceRenouvellement.rows[0].frequence).toFixed(2),
                        top_abonnement: topTypeAbonnement.rows[0]?.type_abonnement || 'Non déterminé',
                        heure_pointe: heureReservPlusDemandee.rows[0]?.heure_reservation || 'Non déterminée',
                        moyen_paiement_star: modePaiementPlusRentable.rows[0]?.mode_paiement || 'Non déterminé',
                    }
                },
                tops: {
                    abonne_le_plus_ancien: abonneLePlusAncien.rows[0] || null,
                    abonne_plus_gros_depensier: abonnePlusGrandDepensier.rows[0] || null
                },
                tendances: {
                    acquisition_12_mois: acquisitionParMois.rows
                }
            }
        });

    } catch (err) {
        console.error('Erreur Dashboard Exécutif:', err);
        res.status(500).json({ success: false, message: 'Erreur lors du calcul des KPIs stratégiques', error: err.message });
    }
});

// ============================================
// 2. ANALYSE APPROFONDIE DES REVENUS (MRR, ARPU, Cohortes)
// ============================================

/**
 * @route   GET /api/analytics/revenus-approfondis
 * @desc    Analyse détaillée des revenus : MRR, ARPU, LTV estimée, cohortes mensuelles.
 */
router.get('/revenus-approfondis', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // 1. Calcul du MRR (Mensuel Recurring Revenue) - Approximation à partir du prix total
        // Ici, on fait une approximation simple : on projette le prix total sur une base mensuelle.
        // Pour une vraie récurrence, il faudrait un champ 'prix_mensuel'.
        const mrrResult = await db.query(`
            SELECT COALESCE(SUM(
                CASE
                    WHEN type_abonnement = 'mensuel' THEN prix_total
                    WHEN type_abonnement = 'trimestriel' THEN prix_total / 3.0
                    WHEN type_abonnement = 'semestriel' THEN prix_total / 6.0
                    WHEN type_abonnement = 'annuel' THEN prix_total / 12.0
                    ELSE 0
                END
            ), 0) as mrr_estime
            FROM clients
            WHERE statut = 'actif' AND date_fin >= $1
        `, [today]);

        // 2. ARPU (Average Revenue Per User) Global
        const arpuGlobalResult = await db.query(`
            SELECT COALESCE(AVG(prix_total), 0) as arpu_global FROM clients WHERE prix_total > 0
        `);

        // 3. ARPU par statut
        const arpuParStatutResult = await db.query(`
            SELECT statut, COALESCE(AVG(prix_total), 0) as arpu, COUNT(*) as nombre
            FROM clients WHERE prix_total > 0 GROUP BY statut
        `);

        // 4. Analyse de cohorte mensuelle (sur les 6 derniers mois)
        const cohorteResult = await db.query(`
            WITH cohortes AS (
                SELECT
                    DATE_TRUNC('month', date_debut) as cohorte_mois,
                    email
                FROM clients
                WHERE date_debut > CURRENT_DATE - INTERVAL '6 months'
                GROUP BY cohorte_mois, email
            ),
            cohorte_activite AS (
                SELECT
                    c.cohorte_mois,
                    c.email,
                    COUNT(cl.idclient) as nb_abonnements_dans_cohorte
                FROM cohortes c
                LEFT JOIN clients cl ON cl.email = c.email AND cl.date_debut >= c.cohorte_mois
                GROUP BY c.cohorte_mois, c.email
            )
            SELECT
                TO_CHAR(cohorte_mois, 'YYYY-MM') as mois,
                COUNT(email) as taille_cohorte,
                SUM(CASE WHEN nb_abonnements_dans_cohorte >= 1 THEN 1 ELSE 0 END) as mois_0,
                SUM(CASE WHEN nb_abonnements_dans_cohorte >= 2 THEN 1 ELSE 0 END) as mois_1,
                SUM(CASE WHEN nb_abonnements_dans_cohorte >= 3 THEN 1 ELSE 0 END) as mois_2
            FROM cohorte_activite
            GROUP BY cohorte_mois
            ORDER BY cohorte_mois DESC
        `);

        // 5. LTV Estimée (Customer Lifetime Value) très simplifiée
        // LTV = (Valeur moyenne d'un achat * Fréquence d'achat moyenne) * Durée de vie moyenne estimée
        const ltvData = await db.query(`
            WITH client_stats AS (
                SELECT
                    email,
                    AVG(prix_total) as panier_moyen_client,
                    COUNT(*) as nb_achats
                FROM clients
                GROUP BY email
            )
            SELECT
                COALESCE(AVG(panier_moyen_client * nb_achats), 0) as ltv_estimee
            FROM client_stats
        `);

        res.json({
            success: true,
            data: {
                mrr: {
                    valeur_estimee: parseFloat(mrrResult.rows[0].mrr_estime).toFixed(2),
                    methode: "Approximée basée sur le type d'abonnement des actifs"
                },
                arpu: {
                    global: parseFloat(arpuGlobalResult.rows[0].arpu_global).toFixed(2),
                    par_statut: arpuParStatutResult.rows
                },
                ltv: {
                    estimee: parseFloat(ltvData.rows[0].ltv_estimee).toFixed(2),
                    note: "Valeur vie client estimée, basée sur la somme des achats par client"
                },
                cohortes_6_mois: cohorteResult.rows.map(row => ({
                    mois: row.mois,
                    taille_cohorte: parseInt(row.taille_cohorte),
                    retention: {
                        mois_0: '100%', // Le mois 0 est toujours 100%
                        mois_1: row.taille_cohorte > 0 ? ((row.mois_1 / row.taille_cohorte) * 100).toFixed(1) + '%' : '0%',
                        mois_2: row.taille_cohorte > 0 ? ((row.mois_2 / row.taille_cohorte) * 100).toFixed(1) + '%' : '0%',
                    }
                }))
            }
        });
    } catch (err) {
        console.error('Erreur Revenus Approfondis:', err);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse approfondie des revenus', error: err.message });
    }
});

// ============================================
// 3. ANALYSE DU COMPORTEMENT CLIENT (Préférences, Horaires)
// ============================================

/**
 * @route   GET /api/analytics/comportement-client
 * @desc    Analyse des préférences : abonnements, heures, modes de paiement.
 */
router.get('/comportement-client', async (req, res) => {
    try {
        // 1. Popularité des types d'abonnement (pour graphiques)
        const populariteAbonnement = await db.query(`
            SELECT
                type_abonnement,
                COUNT(*) as nombre_abonnements,
                COALESCE(SUM(prix_total), 0) as revenu_genere,
                ROUND(AVG(prix_total), 2) as prix_moyen
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement
            ORDER BY nombre_abonnements DESC
        `);

        // 2. Analyse des créneaux horaires de réservation
        const analyseHoraires = await db.query(`
            SELECT
                EXTRACT(HOUR FROM heure_reservation) as heure_debut,
                COUNT(*) as nombre_reservations,
                ROUND(AVG(EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600, 2) as duree_moyenne_heures
            FROM clients
            WHERE heure_reservation IS NOT NULL AND heure_fin IS NOT NULL
            GROUP BY heure_debut
            ORDER BY nombre_reservations DESC
        `);

        // 3. Distribution des durées de réservation
        const dureeReservation = await db.query(`
            SELECT
                CASE
                    WHEN EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600 <= 1 THEN '≤ 1h'
                    WHEN EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600 <= 2 THEN '1-2h'
                    WHEN EXTRACT(EPOCH FROM (heure_fin - heure_reservation))/3600 <= 3 THEN '2-3h'
                    ELSE '> 3h'
                END as tranche_duree,
                COUNT(*) as nombre
            FROM clients
            WHERE heure_reservation IS NOT NULL AND heure_fin IS NOT NULL
            GROUP BY tranche_duree
            ORDER BY nombre DESC
        `);

        // 4. Performance des modes de paiement
        const performancePaiement = await db.query(`
            SELECT
                mode_paiement,
                COUNT(*) as nombre_transactions,
                COALESCE(SUM(prix_total), 0) as revenu_total,
                ROUND(AVG(prix_total), 2) as montant_moyen,
                COUNT(DISTINCT email) as clients_uniques
            FROM clients
            WHERE mode_paiement IS NOT NULL
            GROUP BY mode_paiement
            ORDER BY revenu_total DESC
        `);

        // 5. Analyse croisée : Type d'abonnement vs. Mode de paiement
        const croisementAbonnementPaiement = await db.query(`
            SELECT
                type_abonnement,
                mode_paiement,
                COUNT(*) as nombre,
                COALESCE(SUM(prix_total), 0) as revenu
            FROM clients
            WHERE type_abonnement IS NOT NULL AND mode_paiement IS NOT NULL
            GROUP BY type_abonnement, mode_paiement
            ORDER BY type_abonnement, revenu DESC
        `);

        // 6. Jours de la semaine les plus populaires (basé sur la date de début d'abonnement)
        const joursPopulaires = await db.query(`
            SELECT
                TO_CHAR(date_debut, 'Day') as jour_semaine,
                COUNT(*) as nombre_inscriptions
            FROM clients
            GROUP BY TO_CHAR(date_debut, 'Day'), EXTRACT(DOW FROM date_debut)
            ORDER BY EXTRACT(DOW FROM date_debut)
        `);

        res.json({
            success: true,
            data: {
                pour_graphiques: {
                    abonnements: populariteAbonnement.rows,
                    horaires: analyseHoraires.rows.map(row => ({ ...row, heure_debut: row.heure_debut + 'h' })),
                    durees: dureeReservation.rows,
                    jours_inscription: joursPopulaires.rows
                },
                insights_strategiques: {
                    top_abonnement: populariteAbonnement.rows[0] || null,
                    top_horaire: analyseHoraires.rows[0] ? `${analyseHoraires.rows[0].heure_debut}h` : null,
                    mode_paiement_plus_rentable: performancePaiement.rows[0] || null,
                    analyse_croisee: croisementAbonnementPaiement.rows
                }
            }
        });

    } catch (err) {
        console.error('Erreur Comportement Client:', err);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse du comportement client', error: err.message });
    }
});

// ============================================
// 4. ANALYSE DES RISQUES ET DE LA RÉTENTION (Prédictif)
// ============================================

/**
 * @route   GET /api/analytics/risque-retention
 * @desc    Identification des clients à risque de churn et analyse des signaux faibles.
 */
router.get('/risque-retention', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dateFuture15 = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const datePast90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // 1. Score de risque simple pour les clients actifs
        const clientsARisque = await db.query(`
            SELECT
                idclient,
                nom,
                prenom,
                email,
                type_abonnement,
                date_debut,
                date_fin,
                prix_total,
                heure_reservation,
                (
                    CASE WHEN date_fin < $1 THEN 50 ELSE 0 END +  -- Si déjà expiré mais actif, risque max
                    CASE WHEN date_fin BETWEEN $1 AND $2 THEN 30 ELSE 0 END +  -- Expire bientôt
                    CASE WHEN heure_reservation IS NULL THEN 20 ELSE 0 END +   -- Jamais réservé
                    CASE WHEN prix_total <= 0 THEN 10 ELSE 0 END               -- Prix invalide
                ) as score_risque
            FROM clients
            WHERE statut = 'actif'
            HAVING
                CASE WHEN date_fin < $1 THEN 50 ELSE 0 END +
                CASE WHEN date_fin BETWEEN $1 AND $2 THEN 30 ELSE 0 END +
                CASE WHEN heure_reservation IS NULL THEN 20 ELSE 0 END +
                CASE WHEN prix_total <= 0 THEN 10 ELSE 0 END > 0
            ORDER BY score_risque DESC
        `, [today, dateFuture15]);

        // 2. "Clients dormants" : Actifs sans réservation et avec date de fin lointaine
        const clientsDormants = await db.query(`
            SELECT nom, prenom, email, date_debut, date_fin, type_abonnement
            FROM clients
            WHERE statut = 'actif'
              AND heure_reservation IS NULL
              AND date_fin > $1
            ORDER BY date_debut DESC
        `, [dateFuture15]);

        // 3. "Clients en voie de disparition" : Inactifs ou Expirés qui n'ont pas renouvelé depuis longtemps
        const clientsPerdus = await db.query(`
            SELECT nom, prenom, email, statut, date_fin, prix_total
            FROM clients
            WHERE statut IN ('inactif', 'expire')
              AND date_fin < $1
            ORDER BY date_fin DESC
            LIMIT 50
        `, [datePast90]);

        // 4. Analyse des abonnements qui ne se renouvellent pas (taux d'attrition par type)
        const attritionParType = await db.query(`
            SELECT
                type_abonnement,
                COUNT(*) as total_abonnes,
                COUNT(CASE WHEN statut IN ('inactif', 'expire') THEN 1 END) as perdus,
                ROUND(COUNT(CASE WHEN statut IN ('inactif', 'expire') THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 2) as taux_attrition
            FROM clients
            WHERE type_abonnement IS NOT NULL
            GROUP BY type_abonnement
            ORDER BY taux_attrition DESC
        `);

        // 5. "Champions" : Clients les plus fidèles (multiple renouvellements)
        const championsFidelite = await db.query(`
            SELECT
                email,
                nom,
                prenom,
                COUNT(*) as nombre_renouvellements,
                SUM(prix_total) as revenu_total,
                MAX(date_fin) as dernier_abonnement
            FROM clients
            GROUP BY email, nom, prenom
            HAVING COUNT(*) > 2  -- Au moins 2 renouvellements
            ORDER BY nombre_renouvellements DESC, revenu_total DESC
            LIMIT 20
        `);

        res.json({
            success: true,
            data: {
                alertes: {
                    clients_a_risque_eleve: clientsARisque.rows.filter(c => c.score_risque >= 70).length,
                    clients_dormants: clientsDormants.rows.length,
                    clients_perdus_recemment: clientsPerdus.rows.length
                },
                listes: {
                    a_risque: clientsARisque.rows,
                    dormants: clientsDormants.rows,
                    perdus: clientsPerdus.rows,
                    champions: championsFidelite.rows
                },
                taux_attrition: {
                    global: clientsARisque.rows.length > 0 ? 'À calculer' : '0%', // Nécessite un suivi dans le temps
                    par_type_abonnement: attritionParType.rows
                }
            }
        });
    } catch (err) {
        console.error('Erreur Risque et Rétention:', err);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse des risques et de la rétention', error: err.message });
    }
});

// ============================================
// 5. ANALYSE DE LA VALEUR CLIENT (RFM)
// ============================================

/**
 * @route   GET /api/analytics/rfm-segmentation
 * @desc    Segmentation RFM (Récence, Fréquence, Montant) des clients.
 */
router.get('/rfm-segmentation', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Calcul des scores RFM pour chaque client
        const rfmScores = await db.query(`
            WITH client_rfm AS (
                SELECT
                    email,
                    nom,
                    prenom,
                    -- R (Récence) : Nombre de jours depuis la dernière date d'abonnement
                    EXTRACT(DAY FROM (CURRENT_DATE - MAX(date_fin))) as recence_jours,
                    -- F (Fréquence) : Nombre total d'abonnements
                    COUNT(*) as frequence,
                    -- M (Montant) : Somme totale des achats
                    SUM(prix_total) as montant_total
                FROM clients
                GROUP BY email, nom, prenom
            )
            SELECT
                email,
                nom,
                prenom,
                recence_jours,
                frequence,
                montant_total,
                -- Attribution de scores de 1 à 4 (1 = meilleur, 4 = pire pour R)
                NTILE(4) OVER (ORDER BY recence_jours ASC) as score_r,
                NTILE(4) OVER (ORDER BY frequence DESC) as score_f,
                NTILE(4) OVER (ORDER BY montant_total DESC) as score_m
            FROM client_rfm
        `);

        // Classification des clients en segments RFM
        const segments = rfmScores.rows.map(client => {
            const scoreTotal = client.score_r + client.score_f + client.score_m;
            let segment = 'Autre';

            if (client.score_r === 1 && client.score_f === 1 && client.score_m === 1) segment = '⭐ Champions (Meilleurs clients)';
            else if (client.score_r >= 2 && client.score_f >= 3 && client.score_m >= 3) segment = '💰 Gros Dépensers (À fidéliser)';
            else if (client.score_r <= 2 && client.score_f <= 2 && client.score_m <= 2) segment = '📈 En croissance (Potentiel)';
            else if (client.score_r >= 3 && client.score_f <= 2 && client.score_m <= 2) segment = '⚠️ À risque (Fidèles mais plus vus)';
            else if (client.score_r >= 3 && client.score_f <= 1 && client.score_m <= 1) segment = '❌ Perdus (À reconquérir)';
            else if (client.score_f === 1 && client.score_m === 1 && client.score_r === 2) segment = '🆕 Nouveaux (À engager)';
            else if (client.score_f >= 3 && client.score_m >= 3 && client.score_r <= 2) segment = '🏆 Très Fidèles (À récompenser)';

            return { ...client, segment };
        });

        // Compilation par segment
        const segmentationResult = {};
        segments.forEach(client => {
            if (!segmentationResult[client.segment]) {
                segmentationResult[client.segment] = {
                    nombre: 0,
                    revenu_total: 0,
                    clients: []
                };
            }
            segmentationResult[client.segment].nombre++;
            segmentationResult[client.segment].revenu_total += parseFloat(client.montant_total);
            segmentationResult[client.segment].clients.push({
                nom: client.nom,
                prenom: client.prenom,
                email: client.email,
                recence: client.recence_jours,
                frequence: client.frequence,
                montant: parseFloat(client.montant_total)
            });
        });

        res.json({
            success: true,
            data: {
                segments: segmentationResult,
                recommandations: {
                    "⭐ Champions (Meilleurs clients)": "Offres exclusives, programme de parrainage.",
                    "💰 Gros Dépensers (À fidéliser)": "Réductions sur le long terme, contenu premium.",
                    "📈 En croissance (Potentiel)": "Encourager le renouvellement, offres groupées.",
                    "⚠️ À risque (Fidèles mais plus vus)": "Campagne de réengagement, email personnalisé.",
                    "❌ Perdus (À reconquérir)": "Offre de retour spéciale, enquête de satisfaction.",
                    "🆕 Nouveaux (À engager)": "Onboarding, guide d'utilisation, bienvenue.",
                    "🏆 Très Fidèles (À récompenser)": "Cadeau d'anniversaire d'abonnement, réduction fidélité."
                }
            }
        });

    } catch (err) {
        console.error('Erreur Segmentation RFM:', err);
        res.status(500).json({ success: false, message: 'Erreur lors de la segmentation RFM', error: err.message });
    }
});

// ============================================
// 6. ANALYSE DE L'IMPACT TEMPOREL (Saisonnalité)
// ============================================

/**
 * @route   GET /api/analytics/saisonnalite
 * @desc    Analyse de la saisonnalité des inscriptions et des revenus.
 */
router.get('/saisonnalite', async (req, res) => {
    try {
        // Comparaison mensuelle sur 2 ans
        const mensuel2Ans = await db.query(`
            SELECT
                EXTRACT(YEAR FROM date_debut) as annee,
                EXTRACT(MONTH FROM date_debut) as mois,
                COUNT(*) as inscriptions,
                COALESCE(SUM(prix_total), 0) as revenus
            FROM clients
            WHERE date_debut > CURRENT_DATE - INTERVAL '24 months'
            GROUP BY annee, mois
            ORDER BY annee DESC, mois DESC
        `);

        // Comparaison trimestrielle
        const trimestriel = await db.query(`
            SELECT
                EXTRACT(YEAR FROM date_debut) as annee,
                EXTRACT(QUARTER FROM date_debut) as trimestre,
                COUNT(*) as inscriptions,
                COALESCE(SUM(prix_total), 0) as revenus
            FROM clients
            GROUP BY annee, trimestre
            ORDER BY annee DESC, trimestre DESC
        `);

        // Meilleurs mois
        const meilleursMois = await db.query(`
            SELECT
                TO_CHAR(date_debut, 'Month') as mois_nom,
                COUNT(*) as inscriptions,
                COALESCE(SUM(prix_total), 0) as revenus
            FROM clients
            GROUP BY TO_CHAR(date_debut, 'Month'), EXTRACT(MONTH FROM date_debut)
            ORDER BY revenus DESC
            LIMIT 3
        `);

        res.json({
            success: true,
            data: {
                mensuel_2_ans: mensuel2Ans.rows,
                trimestriel: trimestriel.rows,
                insights_saisonnalite: {
                    meilleurs_mois_en_revenu: meilleursMois.rows,
                    tendance: "Analysez les données mensuelles pour identifier les pics.",
                    recommandation: "Préparez des campagnes marketing avant vos mois les plus forts."
                }
            }
        });

    } catch (err) {
        console.error('Erreur Saisonnalité:', err);
        res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse de la saisonnalité', error: err.message });
    }
});

export default router;