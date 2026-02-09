const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const NodeCache = require('node-cache');
const timeout = require('connect-timeout');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== ОПТИМИЗАЦИИ ====================

// 1. Сжатие ответов (GZIP)
app.use(compression());

// 2. Безопасные заголовки
app.use(helmet({
    contentSecurityPolicy: false, // Можно настроить позже
    crossOriginEmbedderPolicy: false
}));

// 3. Таймауты для запросов
app.use(timeout('15s'));

// 4. Увеличиваем лимиты для JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(cors());

// 5. Кэширование в памяти
const cache = new NodeCache({ 
    stdTTL: 300, // 5 минут по умолчанию
    checkperiod: 600 // Проверка каждые 10 минут
});

// ==================== ПУЛ СОЕДИНЕНИЙ БД ====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { 
        rejectUnauthorized: process.env.NODE_ENV === 'production' ? true : false 
    },
    max: process.env.NODE_ENV === 'production' ? 20 : 5, // Разное для прода и разработки
    min: process.env.NODE_ENV === 'production' ? 2 : 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true
});

// ==================== ОБРАБОТКА ОШИБОК ПУЛА ====================
pool.on('error', (err) => {
    console.error('❌ Неожиданная ошибка пула БД:', err);
});

// ==================== ОБЕРТКА ДЛЯ ЗАПРОСОВ С ТАЙМАУТОМ ====================
async function queryWithTimeout(text, params, timeoutMs = 10000) {
    const client = await pool.connect();
    try {
        // Устанавливаем таймаут на уровне БД
        await client.query(`SET statement_timeout TO ${timeoutMs}`);
        const result = await client.query(text, params);
        return result;
    } catch (error) {
        // Логируем медленные запросы
        if (error.message.includes('timeout')) {
            console.warn(`⚠️ Запрос превысил таймаут ${timeoutMs}ms:`, text.substring(0, 100));
        }
        throw error;
    } finally {
        client.release();
    }
}

// ==================== СТАТИЧЕСКИЕ ФАЙЛЫ ====================
app.use(express.static(path.join(__dirname, '..'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=0');
        }
    }
}));

app.use('/frontend', express.static(path.join(__dirname, '../frontend'), {
    maxAge: '1d'
}));

// ==================== МИДЛВЭР ДЛЯ ЛОГИРОВАНИЯ ====================
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 1000) { // Логируем медленные запросы
            console.log(`🐌 Медленный запрос ${req.method} ${req.url} - ${duration}ms`);
        }
    });
    next();
});

// ==================== МИДЛВЭР ДЛЯ ТАЙМАУТОВ ====================
app.use((req, res, next) => {
    if (!req.timedout) next();
});

// ==================== МАРШРУТЫ ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// ==================== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ====================
async function initializeDatabase() {
    let client;
    try {
        console.log('🔍 Проверяем базу данных...');
        client = await pool.connect();
        
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
        
        // ОПТИМИЗАЦИЯ: СОЗДАЕМ ИНДЕКСЫ
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_applications_created_at 
            ON applications(created_at DESC)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_applications_role_status 
            ON applications(role, status)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_applications_telegram 
            ON applications(telegram)
        `);
        
        // Добавляем партицирование если много данных (опционально)
        await client.query(`
            CREATE TABLE IF NOT EXISTS applications_archive 
            PARTITION OF applications
            FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')
        `);
        
        console.log('✅ База данных оптимизирована');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error.message);
    } finally {
        if (client) client.release();
    }
}

// ==================== API МАРШРУТЫ ====================

// Health check с кэшированием
app.get('/api/health', async (req, res) => {
    const cached = cache.get('health');
    if (cached) {
        return res.json({ ...cached, cached: true });
    }
    
    try {
        const dbResult = await queryWithTimeout('SELECT NOW() as time');
        const data = {
            success: true,
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        };
        
        cache.set('health', data, 30); // Кэш на 30 секунд
        res.json({ ...data, cached: false });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Статус с метриками
app.get('/api/status', async (req, res) => {
    try {
        const [dbResult, countResult] = await Promise.all([
            queryWithTimeout('SELECT NOW() as time, version() as version'),
            queryWithTimeout('SELECT COUNT(*) FROM applications')
        ]);
        
        res.json({
            success: true,
            server: 'online',
            database: {
                connected: true,
                version: dbResult.rows[0].version.split(' ')[1],
                response_time: 'ok'
            },
            cache: {
                stats: cache.getStats(),
                keys: cache.keys().length
            },
            applications_count: parseInt(countResult.rows[0].count),
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database error: ' + error.message
        });
    }
});

// Оптимизированный POST с валидацией и кэшированием
app.post('/api/application', async (req, res) => {
    // Проверяем таймаут
    if (req.timedout) {
        return res.status(408).json({
            success: false,
            error: 'Request timeout'
        });
    }
    
    console.log('📨 Получена новая заявка:', { 
        ...req.body, 
        ip: req.ip,
        timestamp: new Date().toISOString() 
    });
    
    try {
        const {
            nickname, age, timezone, telegram, discord,
            role, experience, minecraft_exp, motivation,
            portfolio, time_available
        } = req.body;

        // Валидация
        if (!nickname || !age || !telegram || !role) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля: nickname, age, telegram, role'
            });
        }

        if (!/^[A-Za-z0-9_]{5,32}$/.test(telegram)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный Telegram username (только латиница, цифры и _, 5-32 символа)'
            });
        }

        if (age < 14 || age > 100) {
            return res.status(400).json({
                success: false,
                error: 'Возраст должен быть от 14 до 100 лет'
            });
        }

        // Проверяем дубликаты (не чаще чем раз в 5 минут)
        const duplicateKey = `duplicate_${telegram}_${role}`;
        if (cache.get(duplicateKey)) {
            return res.status(429).json({
                success: false,
                error: 'Вы недавно отправляли заявку. Попробуйте позже.'
            });
        }
        cache.set(duplicateKey, true, 300); // 5 минут

        // Сохраняем в БД
        const result = await queryWithTimeout(
            `INSERT INTO applications (
                nickname, age, timezone, telegram, discord,
                role, experience, minecraft_exp, motivation,
                portfolio, time_available
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id, nickname, telegram, role, created_at`,
            [
                nickname.substring(0, 100), 
                parseInt(age), 
                timezone ? timezone.substring(0, 50) : null, 
                telegram.substring(0, 100), 
                discord ? discord.substring(0, 100) : null,
                role.substring(0, 50), 
                experience ? experience.substring(0, 2000) : null, 
                minecraft_exp ? minecraft_exp.substring(0, 2000) : null, 
                motivation ? motivation.substring(0, 2000) : null,
                portfolio ? portfolio.substring(0, 2000) : null, 
                time_available ? time_available.substring(0, 100) : null
            ]
        );

        const application = result.rows[0];
        console.log('✅ Заявка сохранена. ID:', application.id);

        // Инвалидируем кэши
        cache.del('applications_count');
        cache.del('applications_list');
        
        // Отправляем в Telegram (если настроено)
        if (process.env.TELEGRAM_BOT_TOKEN) {
            setTimeout(() => {
                try {
                    require('./bot/adminBot').notifyNewApplication(application);
                } catch (e) {
                    console.error('Ошибка отправки в Telegram:', e.message);
                }
            }, 0);
        }

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
        
        // Улучшенная обработка ошибок БД
        if (error.code === '23505') { // unique violation
            return res.status(409).json({
                success: false,
                error: 'Заявка с таким Telegram уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера. Попробуйте позже.'
        });
    }
});

// Оптимизированный GET с пагинацией и кэшированием
app.get('/api/applications', async (req, res) => {
    try {
        const { 
            role, 
            status = 'new',
            limit = 10, 
            offset = 0,
            sort = 'created_at',
            order = 'DESC'
        } = req.query;
        
        // Валидация параметров
        const validLimit = Math.min(parseInt(limit), 100); // Максимум 100
        const validOffset = Math.max(0, parseInt(offset));
        const validSort = ['created_at', 'nickname', 'role', 'age'].includes(sort) ? sort : 'created_at';
        const validOrder = ['ASC', 'DESC'].includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';
        
        // Ключ для кэша
        const cacheKey = `applications_${role}_${status}_${validLimit}_${validOffset}_${validSort}_${validOrder}`;
        const cached = cache.get(cacheKey);
        
        if (cached) {
            return res.json({ ...cached, cached: true });
        }
        
        // Оптимизированный запрос
        let query = `
            SELECT id, nickname, age, telegram, role, 
                   status, created_at,
                   EXTRACT(EPOCH FROM created_at) as created_timestamp
            FROM applications 
            WHERE status = $1
        `;
        
        let params = [status];
        let paramIndex = 2;
        
        if (role && role !== 'all') {
            query += ` AND role = $${paramIndex}`;
            params.push(role);
            paramIndex++;
        }
        
        query += ` ORDER BY ${validSort} ${validOrder} 
                   LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(validLimit, validOffset);

        const result = await queryWithTimeout(query, params);
        
        // Получаем общее количество для пагинации
        const countQuery = `
            SELECT COUNT(*) FROM applications 
            WHERE status = $1 ${role && role !== 'all' ? 'AND role = $2' : ''}
        `;
        const countParams = role && role !== 'all' ? [status, role] : [status];
        const countResult = await queryWithTimeout(countQuery, countParams);
        
        const response = {
            success: true,
            data: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count),
                limit: validLimit,
                offset: validOffset,
                hasMore: validOffset + validLimit < parseInt(countResult.rows[0].count)
            },
            meta: {
                sort: validSort,
                order: validOrder,
                role_filter: role || 'all',
                status_filter: status
            }
        };
        
        // Кэшируем на 2 минуты
        cache.set(cacheKey, response, 120);
        
        res.json({ ...response, cached: false });

    } catch (error) {
        console.error('❌ Ошибка получения заявок:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Быстрый счетчик с кэшированием
app.get('/api/count', async (req, res) => {
    try {
        const { role, status } = req.query;
        const cacheKey = `count_${role || 'all'}_${status || 'all'}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            return res.json({ success: true, ...cached, cached: true });
        }
        
        let query = 'SELECT COUNT(*) FROM applications';
        let params = [];
        
        if (role || status) {
            const conditions = [];
            if (role && role !== 'all') {
                conditions.push(`role = $${params.length + 1}`);
                params.push(role);
            }
            if (status && status !== 'all') {
                conditions.push(`status = $${params.length + 1}`);
                params.push(status);
            }
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
        }
        
        const result = await queryWithTimeout(query, params);
        const count = parseInt(result.rows[0].count);
        
        const response = { count };
        cache.set(cacheKey, response, 60); // Кэш на 1 минуту
        
        res.json({ success: true, ...response, cached: false });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Информация о сервере
app.get('/api/info', (req, res) => {
    const info = {
        success: true,
        message: '🚀 Сервер TALER работает (оптимизированная версия)',
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        optimizations: [
            'database_connection_pooling',
            'query_timeout_handling',
            'in_memory_caching',
            'response_compression',
            'security_headers',
            'request_timeout',
            'database_indexes',
            'input_validation',
            'duplicate_protection'
        ],
        database: {
            connected: !!process.env.DATABASE_URL,
            pool_size: pool.totalCount,
            idle_count: pool.idleCount
        },
        cache: cache.getStats(),
        endpoints: {
            health: 'GET /api/health',
            submit_application: 'POST /api/application',
            get_applications: 'GET /api/applications',
            count: 'GET /api/count',
            status: 'GET /api/status',
            info: 'GET /api/info'
        }
    };
    
    res.json(info);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 Получен SIGTERM, graceful shutdown...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Получен SIGINT, graceful shutdown...');
    await pool.end();
    process.exit(0);
});

// ==================== ЗАПУСК СЕРВЕРА ====================
app.listen(PORT, async () => {
    console.log(`
🚀 Сервер TALER запущен 
─────────────────────────────────────────
📡 Порт: ${PORT}
🌐 URL: ${process.env.RAILWAY_STATIC_URL || `http://localhost:${PORT}`}
📊 База данных: ${process.env.DATABASE_URL ? '✅ Подключена' : '❌ Не настроена'}
🤖 Telegram бот: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Активен' : '❌ Не настроен'}
🧠 Кэширование: ✅ Включено
⚡ Сжатие: ✅ Включено
🛡️ Безопасность: ✅ Включено
─────────────────────────────────────────
    `);
    
    // Инициализация базы данных
    await initializeDatabase();
    
    // Запуск бота (асинхронно, чтобы не блокировать старт)
    setTimeout(() => {
        try {
            if (process.env.TELEGRAM_BOT_TOKEN) {
                require('./bot/adminBot');
                console.log('🤖 Telegram бот инициализирован');
            }
        } catch (error) {
            console.error('❌ Ошибка запуска бота:', error.message);
        }
    }, 1000);
});

module.exports = app; // Для тестирования
