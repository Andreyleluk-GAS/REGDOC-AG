import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  findUserByEmail,
  findUserById,
  createUser,
  verifyUserByToken,
  emailExists,
  initUsersTable
} from './db-postgres.js';
import { isSmtpConfigured, sendVerificationEmail } from './mailer.js';

const router = Router();

const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') {
    console.error('REGDOC: задайте JWT_SECRET не короче 16 символов');
  }
  return s || 'dev-only-change-JWT_SECRET-in-env';
}

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('REGDOC: задайте JWT_SECRET в окружении');
}

// Initialize users table on startup (non-blocking)
initUsersTable().catch(e => console.error('[auth] Failed to init users table:', e.message));

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    verified: u.verified,
    role: u.role || 'user'
  };
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role || 'user' },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES }
  );
}

// ========== ASYNC BACKUP TO EXCEL (NON-BLOCKING) ==========
// This runs AFTER successful registration, does NOT block the response
async function backupUserToExcel(user) {
  try {
    const { createClient } = await import('webdav');
    const XLSX = await import('xlsx');

    const client = createClient('https://webdav.cloud.mail.ru/', {
      username: process.env.VK_CLOUD_EMAIL,
      password: process.env.VK_CLOUD_PASSWORD,
    });

    const USERS_FILE = '/RegDoc_Заявки/_USERS/users.xlsx';

    // Check if file exists
    let existingData = [];
    if (await client.exists(USERS_FILE)) {
      try {
        const buffer = await client.getFileContents(USERS_FILE, { format: 'binary' });
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        existingData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      } catch (e) {
        console.log('[backup-excel] Failed to read existing file:', e.message);
      }
    }

    // Add new user to data
    const newRow = {
      id: user.id,
      email: user.email,
      username: user.username || '',
      passwordHash: user.password_hash,
      verified: user.verified ? 'TRUE' : 'FALSE',
      verifyToken: user.verify_token || '',
      verifyExpires: user.verify_expires || '',
      createdAt: user.created_at
    };

    // Check for duplicates
    if (!existingData.some(r => r.email === user.email)) {
      existingData.push(newRow);
    }

    // Write back to WebDAV
    const ws = XLSX.utils.json_to_sheet(existingData);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, ws, 'Users');
    const newBuffer = XLSX.write(newWb, { type: 'buffer', bookType: 'xlsx' });

    await client.putFileContents(USERS_FILE, newBuffer);
    console.log('[backup-excel] User backed up successfully:', user.email);
  } catch (e) {
    // NON-BLOCKING: Log but don't fail
    console.error('[backup-excel] Failed to backup user:', e.message);
  }
}

// ========== REGISTER ==========
router.post('/register', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Укажите корректный email' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль не короче 8 символов' });
    }

    // Check if email already exists in PostgreSQL
    const exists = await emailExists(email);
    if (exists) {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    }

    const smtpOn = isSmtpConfigured();
    const passwordHash = bcrypt.hashSync(password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = Date.now() + 48 * 60 * 60 * 1000;
    const verified = !smtpOn;

    // Create user in PostgreSQL
    const user = await createUser({
      email,
      username: email.split('@')[0], // Default username from email
      passwordHash,
      role: 'user',
      verified,
      verifyToken: smtpOn ? verifyToken : null,
      verifyExpires: smtpOn ? verifyExpires : null
    });

    // NON-BLOCKING: Backup to Excel AFTER successful DB insert
    // This ensures registration succeeds even if backup fails
    backupUserToExcel(user);

    if (smtpOn) {
      try {
        await sendVerificationEmail(email, verifyToken);
      } catch (e) {
        console.error('REGDOC SMTP:', e.message);
        return res.status(500).json({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
      }
      return res.json({
        ok: true,
        needsVerification: true,
        message: 'На почту отправлена ссылка для подтверждения.',
      });
    }

    const token = signToken(user);
    return res.json({ ok: true, needsVerification: false, token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========== LOGIN ==========
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }

    // Look up user ONLY in PostgreSQL
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Verify password using bcrypt
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    if (!user.verified) {
      return res.status(403).json({
        error: 'Подтвердите email по ссылке из письма',
        needsVerification: true,
      });
    }

    const token = signToken(user);
    return res.json({ ok: true, token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========== VERIFY EMAIL ==========
router.post('/verify-email', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Нет токена' });

    const user = await verifyUserByToken(token);
    if (!user) {
      // Token not found or expired
      return res.status(400).json({ error: 'Ссылка недействительна или устарела' });
    }

    const jwtTok = signToken(user);
    return res.json({
      ok: true,
      message: 'Email подтверждён',
      token: jwtTok,
      user: publicUser(user)
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========== ME (GET CURRENT USER) ==========
router.get('/me', async (req, res) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  const token = h.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = await findUserById(payload.sub);
    if (!user || !user.verified) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    return res.json({ user: publicUser(user) });
  } catch {
    return res.status(401).json({ error: 'Не авторизован' });
  }
});

export default router;