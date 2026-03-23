import 'dotenv/config';
import { createClient } from 'webdav';
import * as XLSX from 'xlsx';

let queue = Promise.resolve();

const USERS_ROOT = '/RegDoc_Заявки/_USERS';
const USERS_FILE = `${USERS_ROOT}/users.xlsx`;
// НОВОЕ: Путь к файлу заявок
const REQUESTS_FILE = `${USERS_ROOT}/requests.xlsx`;
let requestsQueue = Promise.resolve();

function getWebdavClient() {
  return createClient('https://webdav.cloud.mail.ru/', {
    username: process.env.VK_CLOUD_EMAIL,
    password: process.env.VK_CLOUD_PASSWORD,
  });
}

function defaultStore() {
  return {
    version: 1,
    users: [],
  };
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

function storeToSheetData(store) {
  const header = [
    'id',
    'email',
    'passwordHash',
    'verified',
    'verifyToken',
    'verifyExpires',
    'createdAt',
  ];

  const rows = (store.users || []).map((u) => ({
    id: u.id,
    email: u.email,
    passwordHash: u.passwordHash,
    verified: Boolean(u.verified),
    verifyToken: u.verifyToken || '',
    verifyExpires: u.verifyExpires ?? '',
    createdAt: u.createdAt || '',
  }));

  return { header, rows };
}

async function ensureUsersXlsx() {
  const client = getWebdavClient();
  if (!(await client.exists(USERS_ROOT))) {
    await client.createDirectory(USERS_ROOT);
  }
  if (!(await client.exists(USERS_FILE))) {
    const store = defaultStore();
    const { header, rows } = storeToSheetData(store);
    const ws = XLSX.utils.json_to_sheet(rows, { header, skipHeader: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'users');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    await client.putFileContents(USERS_FILE, buf);
  }
}

export async function loadStore() {
  await ensureUsersXlsx();
  const client = getWebdavClient();
  const buffer = await client.getFileContents(USERS_FILE);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const users = usersFromRows(rows);
  return { version: 1, users };
}

function saveStoreToWebdav(store) {
  const { header, rows } = storeToSheetData(store);
  const ws = XLSX.utils.json_to_sheet(rows, { header, skipHeader: false });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'users');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function withUsersLock(fn) {
  const run = async () => {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const store = await loadStore();
      if (!Array.isArray(store.users)) store.users = [];

      await fn(store);

      const client = getWebdavClient();
      const buf = saveStoreToWebdav(store);
      try {
        await client.putFileContents(USERS_FILE, buf);
        return true;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Не удалось обновить users.xlsx');
  };

  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// НОВОЕ: Функции для работы с реестром заявок requests.xlsx
export async function loadRequests() {
  const client = getWebdavClient();
  if (!(await client.exists(REQUESTS_FILE))) return [];
  try {
    const buffer = await client.getFileContents(REQUESTS_FILE);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (e) {
    return [];
  }
}

async function saveRequestsToWebdav(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'requests');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function withRequestsLock(fn) {
  const run = async () => {
    const requests = await loadRequests();
    await fn(requests);
    const client = getWebdavClient();
    const buf = await saveRequestsToWebdav(requests);
    await client.putFileContents(REQUESTS_FILE, buf);
  };
  const p = requestsQueue.then(run, run);
  requestsQueue = p.catch(() => {});
  return p;
}