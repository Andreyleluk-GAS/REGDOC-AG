import pg from 'pg';
const { Pool } = pg;

// Create connection pool from DATABASE_URL environment variable
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20, // Max connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test connection on startup (non-blocking)
pool.query('SELECT 1').catch(err => {
    console.error('[postgres] Initial connection test failed:', err.message);
});

/**
 * Execute a query with parameters
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
export async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('[postgres] Executed query', { text: text.substring(0, 100), duration, rows: res.rowCount });
    return res;
}

/**
 * Get a single client from the pool for transactions
 * @returns {Promise<Object>} Pool client
 */
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

    // Create index on email for faster lookups
    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

    console.log('[postgres] Users table initialized');
}

/**
 * Find user by email
 * @param {string} email 
 * @returns {Promise<Object|null>}
 */
export async function findUserByEmail(email) {
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return result.rows[0] || null;
}

/**
 * Find user by ID
 * @param {string} id 
 * @returns {Promise<Object|null>}
 */
export async function findUserById(id) {
    const result = await query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
}

/**
 * Create a new user
 * @param {Object} userData 
 * @returns {Promise<Object>} Created user
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
 * @param {string} verifyToken 
 * @returns {Promise<Object|null>}
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
 * @param {string} email 
 * @returns {Promise<boolean>}
 */
export async function emailExists(email) {
    const result = await query('SELECT 1 FROM users WHERE email = $1', [email.toLowerCase()]);
    return result.rows.length > 0;
}

/**
 * Get all users (for admin purposes)
 * @returns {Promise<Array>}
 */
export async function getAllUsers() {
    const result = await query('SELECT * FROM users ORDER BY created_at DESC');
    return result.rows;
}

/**
 * Update user by id
 * @param {string} id 
 * @param {Object} updates 
 * @returns {Promise<Object|null>}
 */
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

/**
 * Close the pool (for graceful shutdown)
 */
export async function closePool() {
    await pool.end();
}

export default pool;