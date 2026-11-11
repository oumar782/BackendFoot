import pool, { queryWithRetry } from '../db.js';

export { queryWithRetry } from '../db.js';

/**
 * Truncate all test data in Tournament Analytics Manager tables
 */
export const clearDatabase = async () => {
  try {
    console.log('🧹 Purge des données de test...');
    await queryWithRetry(`
      TRUNCATE TABLE 
        organizations, 
        users, 
        tournaments, 
        teams, 
        registrations, 
        players, 
        matches, 
        sponsors, 
        sponsorship_contracts, 
        expenses, 
        financial_transactions, 
        activity_logs 
      RESTART IDENTITY CASCADE;
    `);
    console.log('✅ Base de données réinitialisée et nettoyée !');
  } catch (err) {
    console.error('⚠️ Erreur lors de la purge de la base de données:', err.message);
  }
};

/**
 * Auto-initialize database schema if tables do not exist (Non-blocking & Safe)
 */
export const initDb = async () => {
  try {
    console.log('🔄 Vérification du schéma Tournament Analytics...');
    
    await queryWithRetry(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS organizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'editor', 'analyst', 'viewer')),
          first_name VARCHAR(100),
          last_name VARCHAR(100),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tournaments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ongoing', 'completed', 'cancelled')),
          start_date DATE,
          end_date DATE,
          location VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS teams (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          logo_url TEXT,
          captain_name VARCHAR(255),
          contact_email VARCHAR(255),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS registrations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
          team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          registration_date DATE DEFAULT CURRENT_DATE,
          status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
          fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT unique_team_tournament_registration UNIQUE (tournament_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS players (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
          name VARCHAR(255) NOT NULL,
          position VARCHAR(50),
          jersey_number INTEGER,
          email VARCHAR(255),
          date_of_birth DATE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matches (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
          home_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          away_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          match_date TIMESTAMPTZ,
          status VARCHAR(50) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled')),
          home_score INTEGER NOT NULL DEFAULT 0,
          away_score INTEGER NOT NULL DEFAULT 0,
          is_validated BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sponsors (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          contact_person VARCHAR(255),
          email VARCHAR(255),
          phone VARCHAR(50),
          logo_url TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sponsorship_contracts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
          tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
          amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
          start_date DATE,
          end_date DATE,
          status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS expenses (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
          description TEXT NOT NULL,
          category VARCHAR(100) NOT NULL,
          amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
          expense_date DATE DEFAULT CURRENT_DATE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS financial_transactions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
          type VARCHAR(50) NOT NULL CHECK (type IN ('income', 'expense')),
          category VARCHAR(100) NOT NULL,
          amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
          description TEXT,
          transaction_date DATE DEFAULT CURRENT_DATE,
          reference VARCHAR(100),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          action VARCHAR(100) NOT NULL,
          entity VARCHAR(100) NOT NULL,
          entity_id UUID,
          details JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
      CREATE INDEX IF NOT EXISTS idx_tournaments_org ON tournaments(organization_id);
      CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(organization_id);
      CREATE INDEX IF NOT EXISTS idx_registrations_org ON registrations(organization_id);
      CREATE INDEX IF NOT EXISTS idx_registrations_tournament ON registrations(tournament_id);
      CREATE INDEX IF NOT EXISTS idx_players_org ON players(organization_id);
      CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
      CREATE INDEX IF NOT EXISTS idx_matches_org ON matches(organization_id);
      CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
      CREATE INDEX IF NOT EXISTS idx_sponsors_org ON sponsors(organization_id);
      CREATE INDEX IF NOT EXISTS idx_sponsorship_contracts_org ON sponsorship_contracts(organization_id);
      CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(organization_id);
      CREATE INDEX IF NOT EXISTS idx_financial_transactions_org ON financial_transactions(organization_id);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_org ON activity_logs(organization_id);
    `);
    
    console.log('✅ Schéma Tournament Analytics vérifié et prêt !');
  } catch (err) {
    console.error('⚠️ Avertissement lors de la vérification du schéma DB:', err.message);
  }
};

export default pool;
