// 📊 Analyse financière mensuelle avec comparaison année précédente
router.get('/analyse-mensuelle', async (req, res) => {
  try {
    const { annee } = req.query;
    const anneeCourante = annee || new Date().getFullYear();
    const anneePrecedente = anneeCourante - 1;

    // Récupérer les données des deux années en parallèle
    const result = await db.query(`
      WITH donnees_annees AS (
        SELECT 
          EXTRACT(YEAR FROM datereservation) as annee,
          EXTRACT(MONTH FROM datereservation) as mois,
          DATE_TRUNC('month', datereservation) as mois_date,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'MM/YYYY') as periode,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month YYYY') as periode_affichage,
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month') as nom_mois,
          COUNT(*) as nombre_reservations,
          SUM(tarif) as chiffre_affaires,
          AVG(tarif) as tarif_moyen,
          SUM(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600) as heures_totales,
          COUNT(DISTINCT numeroterrain) as terrains_utilises,
          COUNT(DISTINCT email) as clients_uniques,
          ROUND((AVG(tarif / NULLIF(EXTRACT(EPOCH FROM (heurefin - heurereservation))/3600, 0)))::numeric, 2) as tarif_horaire_moyen
        FROM reservation
        WHERE statut IN ('confirmée', 'payé', 'terminée')
          AND EXTRACT(YEAR FROM datereservation) IN ($1, $2)
        GROUP BY 
          EXTRACT(YEAR FROM datereservation),
          EXTRACT(MONTH FROM datereservation),
          DATE_TRUNC('month', datereservation),
          TO_CHAR(DATE_TRUNC('month', datereservation), 'Month')
      ),
      tous_mois AS (
        SELECT generate_series(1, 12) as mois_num
      ),
      mois_annee_courante AS (
        SELECT * FROM donnees_annees WHERE annee = $1
      ),
      mois_annee_precedente AS (
        SELECT * FROM donnees_annees WHERE annee = $2
      )
      SELECT 
        tm.mois_num as mois,
        TO_CHAR(TO_DATE(tm.mois_num::text, 'MM'), 'Month') as nom_mois_complet,
        COALESCE(mac.periode_affichage, 
          TO_CHAR(TO_DATE($1::text || '-' || LPAD(tm.mois_num::text, 2, '0'), 'YYYY-MM'), 'Month YYYY')) as periode_affichage_courante,
        COALESCE(map.periode_affichage, 
          TO_CHAR(TO_DATE($2::text || '-' || LPAD(tm.mois_num::text, 2, '0'), 'YYYY-MM'), 'Month YYYY')) as periode_affichage_precedente,
        
        -- Année courante
        COALESCE(mac.nombre_reservations, 0) as reservations_courantes,
        COALESCE(mac.chiffre_affaires, 0) as ca_courant,
        COALESCE(mac.tarif_moyen, 0) as tarif_moyen_courant,
        COALESCE(mac.heures_totales, 0) as heures_totales_courantes,
        COALESCE(mac.terrains_utilises, 0) as terrains_utilises_courants,
        COALESCE(mac.clients_uniques, 0) as clients_uniques_courants,
        COALESCE(mac.tarif_horaire_moyen, 0) as tarif_horaire_moyen_courant,
        
        -- Année précédente
        COALESCE(map.nombre_reservations, 0) as reservations_precedentes,
        COALESCE(map.chiffre_affaires, 0) as ca_precedent,
        COALESCE(map.tarif_moyen, 0) as tarif_moyen_precedent,
        COALESCE(map.heures_totales, 0) as heures_totales_precedentes,
        COALESCE(map.terrains_utilises, 0) as terrains_utilises_precedents,
        COALESCE(map.clients_uniques, 0) as clients_uniques_precedents,
        COALESCE(map.tarif_horaire_moyen, 0) as tarif_horaire_moyen_precedent,
        
        -- Calculs d'évolution
        CASE 
          WHEN COALESCE(map.chiffre_affaires, 0) > 0 
          THEN ROUND(((COALESCE(mac.chiffre_affaires, 0) - COALESCE(map.chiffre_affaires, 0)) / 
                     COALESCE(map.chiffre_affaires, 0)) * 100, 2)
          ELSE 0 
        END as evolution_ca_pourcentage,
        
        CASE 
          WHEN COALESCE(map.nombre_reservations, 0) > 0 
          THEN ROUND(((COALESCE(mac.nombre_reservations, 0) - COALESCE(map.nombre_reservations, 0)) / 
                     COALESCE(map.nombre_reservations, 0)) * 100, 2)
          ELSE 0 
        END as evolution_reservations_pourcentage,
        
        CASE 
          WHEN COALESCE(map.clients_uniques, 0) > 0 
          THEN ROUND(((COALESCE(mac.clients_uniques, 0) - COALESCE(map.clients_uniques, 0)) / 
                     COALESCE(map.clients_uniques, 0)) * 100, 2)
          ELSE 0 
        END as evolution_clients_pourcentage
        
      FROM tous_mois tm
      LEFT JOIN mois_annee_courante mac ON tm.mois_num = EXTRACT(MONTH FROM mac.mois_date)
      LEFT JOIN mois_annee_precedente map ON tm.mois_num = EXTRACT(MONTH FROM map.mois_date)
      ORDER BY tm.mois_num DESC
    `, [anneeCourante, anneePrecedente]);

    // Structurer les données pour faciliter l'affichage côté frontend
    const donneesStructurees = result.rows.map(mois => {
      const caCourant = parseFloat(mois.ca_courant);
      const caPrecedent = parseFloat(mois.ca_precedent);
      const reservationsCourantes = parseInt(mois.reservations_courantes);
      const reservationsPrecedentes = parseInt(mois.reservations_precedentes);
      
      // Déterminer les tendances
      const tendanceCA = mois.evolution_ca_pourcentage > 0 ? 'hausse' : 
                        mois.evolution_ca_pourcentage < 0 ? 'baisse' : 'stable';
      
      const tendanceReservations = mois.evolution_reservations_pourcentage > 0 ? 'hausse' : 
                                  mois.evolution_reservations_pourcentage < 0 ? 'baisse' : 'stable';

      return {
        mois: parseInt(mois.mois),
        nom_mois: mois.nom_mois_complet.trim(),
        periode_affichage: mois.periode_affichage_courante,
        
        // Données année courante
        annee_courante: {
          chiffre_affaires: caCourant,
          nombre_reservations: reservationsCourantes,
          tarif_moyen: parseFloat(mois.tarif_moyen_courant),
          heures_totales: parseFloat(mois.heures_totales_courantes),
          terrains_utilises: parseInt(mois.terrains_utilises_courants),
          clients_uniques: parseInt(mois.clients_uniques_courants),
          tarif_horaire_moyen: parseFloat(mois.tarif_horaire_moyen_courant),
          periode_affichage: mois.periode_affichage_courante
        },
        
        // Données année précédente
        annee_precedente: {
          chiffre_affaires: caPrecedent,
          nombre_reservations: reservationsPrecedentes,
          tarif_moyen: parseFloat(mois.tarif_moyen_precedent),
          heures_totales: parseFloat(mois.heures_totales_precedentes),
          terrains_utilises: parseInt(mois.terrains_utilises_precedents),
          clients_uniques: parseInt(mois.clients_uniques_precedents),
          tarif_horaire_moyen: parseFloat(mois.tarif_horaire_moyen_precedent),
          periode_affichage: mois.periode_affichage_precedente
        },
        
        // Évolutions
        evolution: {
          ca: mois.evolution_ca_pourcentage,
          reservations: mois.evolution_reservations_pourcentage,
          clients: mois.evolution_clients_pourcentage,
          tendance_ca: tendanceCA,
          tendance_reservations: tendanceReservations,
          difference_ca: caCourant - caPrecedent,
          difference_reservations: reservationsCourantes - reservationsPrecedentes
        },
        
        // Données pour graphiques
        pour_graphique: {
          mois_abrege: mois.nom_mois_complet.trim().substring(0, 3),
          ca_courant: caCourant,
          ca_precedent: caPrecedent,
          reservations_courantes: reservationsCourantes,
          reservations_precedentes: reservationsPrecedentes
        }
      };
    });

    // Statistiques globales pour les deux années
    const statsGlobales = result.rows.reduce((acc, mois) => {
      // Année courante
      acc.annee_courante.ca_total += parseFloat(mois.ca_courant);
      acc.annee_courante.reservations_total += parseInt(mois.reservations_courantes);
      acc.annee_courante.heures_total += parseFloat(mois.heures_totales_courantes);
      acc.annee_courante.clients_total += parseInt(mois.clients_uniques_courants);
      
      // Année précédente
      acc.annee_precedente.ca_total += parseFloat(mois.ca_precedent);
      acc.annee_precedente.reservations_total += parseInt(mois.reservations_precedentes);
      acc.annee_precedente.heures_total += parseFloat(mois.heures_totales_precedentes);
      acc.annee_precedente.clients_total += parseInt(mois.clients_uniques_precedents);
      
      // Compter les mois actifs
      if (parseFloat(mois.ca_courant) > 0) acc.annee_courante.mois_actifs++;
      if (parseFloat(mois.ca_precedent) > 0) acc.annee_precedente.mois_actifs++;
      
      return acc;
    }, {
      annee_courante: { ca_total: 0, reservations_total: 0, heures_total: 0, clients_total: 0, mois_actifs: 0 },
      annee_precedente: { ca_total: 0, reservations_total: 0, heures_total: 0, clients_total: 0, mois_actifs: 0 }
    });

    // Calculer les moyennes
    statsGlobales.annee_courante.ca_moyen_mensuel = 
      statsGlobales.annee_courante.mois_actifs > 0 
        ? statsGlobales.annee_courante.ca_total / statsGlobales.annee_courante.mois_actifs 
        : 0;
    
    statsGlobales.annee_precedente.ca_moyen_mensuel = 
      statsGlobales.annee_precedente.mois_actifs > 0 
        ? statsGlobales.annee_precedente.ca_total / statsGlobales.annee_precedente.mois_actifs 
        : 0;

    statsGlobales.annee_courante.reservations_moyennes_mensuelles = 
      statsGlobales.annee_courante.mois_actifs > 0 
        ? statsGlobales.annee_courante.reservations_total / statsGlobales.annee_courante.mois_actifs 
        : 0;
    
    statsGlobales.annee_precedente.reservations_moyennes_mensuelles = 
      statsGlobales.annee_precedente.mois_actifs > 0 
        ? statsGlobales.annee_precedente.reservations_total / statsGlobales.annee_precedente.mois_actifs 
        : 0;

    // Calculer l'évolution globale
    const evolutionGlobaleCA = statsGlobales.annee_precedente.ca_total > 0
      ? ((statsGlobales.annee_courante.ca_total - statsGlobales.annee_precedente.ca_total) / 
         statsGlobales.annee_precedente.ca_total) * 100
      : 0;
    
    const evolutionGlobaleReservations = statsGlobales.annee_precedente.reservations_total > 0
      ? ((statsGlobales.annee_courante.reservations_total - statsGlobales.annee_precedente.reservations_total) / 
         statsGlobales.annee_precedente.reservations_total) * 100
      : 0;

    // Identifier les meilleurs et pires mois
    const moisAvecCA = donneesStructurees.filter(m => m.annee_courante.chiffre_affaires > 0);
    const meilleurMois = moisAvecCA.length > 0
      ? moisAvecCA.reduce((max, mois) => 
          mois.annee_courante.chiffre_affaires > max.annee_courante.chiffre_affaires ? mois : max
        , moisAvecCA[0])
      : null;
    
    const pireMois = moisAvecCA.length > 0
      ? moisAvecCA.reduce((min, mois) => 
          mois.annee_courante.chiffre_affaires < min.annee_courante.chiffre_affaires ? mois : min
        , moisAvecCA[0])
      : null;

    res.json({
      success: true,
      data: {
        analyse_mensuelle: donneesStructurees,
        stats_globales: {
          annee_courante: {
            ...statsGlobales.annee_courante,
            evolution_vs_annee_precedente: Math.round(evolutionGlobaleCA * 100) / 100,
            evolution_reservations: Math.round(evolutionGlobaleReservations * 100) / 100,
            tendance_ca: evolutionGlobaleCA > 0 ? 'hausse' : evolutionGlobaleCA < 0 ? 'baisse' : 'stable',
            tendance_reservations: evolutionGlobaleReservations > 0 ? 'hausse' : evolutionGlobaleReservations < 0 ? 'baisse' : 'stable'
          },
          annee_precedente: statsGlobales.annee_precedente
        },
        meilleur_mois: meilleurMois,
        pire_mois: pireMois,
        mois_plus_croissance: donneesStructurees
          .filter(m => m.evolution.ca > 0)
          .sort((a, b) => b.evolution.ca - a.evolution.ca)
          .slice(0, 3),
        mois_plus_declin: donneesStructurees
          .filter(m => m.evolution.ca < 0)
          .sort((a, b) => a.evolution.ca - b.evolution.ca)
          .slice(0, 3)
      },
      annees_analyse: {
        annee_courante: anneeCourante,
        annee_precedente: anneePrecedente
      },
      metadata: {
        donnees_pour_graphiques: {
          labels: donneesStructurees.map(m => m.nom_mois.substring(0, 3)).reverse(),
          ca_annee_courante: donneesStructurees.map(m => m.annee_courante.chiffre_affaires).reverse(),
          ca_annee_precedente: donneesStructurees.map(m => m.annee_precedente.chiffre_affaires).reverse(),
          reservations_annee_courante: donneesStructurees.map(m => m.annee_courante.nombre_reservations).reverse(),
          reservations_annee_precedente: donneesStructurees.map(m => m.annee_precedente.nombre_reservations).reverse()
        },
        format_recommandation: "Utilisez deux séries de données côte à côte pour comparer l'année en cours avec l'année précédente"
      }
    });

  } catch (error) {
    console.error('❌ Erreur analyse mensuelle avec comparaison:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur',
      error: error.message
    });
  }
});