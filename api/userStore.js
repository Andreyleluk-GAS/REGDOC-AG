import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.USERS_DATA_DIR || path.join(__dirname, '..', 'data');
const filePath = path.join(dataDir, 'users.json');

let queue = Promise.resolve();

function ensureFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, users: [] }, null, 2), 'utf8');
  }
}

export function loadStore() {
  ensureFile();
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return { version: 1, users: [] };
  }
}

function saveStore(store) {
  ensureFile();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * @param {(store: { version: number, users: object[] }) => Promise<unknown>} fn
 */
export async function withUsersLock(fn) {
  const run = async () => {
    const store = loadStore();
    if (!Array.isArray(store.users)) store.users = [];
    try {
      const result = await fn(store);
      saveStore(store);
      return result;
    } catch (e) {
      throw e;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
