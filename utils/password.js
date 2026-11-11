import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);

/** Hash password with scrypt → `salt:hex` */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(String(password), salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

/** Verify password against stored `salt:hex` hash */
export async function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const derived = await scrypt(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  const actual = Buffer.from(derived.toString('hex'), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
