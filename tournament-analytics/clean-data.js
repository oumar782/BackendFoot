import pool from '../db.js';

async function cleanTestData() {
  console.log('🧹 Suppressions des données de test en cours...');
  try {
    await pool.query(`
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
    console.log('✅ TOUTES LES DONNÉES DE TEST ONT ÉTÉ SUPPRIMÉES AVEC SUCCÈS !');
    console.log('✨ La base de données est maintenant 100% propre et prête pour les vraies données de production.');
  } catch (err) {
    console.error('❌ Erreur lors de la suppression des données :', err.message);
  } finally {
    process.exit(0);
  }
}

cleanTestData();

