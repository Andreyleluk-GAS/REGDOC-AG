// Загружаем переменные окружения современным способом
import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

console.log('================================================');
console.log('REGDOC: Инициализация базы данных PostgreSQL');
console.log('================================================\n');

// Проверяем, есть ли ссылка на базу данных
if (!process.env.DATABASE_URL) {
    console.error('❌ ОШИБКА: Переменная DATABASE_URL не найдена в файле .env');
    console.error('Пожалуйста, добавьте строку подключения к вашей базе данных Neon.');
    process.exit(1);
}

// Создаем пул соединений с базой данных
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function initializeDB() {
    try {
        console.log(`Подключение к БД: ${process.env.DATABASE_URL.split('@')[1].split('/')[0]}...`);
        
        // Тестовый запрос для проверки соединения
        await pool.query('SELECT NOW()');
        console.log('✅ Успешное подключение к PostgreSQL!\n');

        console.log('Создание таблицы users...');

        // SQL-запрос на создание таблицы
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'user',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;

        // Выполняем запрос
        await pool.query(createTableQuery);
        console.log('✅ Таблица users успешно создана (или уже существует).');

        // Создаем тестового админа
        const adminPasswordHash = await bcrypt.hash('admin123', 10);
        
        const createAdminQuery = `
            INSERT INTO users (username, email, password_hash, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (username) DO NOTHING;
        `;
        
        await pool.query(createAdminQuery, ['admin', 'admin@regdoc.ru', adminPasswordHash, 'admin']);
        console.log('✅ Тестовый пользователь admin (пароль: admin123) добавлен.');

    } catch (err) {
        console.error('\n❌ ОШИБКА ПРИ ИНИЦИАЛИЗАЦИИ БД:');
        console.error(err.message);
        
        if (err.message.includes('password authentication failed')) {
             console.error('-> Проверьте логин или пароль в DATABASE_URL.');
        } else if (err.message.includes('getaddrinfo ENOTFOUND')) {
             console.error('-> Сервер базы данных не найден. Проверьте хост в DATABASE_URL.');
        }
    } finally {
        // Обязательно закрываем пул соединений
        await pool.end();
        console.log('\nСкрипт завершен.');
    }
}

initializeDB();