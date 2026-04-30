import { getDb } from './db.js';
import { normalizePlate, normalizeName } from './utils.js';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

let memCache = null;
let writeQueue = Promise.resolve();

const __dirname = dirname(fileURLToPath(import.meta.url));

export function isDuplicate(rows, row) {
  const plate = normalizePlate(row.car_number);
  const name = normalizeName(row.full_name);
  const type = row.type_requests || '';

  return rows.some(r =>
    normalizePlate(r.car_number) === plate &&
    normalizeName(r.full_name) === name &&
    (r.type_requests || '') === type
  );
}

export function getNextId(rows) {
  const ids = rows.map(r => parseInt(r.ID) || 0).filter(n => !isNaN(n));
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return String(max + 1).padStart(4, '0');
}

export async function loadRequests() {
  if (memCache !== null) return [...memCache];
  const db = await getDb();
  const rows = await db.all('SELECT * FROM requests ORDER BY CAST(ID AS INTEGER) ASC');
  memCache = rows.map(r => ({
    ...r,
    verified_files: r.verified_files ? JSON.parse(r.verified_files) : {},
    verified_sections: r.verified_sections ? JSON.parse(r.verified_sections) : {},
    file_comments: r.file_comments ? JSON.parse(r.file_comments) : {}
  }));
  return [...memCache];
}

export async function withRequestsLock(fn) {
  const run = async () => {
    const rows = await loadRequests();
    await fn(rows);

    const db = await getDb();
    for (const r of rows) {
      if (!r.ID) r.ID = getNextId(rows);
      await db.run(`
        INSERT INTO requests (ID, DATE, full_name, car_number, email, type_requests, type_PZ, type_PB, type_PZ_ready, type_PB_ready, hasFiles_PZ, hasFiles_PB, isVerified_PZ, isVerified_PB, verified_files, verified_sections, file_comments, folderName, isPzAccepted, isPbAccepted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ID) DO UPDATE SET
          DATE=excluded.DATE,
          full_name=excluded.full_name,
          car_number=excluded.car_number,
          email=excluded.email,
          type_requests=excluded.type_requests,
          type_PZ=excluded.type_PZ,
          type_PB=excluded.type_PB,
          type_PZ_ready=excluded.type_PZ_ready,
          type_PB_ready=excluded.type_PB_ready,
          hasFiles_PZ=excluded.hasFiles_PZ,
          hasFiles_PB=excluded.hasFiles_PB,
          isVerified_PZ=excluded.isVerified_PZ,
          isVerified_PB=excluded.isVerified_PB,
          verified_files=excluded.verified_files,
          verified_sections=excluded.verified_sections,
          file_comments=excluded.file_comments,
          folderName=excluded.folderName,
          isPzAccepted=excluded.isPzAccepted,
          isPbAccepted=excluded.isPbAccepted
      `, [
        r.ID, r.DATE, r.full_name, r.car_number, r.email, r.type_requests, r.type_PZ, r.type_PB, r.type_PZ_ready, r.type_PB_ready, r.hasFiles_PZ, r.hasFiles_PB, r.isVerified_PZ, r.isVerified_PB,
        r.verified_files ? JSON.stringify(r.verified_files) : null,
        r.verified_sections ? JSON.stringify(r.verified_sections) : null,
        r.file_comments ? JSON.stringify(r.file_comments) : null,
        r.folderName,
        r.isPzAccepted || 'no',
        r.isPbAccepted || 'no'
      ]);
    }

    const currentIds = rows.map(r => String(r.ID));
    const dbRows = await db.all('SELECT ID FROM requests');
    for (const dbRow of dbRows) {
      if (!currentIds.includes(String(dbRow.ID))) {
        await db.run('DELETE FROM requests WHERE ID = ?', [dbRow.ID]);
      }
    }

    memCache = rows;
    return rows;
  };

  const p = writeQueue.then(run, run);
  writeQueue = p.catch(() => { });
  return p;
}

export function invalidateMemCache() {
  memCache = null;
}

export async function migrateLocalJsonToSQLite() {
  const db = await getDb();
  const count = await db.get('SELECT COUNT(*) as c FROM requests');
  if (count.c > 0) return;

  const STORE_FILE = resolve(__dirname, '../data/requests.json');
  if (!existsSync(STORE_FILE)) return;

  try {
    const raw = await readFile(STORE_FILE, 'utf8');
    const rows = JSON.parse(raw);
    for (const r of rows) {
      await db.run(`INSERT OR IGNORE INTO requests (ID, DATE, full_name, car_number, email, type_requests, type_PZ, type_PB, type_PZ_ready, type_PB_ready, hasFiles_PZ, hasFiles_PB, isVerified_PZ, isVerified_PB, verified_files, verified_sections, file_comments, folderName) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        r.ID || getNextId(rows.filter(x => x.ID)),
        r.DATE, r.full_name, r.car_number, r.email, r.type_requests, r.type_PZ, r.type_PB, r.type_PZ_ready, r.type_PB_ready, r.hasFiles_PZ, r.hasFiles_PB, r.isVerified_PZ, r.isVerified_PB,
        r.verified_files ? JSON.stringify(r.verified_files) : null,
        r.verified_sections ? JSON.stringify(r.verified_sections) : null,
        r.file_comments ? JSON.stringify(r.file_comments) : null,
        r.folderName
      ]);
    }
    console.log(`[db] Migrated ${rows.length} requests from JSON to SQLite`);
  } catch (e) {
    console.error('[db] JSON migration error', e);
  }
}
