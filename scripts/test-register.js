import dotenv from 'dotenv';
dotenv.config();

const base = process.env.API_BASE || 'http://127.0.0.1:5000';

async function main() {
  const email = `youssef.test.${Date.now()}@exemple.ma`;
  const body = {
    name: 'Youssef Benani',
    email,
    password: 'motdepasse123',
    phone: '0612345678',
    city: 'Casablanca',
    quartier: 'Maârif',
    role: 'PLAYER',
    skillLevel: 'INTERMEDIATE',
    sports: ['football', 'padel'],
  };

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log('status', res.status);
  console.log(JSON.stringify(json, null, 2));
  if (!json.success) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
