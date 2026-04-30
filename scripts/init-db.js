/**
 * One-time script to create the users table in PostgreSQL
 *
 * Usage:
 *   node scripts/init-db.js
 *
 * Prerequisites:
 *   1. Set up PostgreSQL database (Neon on Vercel or local Docker)
 *   2. Add DATABASE_URL to .env
 *   3. Run: npm install
 */

import 'dotenv/config';
import { initUsersTable } from '../api/db-postgres.js';

async function init() {
    console.log('===========================================');
    console.log('  REGDOC: Initialize PostgreSQL Database');
    console.log('===========================================');
    console.log();
    console.log('  Database URL:', process.env.DATABASE_URL
        ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')
        : '❌ НЕ ЗАДАНА (проверь .env)');
    console.log();

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL не найдена в .env');
        console.error('   Добавьте строку подключения к PostgreSQL');
        process.exit(1);
    }

    try {
        await initUsersTable();
        console.log();
        console.log('===========================================');
        console.log('  ✅ Таблица users готова!');
        console.log('===========================================');
        console.log();
        console.log('  Следующий шаг — перенести старых пользователей:');
        console.log('  node scripts/migrate-users.js');
        console.log();
    } catch (e) {
        console.error();
        console.error('===========================================');
        console.error('  ❌ ОШИБКА при создании таблицы');
        console.error('===========================================');
        console.error();
        console.error('🔥 Подробности:', e.message);
        console.error();
        console.error('  Проверьте:');
        console.error('  1. DATABASE_URL корректна');
        console.error('  2. БД Neon / PostgreSQL доступна');
        console.error('  3. SSL настроен (Neon требует rejectUnauthorized: false)');
        process.exit(1);
    }
}

init();
