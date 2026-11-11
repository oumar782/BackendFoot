import express from 'express';
import cors from 'cors';
import { ENV } from './config/env.js';
import tournamentAnalyticsApp from './app.js';

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

// Main API mount point on /api/v1
app.use('/api/v1', tournamentAnalyticsApp);

// Root greeting & Swagger documentation info
app.get('/', (_req, res) => {
  res.json({
    message: '🏆 Welcome to Tournament Analytics Manager API',
    api_endpoint: `http://localhost:${ENV.PORT}/api/v1`,
    openapi_spec: `http://localhost:${ENV.PORT}/api/v1/docs/openapi.json`
  });
});

app.listen(ENV.PORT, () => {
  console.log(`
===============================================================
🏆 TOURNAMENT ANALYTICS MANAGER BACKEND API RUNNING 🏆
===============================================================
📡 Base URL : http://localhost:${ENV.PORT}/api/v1
📖 OpenAPI Spec : http://localhost:${ENV.PORT}/api/v1/docs/openapi.json
🏥 Health Check : http://localhost:${ENV.PORT}/api/v1/health
===============================================================
  `);
});

export default app;

