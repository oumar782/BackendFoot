export class HttpError extends Error {
  constructor(status, message, details = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (req, res) => {
  res.status(404).json({
    data: null,
    meta: {},
    error: {
      status: 404,
      message: `Route introuvable: ${req.method} ${req.originalUrl}`,
      details: []
    }
  });
};

export const errorHandler = (err, _req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Erreur interne du serveur';
  let details = err.details || [];

  // Check for DB connection errors / timeouts (Supabase ETIMEDOUT / ECONNREFUSED)
  const errCode = err.code || (err.errors && err.errors[0] && err.errors[0].code);
  const isConnectionTimeout = message.includes('connection terminated') && message.includes('timeout');
  if (errCode === 'ETIMEDOUT' || errCode === 'ECONNREFUSED' || err.name === 'AggregateError' || message.includes('ETIMEDOUT') || isConnectionTimeout) {
    status = 503;
    message = 'Le service de base de données est temporairement indisponible (délai d\'attente dépassé). Veuillez réessayer.';
    details = ['Délai de connexion PostgreSQL Supabase expiré (ETIMEDOUT).'];
  }

  if (status >= 500) {
    console.error('🔥 SERVER ERROR:', err);
  }

  return res.status(status).json({
    data: null,
    meta: {},
    error: {
      status,
      message,
      details
    }
  });
};
