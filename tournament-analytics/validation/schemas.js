export const validateRegister = (data) => {
  const errors = [];
  if (!data.organization_name || !data.organization_name.trim()) errors.push('organization_name est requis');
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('email valide est requis');
  if (!data.password || data.password.length < 6) errors.push('password de 6 caractères minimum est requis');
  return errors;
};

export const validateLogin = (data) => {
  const errors = [];
  if (!data.email) errors.push('email est requis');
  if (!data.password) errors.push('password est requis');
  return errors;
};

export const validateTournament = (data) => {
  const errors = [];
  if (!data.name || !data.name.trim()) errors.push('name est requis');
  if (data.status && !['draft', 'ongoing', 'completed', 'cancelled'].includes(data.status)) {
    errors.push('status invalide (draft, ongoing, completed, cancelled)');
  }
  return errors;
};

export const validateRegistration = (data) => {
  const errors = [];
  if (!data.tournament_id) errors.push('tournament_id est requis');
  if (!data.team_id) errors.push('team_id est requis');
  if (data.status && !['pending', 'approved', 'rejected', 'cancelled'].includes(data.status)) {
    errors.push('status invalide (pending, approved, rejected, cancelled)');
  }
  return errors;
};

export const validateTeam = (data) => {
  const errors = [];
  if (!data.name || !data.name.trim()) errors.push('name est requis');
  return errors;
};

export const validatePlayer = (data) => {
  const errors = [];
  if (!data.name || !data.name.trim()) errors.push('name est requis');
  return errors;
};

export const validateMatch = (data) => {
  const errors = [];
  if (!data.tournament_id) errors.push('tournament_id est requis');
  if (!data.home_team_id) errors.push('home_team_id est requis');
  if (!data.away_team_id) errors.push('away_team_id est requis');
  if (data.status && !['scheduled', 'live', 'completed', 'cancelled'].includes(data.status)) {
    errors.push('status invalide (scheduled, live, completed, cancelled)');
  }
  return errors;
};

export const validateSponsor = (data) => {
  const errors = [];
  if (!data.name || !data.name.trim()) errors.push('name est requis');
  return errors;
};

export const validateSponsorshipContract = (data) => {
  const errors = [];
  if (!data.sponsor_id) errors.push('sponsor_id est requis');
  if (data.amount === undefined || isNaN(Number(data.amount))) errors.push('amount numérique est requis');
  return errors;
};

export const validateExpense = (data) => {
  const errors = [];
  if (!data.description || !data.description.trim()) errors.push('description est requise');
  if (!data.category || !data.category.trim()) errors.push('category est requise');
  if (data.amount === undefined || isNaN(Number(data.amount))) errors.push('amount numérique est requis');
  return errors;
};

export const validateFinancialTransaction = (data) => {
  const errors = [];
  if (!data.type || !['income', 'expense'].includes(data.type)) errors.push('type doit être income ou expense');
  if (!data.category || !data.category.trim()) errors.push('category est requise');
  if (data.amount === undefined || isNaN(Number(data.amount))) errors.push('amount numérique est requis');
  return errors;
};

