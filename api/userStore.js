/**
 * User store — теперь работает ТОЛЬКО с PostgreSQL (users table)
 * Все функции — обёртки над db-postgres.js
 */

import { query } from './db-postgres.js';

export async function loadStore() {
  const result = await query('SELECT * FROM users');
  const users = result.rows.map((r) => ({
    ...r,
    verified: r.verified === true || r.verified === 1 || r.verified === 'true',
    passwordHash: r.password_hash
  }));
  return { version: 1, users };
}
