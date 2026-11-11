import pool from './db.js';

async function test() {
  // Check foreign keys on communities table
  try {
    const result = await pool.query(
      "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'communities'::regclass"
    );
    console.log('communities constraints:');
    result.rows.forEach(r => console.log(`  ${r.conname}: ${r.pg_get_constraintdef}`));
  } catch(e) {
    console.log('Error:', e.message);
  }

  // Check if auth.users has avatar_url in raw_user_meta_data
  try {
    const result = await pool.query("SELECT id, email, raw_user_meta_data FROM auth.users LIMIT 3");
    console.log('\nauth.users sample:');
    for (const row of result.rows) {
      console.log(`  id: ${row.id}`);
      console.log(`  email: ${row.email}`);
      console.log(`  raw_user_meta_data: ${JSON.stringify(row.raw_user_meta_data)}`);
    }
  } catch(e) {
    console.log('Error checking auth.users:', e.message);
  }

  // Check public.users sample data
  try {
    const result = await pool.query("SELECT id, email, first_name, last_name FROM users LIMIT 3");
    console.log('\npublic.users (resolved) sample:');
    for (const row of result.rows) {
      console.log(`  id: ${row.id}`);
      console.log(`  email: ${row.email}`);
      console.log(`  first_name: ${row.first_name}`);
      console.log(`  last_name: ${row.last_name}`);
    }
  } catch(e) {
    console.log('Error checking users:', e.message);
  }

  process.exit(0);
}

test();




