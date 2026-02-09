const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== КОНФИГУРАЦИЯ ====================

// 1. Загружаем .env только в разработке
if (process.env.NODE_ENV !== 'production') {
    try {
        require('dotenv').config();
        console.log('🔧 Загружен .env файл (только для разработки)');
    } catch (e) {
        console.log('ℹ️ .env файл не найден, используем переменные окружения');
    }
}

// 2. Проверяем обязательные переменные окружения
const requiredEnvVars = ['DATABASE_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Отсутствуют обязательные переменные окружения:');
    missingVars.forEach(varName => {
        console.error(`   - ${varName}`);
    });
    
    console.log('\n🔧 РЕШЕНИЕ:');
    console.log('1. Для Railway: добавьте переменные в раздел Variables');
    console.log('2. Для локальной разработки: создайте файл .env');
    console.log('3. Убедитесь, что переменные правильно названы');
    
    process.exit(1);
}

console.log('✅ Все обязательные переменные окружения присутствуют');

// ==================== БАЗА ДАННЫХ ====================

// 3. Безопасная конфигурация подключения к БД
// НИКАКИХ паролей в коде - только переменные окружения!
let pool;
try {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL, // ← пароль только здесь!
        ssl: process.env.NODE_ENV === 'production' 
            ? { 
                rejectUnauthorized: false,
                ca: process.env.DB_SSL_CA // Опционально: SSL сертификат
              } 
            : false,
        max: process.env.DB_MAX_CONNECTIONS || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
    
    console.log('🔧 Конфигурация БД загружена из переменных окружения');
    
    // Проверяем что в DATABASE_URL нет пароля в логах
    const dbUrl = process.env.DATABASE_URL || '';
    if (dbUrl.includes('@')) {
        const safeUrl = dbUrl.replace(/:[^:@]+@/, ':***@');
        console.log(`📡 Подключаемся к: ${safeUrl}`);
    }
    
} catch (error) {
    console.error('❌ Ошибка создания пула подключений:', error.message);
    process.exit(1);
}

// ==================== МИДЛВЭРЫ ====================

app.use(compression());
app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Статические файлы
app.use(express.static(path.join(__dirname, '..')));
app.use('/frontend', express.static(path.join(__dirname, '../frontend')));

// ==================== ПРОВЕРКА ПОДКЛЮЧЕНИЯ К БД ====================

async function testDatabaseConnection() {
    let client;
    try {
        console.log('🔍 Проверяем подключение к базе данных...');
        client = await pool.connect();
        
        const result = await client.query('SELECT version(), NOW() as time');
        console.log('✅ База данных подключена успешно!');
        console.log(`📊 PostgreSQL: ${result.rows[0].version.split(',')[0]}`);
        console.log(`🕐 Время сервера БД: ${result.rows[0].time}`);
        
        return true;
    } catch (error) {
        console.error('❌ Ошибка подключения к базе данных:', error.message);
        console.log('🔧 Возможные причины:');
        console.log('1. Неправильная DATABASE_URL в Railway Variables');
        console.log('2. База данных не запущена');
        console.log('3. Проблемы с сетью');
        
        return false;
    } finally {
        if (client) client.release();
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ БД ====================

async function initializeDatabase() {
    let client;
    try {
        console.log('🔧 Инициализируем базу данных...');
        client = await pool.connect();
        
        // Создаем таблицу
        await client.query(`
            CREATE TABLE IF NOT EXISTS applications (
                id SERIAL PRIMARY KEY,
                nickname VARCHAR(100) NOT NULL,
                age INTEGER NOT NULL,
                timezone VARCHAR(50),
                telegram VARCHAR(100) NOT NULL,
                discord VARCHAR(100),
                role VARCHAR(50) NOT NULL,
                experience TEXT,
                minecraft_exp TEXT,
                motivation TEXT,
                portfolio TEXT,
                time_available VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW(),
                status VARCHAR(20) DEFAULT 'new'
            )
        `);
        
        // Создаем индексы
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_applications_created_at 
            ON applications(created_at DESC)
        `);
        
        // Проверяем количество записей
        const countResult = await client.query('SELECT COUNT(*) FROM applications');
        console.log(`✅ База данных готова. Записей: ${countResult.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error.message);
    } finally {
        if (client) client.release();
    }
}

// ==================== TELEGRAM БОТ ====================

function initializeTelegramBot() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.log('🤖 Telegram бот: токен не указан, пропускаем');
        return;
    }
    
    try {
        // Устанавливаем переменные для бота из env
        process.env.TELEGRAM_ADMIN_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        process.env.ADMIN_CHAT_IDS = process.env.TELEGRAM_ADMIN_CHAT_IDS || '';
        process.env.RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`;
        
        require('./bot/adminBot');
        console.log('🤖 Telegram бот инициализирован');
    } catch (error) {
        console.error('❌ Ошибка инициализации Telegram бота:', error.message);
    }
}

// ==================== API МАРШРУТЫ ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as db_time');
        res.json({
            success: true,
            status: 'healthy',
            server_time: new Date().toISOString(),
            db_time: result.rows[0].db_time,
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            status: 'unhealthy',
            error: 'Database connection failed'
        });
    }
});

app.post('/api/application', async (req, res) => {
    // ... ваш существующий код без изменений ...
    // Убедитесь, что используете только pool.query()
});

app.get('/api/applications', async (req, res) => {
    // ... ваш существующий код ...
});

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGTERM', async () => {
    console.log('🔄 Получен SIGTERM, завершаем работу...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Получен SIGINT, завершаем работу...');
    await pool.end();
    process.exit(0);
});

// ==================== ЗАПУСК СЕРВЕРА ====================

async function startServer() {
    try {
        // 1. Проверяем подключение к БД
        const dbConnected = await testDatabaseConnection();
        if (!dbConnected) {
            console.error('❌ Не удалось подключиться к БД. Сервер не запущен.');
            process.exit(1);
        }
        
        // 2. Инициализируем БД
        await initializeDatabase();
        
        // 3. Запускаем сервер
        app.listen(PORT, () => {
            console.log(`
🚀 Сервер TALER запущен (БЕЗОПАСНАЯ ВЕРСИЯ)
─────────────────────────────────────────
📡 Порт: ${PORT}
🌐 URL: ${process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`}
📊 База данных: ✅ Подключена
🤖 Telegram бот: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Настроен' : '❌ Не настроен'}
🛡️ Безопасность: ✅ Переменные окружения
─────────────────────────────────────────
            `);
            
            // 4. Запускаем бота асинхронно
            setTimeout(initializeTelegramBot, 1000);
        });
        
    } catch (error) {
        console.error('❌ Критическая ошибка при запуске:', error);
        process.exit(1);
    }
}

startServer();

module.exports = { app, pool }; // Для тестирования
