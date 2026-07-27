import bcrypt from 'bcryptjs';

/** PHP bcrypt hashes use $2y$; bcryptjs expects $2a$ */
function normalizeBcryptHash(hash) {
  return String(hash).replace(/^\$2y\$/, '$2a$');
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(password), normalizeBcryptHash(hash));
}

export async function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}
