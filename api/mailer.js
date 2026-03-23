import nodemailer from 'nodemailer';

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * @param {string} to
 * @param {string} verifyToken
 */
export async function sendVerificationEmail(to, verifyToken) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const link = `${base}/?verify=${encodeURIComponent(verifyToken)}`;

  const transporter = createTransport();
  await transporter.sendMail({
    from: `"REGDOC" <${from}>`,
    to,
    subject: 'Подтвердите регистрацию в REGDOC',
    text: `Здравствуйте!\n\nПодтвердите email, перейдя по ссылке:\n${link}\n\nЕсли вы не регистрировались, проигнорируйте письмо.`,
    html: `<p>Здравствуйте!</p><p>Подтвердите email:</p><p><a href="${link}">${link}</a></p><p>Если вы не регистрировались, проигнорируйте письмо.</p>`,
  });
}
