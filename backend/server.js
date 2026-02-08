const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Раздаем статические файлы фронтенда
app.use(express.static(path.join(__dirname, '../frontend')));

// Подключение к PostgreSQL (Railway дает DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Автоматическое создание таблицы при запуске
async function initializeDatabase() {
    try {
        console.log('🔍 Проверяем подключение к базе данных...');
        
        // Создаем таблицу если её нет
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
        
        // Проверяем что всё работает
        const testQuery = await pool.query('SELECT COUNT(*) as count FROM applications');
        console.log(`📊 Заявок в базе: ${testQuery.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Ошибка при работе с базой данных:', error.message);
    }
}

// ========== МАРШРУТЫ ==========

// Главная страница - ОТДАЕМ HTML (убрали дублирование)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Проверка статуса сервера и БД
app.get('/api/status', async (req, res) => {
    try {
        // Проверяем подключение к БД
        const dbResult = await pool.query('SELECT NOW() as time');
        const countResult = await pool.query('SELECT COUNT(*) FROM applications');
        
        res.json({
            success: true,
            server: 'online',
            database: 'connected',
            timestamp: dbResult.rows[0].time,
            applications_count: parseInt(countResult.rows[0].count),
            port: PORT
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Тест подключения к БД
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

// API для сохранения заявок
app.post('/api/application', async (req, res) => {
    console.log('📨 Получена новая заявка:', req.body);
    
    try {
        const {
            nickname, age, timezone, telegram, discord,
            role, experience, minecraft_exp, motivation,
            portfolio, time_available
        } = req.body;

        // Валидация обязательных полей
        if (!nickname || !age || !telegram || !role) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля: nickname, age, telegram, role'
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

// API для получения заявок
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

// Информация о сервере (альтернатива для JSON)
app.get('/api/info', (req, res) => {
    res.json({ 
        success: true,
        message: '🚀 Сервер TALER работает!',
        database: process.env.DATABASE_URL ? 'Подключена' : 'Нет подключения',
        endpoints: {
            submit_application: 'POST /api/application',
            get_status: 'GET /api/status',
            get_applications: 'GET /api/applications',
            test_db: 'GET /api/test-db',
            info: 'GET /api/info'
        }
    });
});

// Запуск сервера
app.listen(PORT, async () => {
    console.log(`
🚀 Сервер TALER запущен!
────────────────────────
📡 Порт: ${PORT}
🌐 URL: http://localhost:${PORT}
📊 API: http://localhost:${PORT}/api
🔍 Статус: http://localhost:${PORT}/api/status
────────────────────────
    `);
    
    // Инициализируем базу данных
    await initializeDatabase();
});
