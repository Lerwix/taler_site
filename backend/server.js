const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Раздаем статические файлы из корня проекта
app.use(express.static(path.join(__dirname, '..')));

// Дополнительный маршрут для файлов из frontend
app.use('/frontend', express.static(path.join(__dirname, '../frontend')));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Подключение к PostgreSQL (Railway)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==================== ЗАПУСК СУЩЕСТВУЮЩЕГО БОТА ====================
process.env.TELEGRAM_ADMIN_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
process.env.ADMIN_CHAT_IDS = process.env.TELEGRAM_ADMIN_CHAT_IDS;
process.env.RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL;

// Запускаем готового бота
require('./bot/adminBot');

console.log('🤖 Существующий Telegram бот подключен');
// ==================== КОНЕЦ БОТА ====================

async function initializeDatabase() {
    try {
        console.log('🔍 Проверяем базу данных...');
        
        await pool.query(`
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
        
        console.log('✅ Таблица "applications" создана/проверена');
        
        const countResult = await pool.query('SELECT COUNT(*) as count FROM applications');
        console.log(`📊 Заявок в базе: ${countResult.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Ошибка базы данных:', error.message);
    }
}

app.get('/api/status', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT NOW() as time');
        const countResult = await pool.query('SELECT COUNT(*) FROM applications');
        
        res.json({
            success: true,
            server: 'online',
            database: 'connected',
            telegram_bot: process.env.TELEGRAM_BOT_TOKEN ? 'active' : 'inactive',
            applications_count: parseInt(countResult.rows[0].count),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
});

app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT version()');
        res.json({
            success: true,
            message: '✅ База данных подключена',
            version: result.rows[0].version
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: '❌ Ошибка БД: ' + error.message
        });
    }
});

app.post('/api/application', async (req, res) => {
    console.log('📨 Получена новая заявка:', req.body);
    
    try {
        const {
            nickname, age, timezone, telegram, discord,
            role, experience, minecraft_exp, motivation,
            portfolio, time_available
        } = req.body;

        if (!nickname || !age || !telegram || !role) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля: nickname, age, telegram, role'
            });
        }

        if (!/^[A-Za-z0-9_]{5,32}$/.test(telegram)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный Telegram username'
            });
        }

        const result = await pool.query(
            `INSERT INTO applications (
                nickname, age, timezone, telegram, discord,
                role, experience, minecraft_exp, motivation,
                portfolio, time_available
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, nickname, telegram, role, created_at`,
            [
                nickname, 
                parseInt(age), 
                timezone || null, 
                telegram, 
                discord || null,
                role, 
                experience || null, 
                minecraft_exp || null, 
                motivation || null,
                portfolio || null, 
                time_available || null
            ]
        );

        const application = result.rows[0];
        console.log('✅ Заявка сохранена. ID:', application.id);

        res.status(201).json({
            success: true,
            message: '✅ Заявка успешно сохранена',
            data: {
                id: application.id,
                nickname: application.nickname,
                telegram: application.telegram,
                role: application.role,
                timestamp: application.created_at
            }
        });

    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера: ' + error.message
        });
    }
});

app.get('/api/applications', async (req, res) => {
    try {
        const { role, limit = 10, offset = 0 } = req.query;
        
        let query = 'SELECT * FROM applications';
        let params = [];
        
        if (role && role !== 'all') {
            query += ' WHERE role = $1';
            params.push(role);
        }
        
        query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            data: result.rows,
            total: result.rowCount
        });

    } catch (error) {
        console.error('❌ Ошибка получения заявок:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/count', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM applications');
        res.json({
            success: true,
            count: parseInt(result.rows[0].count)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/info', (req, res) => {
    res.json({ 
        success: true,
        message: '🚀 Сервер TALER работает!',
        database: process.env.DATABASE_URL ? 'Подключена' : 'Нет подключения',
        telegram_bot: process.env.TELEGRAM_BOT_TOKEN ? 'Активен' : 'Не настроен',
        endpoints: {
            submit_application: 'POST /api/application',
            get_status: 'GET /api/status',
            get_applications: 'GET /api/applications',
            test_db: 'GET /api/test-db',
            count: 'GET /api/count',
            info: 'GET /api/info'
        }
    });
});

app.listen(PORT, async () => {
    console.log(`
🚀 Сервер TALER запущен!
────────────────────────
📡 Порт: ${PORT}
🌐 URL: ${process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`}
🤖 Telegram бот: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Активен' : '❌ Не настроен'}
📊 API: /api/status, /api/application, /api/applications
────────────────────────
    `);
    
    await initializeDatabase();
});
