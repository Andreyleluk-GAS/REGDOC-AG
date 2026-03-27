import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let cachedDb = null;

export const getDb = async () => {
  if (cachedDb) return cachedDb;

  cachedDb = await open({
    filename: resolve(DATA_DIR, 'database.sqlite'),
    driver: sqlite3.Database
  });

  await cachedDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT,
      verified INTEGER,
      verifyToken TEXT,
      verifyExpires INTEGER,
      createdAt TEXT
    );

    CREATE TABLE IF NOT EXISTS requests (
      ID TEXT PRIMARY KEY,
      DATE TEXT,
      full_name TEXT,
      car_number TEXT,
      email TEXT,
      type_requests TEXT,
      type_PZ TEXT,
      type_PB TEXT,
      type_PZ_ready TEXT,
      type_PB_ready TEXT,
      hasFiles_PZ TEXT,
      hasFiles_PB TEXT,
      isVerified_PZ TEXT,
      isVerified_PB TEXT,
      verified_files TEXT,
      verified_sections TEXT,
      file_comments TEXT,
      folderName TEXT
    );
  `);

  try { await cachedDb.exec(`ALTER TABLE requests ADD COLUMN file_comments TEXT;`); } catch(e) {}

  return cachedDb;
};
