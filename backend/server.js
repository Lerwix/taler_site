const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Раздаем статические файлы фронтенда
app.use(express.static(path.join(__dirname, '../frontend')));

// Главная страница - фронтенд
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Подключение к PostgreSQL (Railway)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==================== TELEGRAM БОТ ====================
let bot = null;

if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
        bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
            polling: true 
        });
        
        console.log('✅ Telegram бот запущен');
        
        // Команда /start
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const userName = msg.from.first_name || 'друг';
            
            bot.sendMessage(chatId, 
                `👋 Привет, ${userName}!\n\n` +
                `Я бот для управления заявками TALER.\n\n` +
                `📋 **Доступные команды:**\n` +
                `/start - показать это сообщение\n` +
                `/latest - последняя заявка\n` +
                `/count - количество заявок\n` +
                `/help - помощь`,
                { parse_mode: 'Markdown' }
            );
        });
        
        // Команда /help
        bot.onText(/\/help/, (msg) => {
            bot.sendMessage(msg.chat.id,
                `🆘 **Помощь по командам:**\n\n` +
                `/start - приветствие\n` +
                `/latest - показать последнюю заявку\n` +
                `/count - сколько заявок в базе\n` +
                `/help - эта справка`,
                { parse_mode: 'Markdown' }
            );
        });
        
        // Команда /latest - последняя заявка
        bot.onText(/\/latest/, async (msg) => {
            try {
                const result = await pool.query(
                    'SELECT * FROM applications ORDER BY created_at DESC LIMIT 1'
                );
                
                if (result.rows.length > 0) {
                    const app = result.rows[0];
                    const message = 
                        `📋 **Последняя заявка**\n` +
                        `────────────────\n` +
                        `👤 **Никнейм:** ${app.nickname}\n` +
                        `🎂 **Возраст:** ${app.age}\n` +
                        `📍 **Часовой пояс:** ${app.timezone || 'Не указан'}\n` +
                        `📱 **Telegram:** @${app.telegram}\n` +
                        `💼 **Роль:** ${getRoleName(app.role)}\n` +
                        `🕒 **Дата:** ${new Date(app.created_at).toLocaleString('ru-RU')}\n` +
                        `────────────────\n` +
                        `🆔 ID: ${app.id}`;
                    
                    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(msg.chat.id, '📭 Заявок пока нет в базе данных.');
                }
            } catch (error) {
                console.error('Ошибка получения заявки:', error);
                bot.sendMessage(msg.chat.id, '❌ Ошибка при получении заявки из базы данных.');
            }
        });
        
        // Команда /count - количество заявок
        bot.onText(/\/count/, async (msg) => {
            try {
                const result = await pool.query('SELECT COUNT(*) as count FROM applications');
                const count = result.rows[0].count;
                
                bot.sendMessage(msg.chat.id, 
                    `📊 **Статистика заявок**\n\n` +
                    `✅ Всего заявок: **${count}**\n` +
                    `🕒 Актуально на: ${new Date().toLocaleString('ru-RU')}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                bot.sendMessage(msg.chat.id, '❌ Ошибка подсчета заявок.');
            }
        });
        
        // Уведомление о новой заявке (для админа)
        async function notifyNewApplication(application) {
            if (!bot || !process.env.TELEGRAM_ADMIN_CHAT_ID) return;
            
            try {
                const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
                const message = 
                    `🎉 **НОВАЯ ЗАЯВКА!**\n` +
                    `────────────────\n` +
                    `👤 **Никнейм:** ${application.nickname}\n` +
                    `🎂 **Возраст:** ${application.age}\n` +
                    `💼 **Роль:** ${getRoleName(application.role)}\n` +
                    `📱 **Telegram:** @${application.telegram}\n` +
                    `📍 **Часовой пояс:** ${application.timezone || 'Не указан'}\n` +
                    `🕒 **Время:** ${new Date().toLocaleString('ru-RU')}\n` +
                    `────────────────\n` +
                    `🆔 ID: ${application.id}`;
                
                bot.sendMessage(adminChatId, message, { parse_mode: 'Markdown' });
                console.log('✅ Уведомление отправлено в Telegram');
            } catch (error) {
                console.error('Ошибка отправки уведомления:', error);
            }
        }
        
        // Вспомогательная функция для названий ролей
        function getRoleName(roleKey) {
            const roles = {
                'media': '🎥 Медиа Проекта',
                'dev': '💻 Разработчик',
                'support': '📞 Поддержка игроков',
                'qa': '🔎 Тестировщик',
                'builder': '🏗️ Билдер',
                'moderator': '🛡️ Модератор'
            };
            return roles[roleKey] || roleKey;
        }
        
        console.log('🤖 Telegram бот готов к работе. Отправьте /start в боте.');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации Telegram бота:', error.message);
    }
} else {
    console.log('ℹ️ Telegram бот не настроен. Добавьте TELEGRAM_BOT_TOKEN в Railway Variables.');
}
// ==================== КОНЕЦ TELEGRAM БОТА ====================

// Автоматическое создание таблицы
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

// API: Статус сервера
app.get('/api/status', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT NOW() as time');
        const countResult = await pool.query('SELECT COUNT(*) FROM applications');
        
        res.json({
            success: true,
            server: 'online',
            database: 'connected',
            telegram_bot: bot ? 'active' : 'inactive',
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

// API: Тест БД
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

// API: Отправка заявки
app.post('/api/application', async (req, res) => {
    console.log('📨 Получена новая заявка:', req.body);
    
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

        // Проверка Telegram
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

        // Отправляем уведомление в Telegram
        if (bot) {
            try {
                await notifyNewApplication(application);
            } catch (botError) {
                console.log('⚠️ Уведомление в Telegram не отправлено:', botError.message);
            }
        }

        res.status(201).json({
            success: true,
            message: '✅ Заявка успешно сохранена',
            data: {
                id: application.id,
                nickname: application.nickname,
                telegram: application.telegram,
                role: application.role,
                timestamp: application.created_at,
                telegram_notified: bot ? true : false
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

// API: Получение заявок
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

// API: Количество заявок
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

// API: Информация о сервере
app.get('/api/info', (req, res) => {
    res.json({ 
        success: true,
        message: '🚀 Сервер TALER работает!',
        database: process.env.DATABASE_URL ? 'Подключена' : 'Нет подключения',
        telegram_bot: bot ? 'Активен' : 'Не настроен',
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

// Запуск сервера
app.listen(PORT, async () => {
    console.log(`
🚀 Сервер TALER запущен!
────────────────────────
📡 Порт: ${PORT}
🌐 URL: https://easygoing-compassion-production-93f3.up.railway.app
🤖 Telegram бот: ${bot ? '✅ Активен' : '❌ Не настроен'}
📊 API: /api/status, /api/application, /api/applications
────────────────────────
    `);
    
    // Инициализация базы данных
    await initializeDatabase();
});
