import 'dotenv/config';
import { createClient } from 'webdav';
import * as XLSX from 'xlsx';
import { query, emailExists, createUser } from './db-postgres.js';

// Helper functions for parsing Excel data
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function coerceBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function toNumberOrNull(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(v) {
  const s = v === undefined || v === null ? '' : String(v);
  const trimmed = s.trim();
  return trimmed ? trimmed : null;
}

function usersFromRows(rows) {
  return rows
    .filter((r) => r && (r.id || r.email))
    .map((r) => ({
      id: String(r.id || '').trim(),
      email: normalizeEmail(r.email),
      passwordHash: String(r.passwordHash || r.password_hash || '').trim(),
      verified: coerceBool(r.verified),
      verifyToken: toStringOrNull(r.verifyToken),
      verifyExpires: toNumberOrNull(r.verifyExpires),
      createdAt: String(r.createdAt || r.created_at || '').trim() || null,
    }))
    .filter((u) => u.id && u.email && u.passwordHash);
}

/**
 * Migrate users from WebDAV Excel to PostgreSQL (one-time startup migration)
 * Checks if users already exist before migrating
 */
export async function migrateUsersFromWebdav() {
  try {
    // Check if we have users already in PostgreSQL
    const result = await query('SELECT COUNT(*) as c FROM users');
    if (result.rows[0].c > 0) {
      console.log('[postgres] Users already exist, skipping WebDAV migration');
      return;
    }

    const client = createClient('https://webdav.cloud.mail.ru/', {
      username: process.env.VK_CLOUD_EMAIL,
      password: process.env.VK_CLOUD_PASSWORD,
    });

    const USERS_FILE = '/RegDoc_Заявки/_USERS/users.xlsx';

    if (await client.exists(USERS_FILE)) {
      const buffer = await client.getFileContents(USERS_FILE);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const users = usersFromRows(rows);

      let migrated = 0;
      for (const u of users) {
        try {
          // Check if user already exists
          const exists = await emailExists(u.email);
          if (exists) continue;

          // Create user with hashed password
          const bcrypt = await import('bcryptjs');

          // Check if password is already hashed
          let passwordHash = u.passwordHash;
          if (!passwordHash.startsWith('$2')) {
            passwordHash = bcrypt.hashSync(passwordHash, 10);
          }

          await createUser({
            email: u.email,
            username: u.email.split('@')[0],
            passwordHash,
            role: 'user',
            verified: u.verified,
            verifyToken: u.verifyToken,
            verifyExpires: u.verifyExpires
          });
          migrated++;
        } catch (e) {
          console.error(`[migrate] Error migrating user ${u.email}:`, e.message);
        }
      }
      console.log(`[postgres] Migrated ${migrated} users from WebDAV Excel`);
    }
  } catch (e) {
    console.error('[postgres] Error in WebDAV migration:', e.message);
  }
}

/**
 * Legacy function - kept for compatibility
 * Loads users from PostgreSQL
 */
export async function loadStore() {
  const result = await query('SELECT * FROM users');
  const users = result.rows.map((r) => ({
    ...r,
    verified: r.verified === true || r.verified === 1 || r.verified === 'true',
    passwordHash: r.password_hash
  }));
  return { version: 1, users };
}

/**
 * Legacy function - kept for compatibility
 * For new user operations, use db-postgres.js directly
 */
export async function withUsersLock(fn) {
  const store = await loadStore();
  if (!Array.isArray(store.users)) store.users = [];

  await fn(store);

  // This is a no-op for PostgreSQL since we write directly
  // Keeping for backwards compatibility
  return true;
}