import 'dotenv/config';
import { createClient } from 'webdav';
import * as XLSX from 'xlsx';
import { getDb } from './db.js';

let queue = Promise.resolve();

function getWebdavClient() {
  return createClient('https://webdav.cloud.mail.ru/', {
    username: process.env.VK_CLOUD_EMAIL,
    password: process.env.VK_CLOUD_PASSWORD,
  });
}

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
      passwordHash: String(r.passwordHash || '').trim(),
      verified: coerceBool(r.verified),
      verifyToken: toStringOrNull(r.verifyToken),
      verifyExpires: toNumberOrNull(r.verifyExpires),
      createdAt: String(r.createdAt || '').trim() || null,
    }))
    .filter((u) => u.id && u.email && u.passwordHash);
}

export async function migrateUsersFromWebdav() {
  const db = await getDb();
  const count = await db.get('SELECT COUNT(*) as c FROM users');
  if (count.c > 0) return; // Already migrated

  const client = getWebdavClient();
  const USERS_FILE = '/RegDoc_Заявки/_USERS/users.xlsx';

  try {
    if (await client.exists(USERS_FILE)) {
      const buffer = await client.getFileContents(USERS_FILE);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const users = usersFromRows(rows);

      for (const u of users) {
        await db.run(
          'INSERT OR IGNORE INTO users (id, email, passwordHash, verified, verifyToken, verifyExpires, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [u.id, u.email, u.passwordHash, u.verified ? 1 : 0, u.verifyToken, u.verifyExpires, u.createdAt]
        );
      }
      console.log(`[db] Migrated ${users.length} users from WebDAV`);
    }
  } catch (e) {
    console.error('[db] Error migrating users:', e.message);
  }
}

export async function loadStore() {
  const db = await getDb();
  const rows = await db.all('SELECT * FROM users');
  const users = rows.map((r) => ({
    ...r,
    verified: r.verified === 1,
  }));
  return { version: 1, users };
}

export async function withUsersLock(fn) {
  const run = async () => {
    const store = await loadStore();
    if (!Array.isArray(store.users)) store.users = [];

    await fn(store);

    const db = await getDb();
    
    // Вставка/обновление мутированных записей
    for (const u of store.users) {
      await db.run(`
        INSERT INTO users (id, email, passwordHash, verified, verifyToken, verifyExpires, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email=excluded.email,
          passwordHash=excluded.passwordHash,
          verified=excluded.verified,
          verifyToken=excluded.verifyToken,
          verifyExpires=excluded.verifyExpires,
          createdAt=excluded.createdAt
      `, [u.id, u.email, u.passwordHash, u.verified ? 1 : 0, u.verifyToken, u.verifyExpires, u.createdAt]);
    }

    return true;
  };

  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}