const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// === ВАЖНО: ОСТАВЬТЕ ТОЛЬКО ЭТОТ pool! ===
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// === УДАЛИТЬ ЭТОТ ВТОРОЙ pool! ===
// const pool = new Pool({
//     host: process.env.DB_HOST,
//     port: process.env.DB_PORT,
//     database: process.env.DB_NAME,
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
// });

// Проверка подключения к БД
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
    } else {
        console.log('✅ Подключено к PostgreSQL');
        release();
    }
});

// 1. Главная страница
app.get('/', (req, res) => {
    res.json({ 
        success: true,
        message: '🚀 Сервер TALER работает!',
        endpoints: {
            submit_application: 'POST /api/application',
            get_status: 'GET /api/status',
            get_applications: 'GET /api/applications?role=[role]'
        }
    });
});

// 2. API для сохранения заявок
app.post('/api/application', async (req, res) => {
    console.log('📨 Получена новая заявка');
    
    try {
        const {
            nickname, age, timezone, telegram, discord,
            role, experience, minecraft_exp, motivation,
            portfolio, time_available
        } = req.body;

        console.log('Данные:', { nickname, age, telegram, role });

        // Валидация
        if (!nickname || !age || !telegram || !role) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля'
            });
        }

        // Проверка Telegram username
        if (!/^[A-Za-z0-9_]{5,32}$/.test(telegram)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный Telegram username'
            });
        }

        // Сохранение в БД
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
                timezone, 
                telegram, 
                discord || null,
                role, 
                experience, 
                minecraft_exp, 
                motivation,
                portfolio || null, 
                time_available
            ]
        );

        const application = result.rows[0];
        console.log('✅ Заявка сохранена в БД. ID:', application.id);

        res.status(201).json({
            success: true,
            message: '✅ Заявка успешно сохранена в базе данных',
            data: {
                id: application.id,
                nickname: application.nickname,
                telegram: application.telegram,
                role: application.role,
                timestamp: application.created_at
            }
        });

    } catch (error) {
        console.error('❌ Ошибка сохранения заявки:', error);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера: ' + error.message
        });
    }
});

// 3. API для получения заявок
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

// 4. Статус сервера
app.get('/api/status', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT NOW()');
        const appsCount = await pool.query('SELECT COUNT(*) FROM applications');
        
        res.json({
            success: true,
            server: 'online',
            database: 'connected',
            timestamp: dbResult.rows[0].now,
            applications: parseInt(appsCount.rows[0].count),
            port: PORT
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database connection failed: ' + error.message
        });
    }
});

// 5. Тест БД
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT version()');
        res.json({
            success: true,
            message: 'База данных подключена',
            version: result.rows[0].version
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`
🚀 Сервер TALER запущен!
────────────────────────
📡 Порт: ${PORT}
🌐 URL: http://localhost:${PORT}
📊 API: http://localhost:${PORT}/api
🔍 Статус: http://localhost:${PORT}/api/status
────────────────────────
    `);
});
