import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './modules/auth/routes.js';
import organizationRoutes from './modules/organizations/routes.js';
import { resourceRoutes } from './modules/resources/routes.js';
import rankingsRouter from './modules/rankings/routes.js';
import analyticsRouter from './modules/analytics/routes.js';
import reportsRouter from './modules/reports/routes.js';
import activityLogsRouter from './modules/activity-logs/routes.js';
import { errorHandler, notFound } from './shared/errors.js';
import { ok } from './shared/response.js';
import { initDb, clearDatabase } from './shared/db.js';

// Auto-bootstrap DB tables if needed
initDb();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express.Router();

app.use(express.json());

// API Root
app.get('/', (_req, res) => {
  return ok(res, {
    name: 'Tournament Analytics Manager API',
    version: '1.0.0',
    documentation: '/api/v1/docs/openapi.json',
    health: '/api/v1/health'
  });
});

// Purge Test Data Endpoint
app.post('/admin/clean-test-data', async (_req, res, next) => {
  try {
    await clearDatabase();
    return ok(res, { message: 'Toutes les données de test ont été réinitialisées avec succès' });
  } catch (err) {
    next(err);
  }
});

// Health Check
app.get('/health', (_req, res) => {
  return ok(res, {
    status: 'ok',
    service: 'tournament-analytics-manager',
    timestamp: new Date().toISOString()
  });
});

// 1. Auth Module
app.use('/auth', authRoutes);

// 2. Organizations Module
app.use('/organizations', organizationRoutes);

// 3 to 12. Standard Domain CRUD Resources (tournaments, registrations, teams, players, matches, sponsors, sponsorship-contracts, expenses, financial-transactions)
const domainResources = [
  'tournaments',
  'registrations',
  'teams',
  'players',
  'matches',
  'sponsors',
  'sponsorship-contracts',
  'expenses',
  'financial-transactions'
];

for (const resource of domainResources) {
  app.use(`/${resource}`, resourceRoutes(resource));
}

// 13. Rankings Module (computed from validated match scores)
app.use('/rankings', rankingsRouter);

// 14. Analytics Module (financial calculations & performance metrics)
app.use('/analytics', analyticsRouter);

// 15. Reports Module (aggregated summary reports)
app.use('/reports', reportsRouter);

// 16. Activity Logs Module (audit logs)
app.use('/activity-logs', activityLogsRouter);

// Swagger Documentation Spec Endpoint
const swaggerPath = path.join(__dirname, 'swagger', 'swagger.json');
let openapiSpec = {};
try {
  if (fs.existsSync(swaggerPath)) {
    openapiSpec = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
  }
} catch (e) {
  console.error('Failed to load swagger.json:', e.message);
}

app.get('/docs/openapi.json', (_req, res) => {
  res.json(openapiSpec);
});

// Centralized Error Handling & 404
app.use(notFound);
app.use(errorHandler);

export default app;
