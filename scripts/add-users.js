import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addUsers() {
    try {
        console.log('Хэшируем пароли...');
        // Хэшируем новые пароли
        const adminPass = await bcrypt.hash('admi888', 10);
        const userPass = await bcrypt.hash('admin888', 10);

        const query = `
            INSERT INTO users (username, email, password_hash, role)
            VALUES 
            ($1, $2, $3, $4),
            ($5, $6, $7, $8)
            ON CONFLICT (username) DO UPDATE 
            SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role;
        `;

        console.log('Добавляем пользователей в базу...');
        await pool.query(query, [
            'admin', 'admin@regdoc.ru', adminPass, 'admin',
            'test', 'test@regdoc.ru', userPass, 'user'
        ]);

        console.log('✅ Учетные записи успешно обновлены!');
        console.log('1. Логин: admin | Пароль: admi888 (Админ)');
        console.log('2. Логин: test  | Пароль: admin888 (Пользователь)');
    } catch (err) {
        console.error('❌ Ошибка:', err);
    } finally {
        await pool.end();
    }
}

addUsers();