import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

// Create connection pool from DATABASE_URL environment variable
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.query('SELECT 1').catch(err => {
    console.error('[postgres] Initial connection test failed:', err.message);
});

/**
 * Execute a query with parameters
 */
export async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('[postgres] Executed query', { text: text.substring(0, 100), duration, rows: res.rowCount });
    return res;
}

export async function getClient() {
    return pool.connect();
}

/**
 * Initialize the users table in PostgreSQL
 */
export async function initUsersTable() {
    console.log('[postgres] Initializing users table...');
    await query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(255) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'user',
      verified BOOLEAN DEFAULT false,
      verify_token VARCHAR(255),
      verify_expires BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    console.log('[postgres] Users table initialized');
}

/**
 * Find user by email
 */
export async function findUserByEmail(email) {
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return result.rows[0] || null;
}

/**
 * Find user by username OR email (universal login lookup)
 */
export async function findUserByLogin(login) {
    const normalized = String(login || '').trim().toLowerCase();
    const result = await query(
        'SELECT * FROM users WHERE username = $1 OR email = $1',
        [normalized]
    );
    return result.rows[0] || null;
}

/**
 * Find user by ID
 */
export async function findUserById(id) {
    const result = await query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
}

/**
 * Create a new user
 */
export async function createUser({ email, username, passwordHash, role = 'user', verified = false, verifyToken = null, verifyExpires = null }) {
    const result = await query(
        `INSERT INTO users (email, username, password_hash, role, verified, verify_token, verify_expires)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
        [email.toLowerCase(), username, passwordHash, role, verified, verifyToken, verifyExpires]
    );
    return result.rows[0];
}

/**
 * Update user verification status
 */
export async function verifyUserByToken(verifyToken) {
    const result = await query(
        `UPDATE users SET verified = true, verify_token = NULL, verify_expires = NULL
     WHERE verify_token = $1 AND verify_expires > $2
     RETURNING *`,
        [verifyToken, Date.now()]
    );
    return result.rows[0] || null;
}

/**
 * Check if email exists
 */
export async function emailExists(email) {
    const result = await query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()]);
    return result.rows.length > 0;
}

export async function getAllUsers() {
    const result = await query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows;
}

export async function updateUser(id, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;
    for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        fields.push(`${dbKey} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
    }
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    const result = await query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
    );
    return result.rows[0] || null;
}

export async function closePool() {
    await pool.end();
}

export default pool;
