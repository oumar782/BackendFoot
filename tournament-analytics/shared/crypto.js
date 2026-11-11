import crypto from 'crypto';

/**
 * Password hashing helper using Node.js crypto pbkdf2
 */
export const hashPassword = (password) => {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
};

export const verifyPassword = (password, combinedHash) => {
  return new Promise((resolve, reject) => {
    if (!combinedHash || !combinedHash.includes(':')) return resolve(false);
    const [salt, key] = combinedHash.split(':');
    crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString('hex'));
    });
  });
};

