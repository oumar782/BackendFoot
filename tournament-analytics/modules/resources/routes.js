import { Router } from 'express';
import { createResourceService } from './service.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission } from '../../shared/roles.js';
import { ok } from '../../shared/response.js';

export const RESOURCE_DEFINITIONS = {
  tournaments: {
    table: 'tournaments',
    search: ['name', 'description', 'location'],
    fields: ['name', 'description', 'status', 'start_date', 'end_date', 'location'],
    allowedSorts: ['name', 'start_date', 'status', 'created_at']
  },
  registrations: {
    table: 'registrations',
    search: [],
    fields: ['tournament_id', 'team_id', 'registration_date', 'status', 'fee'],
    allowedSorts: ['registration_date', 'status', 'fee', 'created_at']
  },
  teams: {
    table: 'teams',
    search: ['name', 'captain_name', 'contact_email'],
    fields: ['name', 'logo_url', 'captain_name', 'contact_email'],
    allowedSorts: ['name', 'captain_name', 'created_at']
  },
  players: {
    table: 'players',
    search: ['name', 'email', 'position'],
    fields: ['team_id', 'name', 'position', 'jersey_number', 'email', 'date_of_birth'],
    allowedSorts: ['name', 'jersey_number', 'position', 'created_at']
  },
  matches: {
    table: 'matches',
    search: [],
    fields: ['tournament_id', 'home_team_id', 'away_team_id', 'match_date', 'status', 'home_score', 'away_score', 'is_validated'],
    allowedSorts: ['match_date', 'status', 'is_validated', 'created_at']
  },
  sponsors: {
    table: 'sponsors',
    search: ['name', 'contact_person', 'email'],
    fields: ['name', 'contact_person', 'email', 'phone', 'logo_url'],
    allowedSorts: ['name', 'created_at']
  },
  'sponsorship-contracts': {
    table: 'sponsorship_contracts',
    search: [],
    fields: ['sponsor_id', 'tournament_id', 'amount', 'start_date', 'end_date', 'status'],
    allowedSorts: ['amount', 'start_date', 'status', 'created_at']
  },
  expenses: {
    table: 'expenses',
    search: ['description', 'category'],
    fields: ['tournament_id', 'description', 'category', 'amount', 'expense_date'],
    allowedSorts: ['amount', 'expense_date', 'category', 'created_at']
  },
  'financial-transactions': {
    table: 'financial_transactions',
    search: ['description', 'category', 'reference'],
    fields: ['tournament_id', 'type', 'category', 'amount', 'description', 'transaction_date', 'reference'],
    allowedSorts: ['amount', 'transaction_date', 'type', 'category', 'created_at']
  }
};

export const resourceRoutes = (resourceName) => {
  const router = Router();
  const def = RESOURCE_DEFINITIONS[resourceName];
  if (!def) {
    throw new Error(`Ressource non définie: ${resourceName}`);
  }

  const service = createResourceService(def);

  router.use(authenticate);

  router.get('/', requirePermission('read'), async (req, res, next) => {
    try {
      const result = await service.list(req.user.organizationId, req.query);
      return ok(res, result.data, result.meta);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission('read'), async (req, res, next) => {
    try {
      const item = await service.get(req.user.organizationId, req.params.id);
      return ok(res, item);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('create'), async (req, res, next) => {
    try {
      const created = await service.create(req.user, req.body);
      return ok(res, created, {}, 201);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requirePermission('update'), async (req, res, next) => {
    try {
      const updated = await service.update(req.user, req.params.id, req.body);
      return ok(res, updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('delete'), async (req, res, next) => {
    try {
      const deleted = await service.remove(req.user, req.params.id);
      return ok(res, deleted);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
