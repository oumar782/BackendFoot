import fs from 'fs';
import crypto from 'crypto';

const envPath = '.env';
let env = fs.readFileSync(envPath, 'utf8');
if (!/^JWT_SECRET=/m.test(env)) {
  const secret = crypto.randomBytes(48).toString('hex');
  if (!env.endsWith('\n')) env += '\n';
  env += `JWT_SECRET=${secret}\nJWT_EXPIRES_IN=7d\n`;
  fs.writeFileSync(envPath, env);
  console.log('JWT_SECRET added');
} else {
  console.log('JWT_SECRET already present');
}
