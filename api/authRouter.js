import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { withUsersLock, loadStore } from './userStore.js';
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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(u) {
  return { id: u.id, email: u.email, verified: u.verified };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, getJwtSecret(), { expiresIn: JWT_EXPIRES });
}

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

    const smtpOn = isSmtpConfigured();
    const passwordHash = bcrypt.hashSync(password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = Date.now() + 48 * 60 * 60 * 1000;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await withUsersLock(async (store) => {
      if (store.users.some((u) => u.email === email)) {
        const err = new Error('exists');
        err.code = 'EXISTS';
        throw err;
      }
      const verified = !smtpOn;
      store.users.push({
        id,
        email,
        passwordHash,
        verified,
        verifyToken: smtpOn ? verifyToken : null,
        verifyExpires: smtpOn ? verifyExpires : null,
        createdAt: now,
      });
    });

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

    const user = { id, email, verified: true };
    const token = signToken(user);
    return res.json({ ok: true, needsVerification: false, token, user: publicUser(user) });
  } catch (e) {
    if (e.code === 'EXISTS') {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    }
    console.error(e);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/login', (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }

    const store = loadStore();
    const user = store.users.find((u) => u.email === email);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
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

router.post('/verify-email', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Нет токена' });

    let updatedUser = null;
    await withUsersLock(async (store) => {
      const u = store.users.find((x) => x.verifyToken && x.verifyToken === token);
      if (!u) {
        const err = new Error('bad');
        err.code = 'BAD_TOKEN';
        throw err;
      }
      if (u.verifyExpires && Date.now() > u.verifyExpires) {
        const err = new Error('exp');
        err.code = 'EXPIRED';
        throw err;
      }
      u.verified = true;
      u.verifyToken = null;
      u.verifyExpires = null;
      updatedUser = { id: u.id, email: u.email, verified: true };
    });

    const jwtTok = signToken(updatedUser);
    return res.json({ ok: true, message: 'Email подтверждён', token: jwtTok, user: updatedUser });
  } catch (e) {
    if (e.code === 'BAD_TOKEN') {
      return res.status(400).json({ error: 'Ссылка недействительна' });
    }
    if (e.code === 'EXPIRED') {
      return res.status(400).json({ error: 'Ссылка устарела — зарегистрируйтесь снова' });
    }
    console.error(e);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/me', (req, res) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  const token = h.slice(7);
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const store = loadStore();
    const user = store.users.find((u) => u.id === payload.sub);
    if (!user || !user.verified) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    return res.json({ user: publicUser(user) });
  } catch {
    return res.status(401).json({ error: 'Не авторизован' });
  }
});

export default router;
