import { HttpError } from '../shared/errors.js';

export const validateBody = (validatorFn) => (req, _res, next) => {
  const errors = validatorFn(req.body || {});
  if (errors && errors.length > 0) {
    return next(new HttpError(422, 'Erreur de validation des données', errors));
  }
  next();
};

export const validateQuery = (validatorFn) => (req, _res, next) => {
  const errors = validatorFn(req.query || {});
  if (errors && errors.length > 0) {
    return next(new HttpError(422, 'Erreur de validation des paramètres de requête', errors));
  }
  next();
};
