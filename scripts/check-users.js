import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkAndSetUsers() {
    try {
        console.log('================================================');
        console.log('🔍 Проверяем текущих пользователей в базе...');
        console.log('================================================');
        
        // Смотрим, кто сейчас есть в базе
        const currentUsers = await pool.query('SELECT id, username, email, role FROM users');
        if (currentUsers.rows.length === 0) {
            console.log('База данных пока абсолютно пуста.');
        } else {
            console.table(currentUsers.rows);
        }

        console.log('\n⚙️ Принудительно задаем пароли admin888 для admin и test...');
        
        // Хэшируем единый пароль для обеих учеток
        const passHash = await bcrypt.hash('admin888', 10);

        // SQL-запрос: если пользователя нет - создаст, если есть - обновит пароль и роль
        const query = `
            INSERT INTO users (username, email, password_hash, role)
            VALUES 
            ('admin', 'admin@regdoc.ru', $1, 'admin'),
            ('test', 'test@regdoc.ru', $1, 'user')
            ON CONFLICT (username) DO UPDATE 
            SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role;
        `;

        await pool.query(query, [passHash]);

        console.log('✅ Учетные записи успешно обновлены!');
        console.log('1. Логин: admin | Пароль: admin888 (Админ)');
        console.log('2. Логин: test  | Пароль: admin888 (Пользователь)');

        console.log('\n📋 Итоговое состояние базы данных:');
        const finalUsers = await pool.query('SELECT id, username, email, role FROM users');
        console.table(finalUsers.rows);

    } catch (err) {
        console.error('\n❌ ОШИБКА:', err.message);
    } finally {
        await pool.end();
        console.log('\nСкрипт завершен.');
    }
}

checkAndSetUsers();