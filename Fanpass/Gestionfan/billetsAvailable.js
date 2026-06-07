// ============================================
// API - RÉSERVATIONS (CRUD COMPLET)
// ============================================

import express from 'express';
import db from '../../db.js';

const router = express.Router();

// ==================== CRUD RÉSERVATIONS ====================

// 📌 CREATE - Créer une réservation
router.post('/', async (req, res) => {
    try {
        const {
            billet_id,
            nom_acheteur,
            prenom_acheteur,
            email_acheteur,
            telephone,
            mode_paiement,
            montant,
            notes
        } = req.body;

        if (!billet_id || !nom_acheteur || !prenom_acheteur || !email_acheteur) {
            return res.status(400).json({
                success: false,
                message: 'Champs requis: billet_id, nom_acheteur, prenom_acheteur, email_acheteur'
            });
        }

        // Vérifier que le billet existe et est actif
        const billetCheck = await db.query(
            `SELECT id, equipe_1, equipe_2, date_match, type_billet, statut_billet
             FROM billets WHERE id = $1`,
            [billet_id]
        );

        if (billetCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Billet introuvable'
            });
        }

        if (billetCheck.rows[0].statut_billet !== 'actif') {
            return res.status(409).json({
                success: false,
                message: 'Ce billet n\'est plus disponible',
                statut: billetCheck.rows[0].statut_billet
            });
        }

        // Créer la réservation et marquer le billet comme réservé (transaction)
        await db.query('BEGIN');

        const reservationResult = await db.query(
            `INSERT INTO reservations (
                billet_id, nom_acheteur, prenom_acheteur, email_acheteur,
                telephone, mode_paiement, montant, statut_reservation, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_attente', $8)
            RETURNING *`,
            [billet_id, nom_acheteur, prenom_acheteur, email_acheteur,
             telephone, mode_paiement, montant, notes]
        );

        await db.query(
            `UPDATE billets SET statut_billet = 'reserve' WHERE id = $1`,
            [billet_id]
        );

        await db.query('COMMIT');

        res.status(201).json({
            success: true,
            message: 'Réservation créée avec succès',
            reservation: reservationResult.rows[0],
            billet: billetCheck.rows[0]
        });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Erreur création réservation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la création de la réservation',
            error: error.message
        });
    }
});

// 📖 READ - Lister toutes les réservations (avec filtres et pagination)
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            statut_reservation,
            email_acheteur,
            billet_id,
            date_min,
            date_max
        } = req.query;

        const offset = (page - 1) * limit;
        let conditions = [];
        let params = [];

        if (statut_reservation) {
            conditions.push(`r.statut_reservation = $${params.length + 1}`);
            params.push(statut_reservation);
        }
        if (email_acheteur) {
            conditions.push(`r.email_acheteur ILIKE $${params.length + 1}`);
            params.push(`%${email_acheteur}%`);
        }
        if (billet_id) {
            conditions.push(`r.billet_id = $${params.length + 1}`);
            params.push(billet_id);
        }
        if (date_min) {
            conditions.push(`r.date_reservation >= $${params.length + 1}`);
            params.push(date_min);
        }
        if (date_max) {
            conditions.push(`r.date_reservation <= $${params.length + 1}`);
            params.push(date_max);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await db.query(
            `SELECT COUNT(*) FROM reservations r ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        const result = await db.query(
            `SELECT
                r.id, r.billet_id, r.nom_acheteur, r.prenom_acheteur,
                r.email_acheteur, r.telephone, r.mode_paiement, r.montant,
                r.statut_reservation, r.notes, r.date_reservation,
                b.equipe_1, b.equipe_2, b.date_match, b.heure_match,
                b.stade, b.ville, b.type_billet, b.tribune, b.rang, b.siege
             FROM reservations r
             LEFT JOIN billets b ON r.billet_id = b.id
             ${whereClause}
             ORDER BY r.date_reservation DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Erreur lecture réservations:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des réservations',
            error: error.message
        });
    }
});

// 📖 READ - Récupérer une réservation par ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `SELECT
                r.*,
                b.equipe_1, b.equipe_2, b.date_match, b.heure_match,
                b.stade, b.ville, b.phase_match, b.edition,
                b.type_billet, b.porte, b.tribune, b.rang, b.siege,
                b.latitude_porte, b.longitude_porte,
                b.creneau_debut, b.creneau_fin
             FROM reservations r
             LEFT JOIN billets b ON r.billet_id = b.id
             WHERE r.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Réservation non trouvée'
            });
        }

        res.json({ success: true, reservation: result.rows[0] });
    } catch (error) {
        console.error('Erreur lecture réservation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur de récupération',
            error: error.message
        });
    }
});

// 📖 READ - Réservations par email
router.get('/email/:email', async (req, res) => {
    try {
        const { email } = req.params;

        const result = await db.query(
            `SELECT
                r.id, r.statut_reservation, r.date_reservation, r.montant,
                b.equipe_1, b.equipe_2, b.date_match, b.heure_match,
                b.stade, b.ville, b.type_billet
             FROM reservations r
             LEFT JOIN billets b ON r.billet_id = b.id
             WHERE r.email_acheteur = $1
             ORDER BY r.date_reservation DESC`,
            [email]
        );

        res.json({
            success: true,
            email,
            total: result.rows.length,
            reservations: result.rows
        });
    } catch (error) {
        console.error('Erreur lecture réservations par email:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur de récupération',
            error: error.message
        });
    }
});

// ✏️ UPDATE - Modifier une réservation
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nom_acheteur,
            prenom_acheteur,
            email_acheteur,
            telephone,
            mode_paiement,
            montant,
            statut_reservation,
            notes
        } = req.body;

        const checkResult = await db.query(
            'SELECT id, billet_id, statut_reservation FROM reservations WHERE id = $1',
            [id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Réservation non trouvée'
            });
        }

        const reservation = checkResult.rows[0];

        // Si on annule la réservation, remettre le billet comme actif
        if (statut_reservation === 'annulee' && reservation.statut_reservation !== 'annulee') {
            await db.query('BEGIN');

            await db.query(
                `UPDATE billets SET statut_billet = 'actif' WHERE id = $1`,
                [reservation.billet_id]
            );

            const result = await db.query(
                `UPDATE reservations SET
                    nom_acheteur = COALESCE($1, nom_acheteur),
                    prenom_acheteur = COALESCE($2, prenom_acheteur),
                    email_acheteur = COALESCE($3, email_acheteur),
                    telephone = COALESCE($4, telephone),
                    mode_paiement = COALESCE($5, mode_paiement),
                    montant = COALESCE($6, montant),
                    statut_reservation = COALESCE($7, statut_reservation),
                    notes = COALESCE($8, notes)
                 WHERE id = $9
                 RETURNING *`,
                [nom_acheteur, prenom_acheteur, email_acheteur, telephone,
                 mode_paiement, montant, statut_reservation, notes, id]
            );

            await db.query('COMMIT');
            return res.json({
                success: true,
                message: 'Réservation annulée, billet remis à disposition',
                reservation: result.rows[0]
            });
        }

        // Si on confirme la réservation, marquer le billet comme vendu
        if (statut_reservation === 'confirmee') {
            await db.query('BEGIN');

            await db.query(
                `UPDATE billets SET statut_billet = 'vendu' WHERE id = $1`,
                [reservation.billet_id]
            );

            const result = await db.query(
                `UPDATE reservations SET
                    nom_acheteur = COALESCE($1, nom_acheteur),
                    prenom_acheteur = COALESCE($2, prenom_acheteur),
                    email_acheteur = COALESCE($3, email_acheteur),
                    telephone = COALESCE($4, telephone),
                    mode_paiement = COALESCE($5, mode_paiement),
                    montant = COALESCE($6, montant),
                    statut_reservation = COALESCE($7, statut_reservation),
                    notes = COALESCE($8, notes)
                 WHERE id = $9
                 RETURNING *`,
                [nom_acheteur, prenom_acheteur, email_acheteur, telephone,
                 mode_paiement, montant, statut_reservation, notes, id]
            );

            await db.query('COMMIT');
            return res.json({
                success: true,
                message: 'Réservation confirmée, billet marqué comme vendu',
                reservation: result.rows[0]
            });
        }

        // Mise à jour simple sans changement de statut critique
        const result = await db.query(
            `UPDATE reservations SET
                nom_acheteur = COALESCE($1, nom_acheteur),
                prenom_acheteur = COALESCE($2, prenom_acheteur),
                email_acheteur = COALESCE($3, email_acheteur),
                telephone = COALESCE($4, telephone),
                mode_paiement = COALESCE($5, mode_paiement),
                montant = COALESCE($6, montant),
                statut_reservation = COALESCE($7, statut_reservation),
                notes = COALESCE($8, notes)
             WHERE id = $9
             RETURNING *`,
            [nom_acheteur, prenom_acheteur, email_acheteur, telephone,
             mode_paiement, montant, statut_reservation, notes, id]
        );

        res.json({
            success: true,
            message: 'Réservation mise à jour',
            reservation: result.rows[0]
        });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Erreur mise à jour réservation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur de mise à jour',
            error: error.message
        });
    }
});

// ❌ DELETE - Supprimer une réservation
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { hard_delete } = req.query;

        const checkResult = await db.query(
            'SELECT id, billet_id, statut_reservation FROM reservations WHERE id = $1',
            [id]
        );

        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Réservation non trouvée'
            });
        }

        const reservation = checkResult.rows[0];

        if (hard_delete === 'true') {
            await db.query('BEGIN');
            // Remettre le billet actif si pas déjà vendu
            if (reservation.statut_reservation !== 'confirmee') {
                await db.query(
                    `UPDATE billets SET statut_billet = 'actif' WHERE id = $1`,
                    [reservation.billet_id]
                );
            }
            await db.query('DELETE FROM reservations WHERE id = $1', [id]);
            await db.query('COMMIT');
            return res.json({
                success: true,
                message: 'Réservation supprimée définitivement'
            });
        }

        // Soft delete : annulation
        await db.query('BEGIN');
        await db.query(
            `UPDATE reservations SET statut_reservation = 'annulee' WHERE id = $1`,
            [id]
        );
        if (reservation.statut_reservation !== 'confirmee') {
            await db.query(
                `UPDATE billets SET statut_billet = 'actif' WHERE id = $1`,
                [reservation.billet_id]
            );
        }
        await db.query('COMMIT');

        res.json({
            success: true,
            message: 'Réservation annulée (soft delete), billet remis à disposition'
        });
    } catch (error) {
        await db.query('ROLLBACK');
        console.error('Erreur suppression réservation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur de suppression',
            error: error.message
        });
    }
});

export default router;