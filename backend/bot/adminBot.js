const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// Функция для получения корректного URL
function getBaseUrl() {
    let url = process.env.RAILWAY_STATIC_URL || 'easygoing-compassion-production-93f3.up.railway.app';
    
    // Добавляем протокол, если его нет
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    console.log(`🌐 Используем URL: ${url}`);
    return url;
}

const BASE_URL = getBaseUrl();

// Конфигурация
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_IDS = process.env.TELEGRAM_ADMIN_CHAT_IDS 
    ? process.env.TELEGRAM_ADMIN_CHAT_IDS.split(',').map(id => id.trim())
    : [];

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN не установлен!');
    process.exit(1);
}

console.log(`🤖 Бот запущен. Админы: ${ADMIN_CHAT_IDS.length}`);

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true,
    request: {
        agentOptions: {
            keepAlive: true,
            family: 4
        }
    }
});

// Хранилище состояния (для каждого чата)
const userState = {};

// Проверка доступа
function isAdmin(chatId) {
    return ADMIN_CHAT_IDS.includes(chatId.toString());
}

// Форматирование даты
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU') + ', ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
        return dateString || 'Не указано';
    }
}

// Получение названия роли
function getRoleName(roleKey) {
    const roleNames = {
        'media': '🎥 Медиа Проекта',
        'dev': '💻 Разработчик',
        'support': '📞 Поддержка игроков',
        'qa': '🔎 Тестировщик',
        'builder': '🏗️ Билдер',
        'moderator': '🛡️ Модератор',
        'all': '📋 Все заявки',
        'new': '🆕 Новые'
    };
    return roleNames[roleKey] || roleKey;
}

// Форматирование заявки
function formatApplication(app, index, total) {
    if (!app) return '❌ Заявка не найдена';
    
    return `🎮 <b>НОВАЯ ЗАЯВКА НА СЕРВЕР TALER</b>

👤 <b>Основная информация:</b>
• Никнейм: ${app.nickname || 'Не указано'}
• Возраст: ${app.age || 'Не указано'}
• Часовой пояс: ${app.timezone || 'Не указано'}
• Telegram: @${app.telegram || 'Не указано'}
${app.discord ? `• Discord: ${app.discord}\n` : ''}
🎯 <b>Роль:</b>
${getRoleName(app.role) || 'Не указано'}

📊 <b>Опыт:</b>
${app.experience || 'Не указано'}

⛏️ <b>Опыт в Minecraft:</b>
${app.minecraft_exp || 'Не указано'}

💪 <b>Мотивация:</b>
${app.motivation || 'Не указано'}

${app.portfolio ? `🔗 <b>Портфолио:</b>\n${app.portfolio}\n\n` : ''}
⏰ <b>Время:</b>
${app.time_available || 'Не указано'}

📅 <b>Дата:</b>
${formatDate(app.created_at)}

${total > 1 ? `\n📄 <i>Заявка ${index + 1} из ${total}</i>` : ''}`;
}

// Главное меню
function showMainMenu(chatId, userName = 'админ') {
    const message = `👋 Здравствуйте, ${userName}!\n\n📋 <b>Меню управления заявками</b>\n\nВыберите категорию:`;
    
    bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📋 Все заявки', callback_data: 'show_all_0' },
                    { text: '🆕 Новые', callback_data: 'show_new_0' }
                ],
                [
                    { text: '🎥 Медиа', callback_data: 'show_media_0' },
                    { text: '💻 Разработчик', callback_data: 'show_dev_0' }
                ],
                [
                    { text: '📞 Поддержка', callback_data: 'show_support_0' },
                    { text: '🔎 Тестировщик', callback_data: 'show_qa_0' }
                ],
                [
                    { text: '🏗️ Билдер', callback_data: 'show_builder_0' },
                    { text: '🛡️ Модератор', callback_data: 'show_moderator_0' }
                ]
            ]
        }
    });
}

// Получение заявок с API
async function getApplications(role, offset = 0) {
    try {
        let url = `${BASE_URL}/api/applications?limit=1&offset=${offset}`;
        
        if (role !== 'all' && role !== 'new') {
            url += `&role=${role}`;
        }
        
        console.log('📡 Запрос к API:', url);
        
        const response = await fetch(url, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            console.error(`❌ API ошибка ${response.status}: ${response.statusText}`);
            throw new Error(`API ошибка: ${response.status}`);
        }
        
        const text = await response.text();
        console.log('📄 Ответ API:', text.substring(0, 200));
        
        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error('❌ Ошибка парсинга JSON:', e.message);
            throw new Error('Неверный формат ответа от сервера');
        }
        
        if (!result.success) {
            console.error('❌ API вернул ошибку:', result.error);
            throw new Error(result.error || 'Ошибка API');
        }
        
        console.log('📊 Получено заявок:', result.data?.length || 0);
        
        // Получаем общее количество
        const countUrl = `${BASE_URL}/api/count${role !== 'all' && role !== 'new' ? `?role=${role}` : ''}`;
        console.log('📡 Запрос количества:', countUrl);
        
        const countResponse = await fetch(countUrl, { timeout: 5000 });
        const countText = await countResponse.text();
        let countResult;
        
        try {
            countResult = JSON.parse(countText);
        } catch (e) {
            console.error('❌ Ошибка парсинга JSON для count:', e.message);
            countResult = { count: result.data ? result.data.length : 0 };
        }
        
        const total = countResult.count || (result.data ? result.data.length : 0);
        
        return {
            success: true,
            application: result.data && result.data.length > 0 ? result.data[0] : null,
            total: total,
            currentIndex: offset
        };
    } catch (error) {
        console.error('❌ Ошибка получения заявок:', error.message);
        return {
            success: false,
            error: error.message,
            application: null,
            total: 0
        };
    }
}

// Показ заявки
async function showApplication(chatId, messageId = null, role, offset) {
    try {
        console.log(`📨 Показ заявки: роль=${role}, offset=${offset}`);
        
        // Получаем данные
        const result = await getApplications(role, offset);
        
        if (!result.success) {
            const message = `❌ Ошибка: ${result.error}`;
            if (messageId) {
                return bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Повторить', callback_data: `${role}_${offset}` }],
                            [{ text: '📋 В меню', callback_data: 'menu' }]
                        ]
                    }
                });
            } else {
                return bot.sendMessage(chatId, message, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Повторить', callback_data: `${role}_${offset}` }],
                            [{ text: '📋 В меню', callback_data: 'menu' }]
                        ]
                    }
                });
            }
        }
        
        // Сохраняем состояние
        userState[chatId] = { role, offset, total: result.total };
        
        // Если заявок нет
        if (!result.application || result.total === 0) {
            const message = `📭 Нет заявок в категории "${getRoleName(role)}"`;
            const keyboard = [];
            
            // Если offset > 0, показываем кнопку "Назад"
            if (offset > 0) {
                keyboard.push({ text: '⬅️ Назад', callback_data: `${role}_${offset - 1}` });
            }
            
            keyboard.push({ text: '📋 В меню', callback_data: 'menu' });
            
            if (messageId) {
                return bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: { inline_keyboard: [keyboard] }
                });
            } else {
                return bot.sendMessage(chatId, message, {
                    reply_markup: { inline_keyboard: [keyboard] }
                });
            }
        }
        
        // Форматируем заявку
        const message = formatApplication(result.application, offset, result.total);
        
        // Создаем клавиатуру
        const keyboard = [];
        const row = [];
        
        // Кнопка "Назад" если не первая заявка
        if (offset > 0) {
            row.push({ text: '⬅️ Назад', callback_data: `${role}_${offset - 1}` });
        }
        
        // Кнопка "Вперед" если не последняя заявка
        if (offset < result.total - 1) {
            row.push({ text: '➡️ Вперед', callback_data: `${role}_${offset + 1}` });
        }
        
        if (row.length > 0) {
            keyboard.push(row);
        }
        
        keyboard.push([{ text: '📋 В меню', callback_data: 'menu' }]);
        
        // Отправляем или редактируем сообщение
        if (messageId) {
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            return bot.sendMessage(chatId, message, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка показа заявки:', error);
        const errorMessage = '❌ Внутренняя ошибка бота';
        
        if (messageId) {
            return bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '📋 В меню', callback_data: 'menu' }]]
                }
            });
        } else {
            return bot.sendMessage(chatId, errorMessage, {
                reply_markup: {
                    inline_keyboard: [[{ text: '📋 В меню', callback_data: 'menu' }]]
                }
            });
        }
    }
}

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'админ';
    
    console.log(`🔄 Команда /start от ${chatId} (${userName})`);
    
    if (!isAdmin(chatId)) {
        console.log(`🚫 Отказ в доступе для ${chatId}`);
        return bot.sendMessage(chatId, '🚫 У вас нет доступа к этому боту.');
    }
    
    console.log(`✅ Доступ разрешен для ${chatId}`);
    showMainMenu(chatId, userName);
});

// Команда /menu
bot.onText(/\/menu/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'админ';
    
    if (!isAdmin(chatId)) {
        return bot.sendMessage(chatId, '🚫 У вас нет доступа к этому боту.');
    }
    
    showMainMenu(chatId, userName);
});

// Команда /test - для проверки
bot.onText(/\/test/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!isAdmin(chatId)) {
        return bot.sendMessage(chatId, '🚫 У вас нет доступа.');
    }
    
    const testMsg = await bot.sendMessage(chatId, '🔍 Тестируем соединение с API...');
    
    try {
        const url = `${BASE_URL}/api/status`;
        const response = await fetch(url, { timeout: 5000 });
        const text = await response.text();
        
        await bot.editMessageText(`✅ API отвечает!\nСтатус: ${response.status}\nОтвет: ${text.substring(0, 100)}`, {
            chat_id: chatId,
            message_id: testMsg.message_id
        });
    } catch (error) {
        await bot.editMessageText(`❌ API недоступен: ${error.message}`, {
            chat_id: chatId,
            message_id: testMsg.message_id
        });
    }
});

// Обработка callback-запросов (кнопок)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    
    console.log(`🔄 Callback: ${data} от ${chatId}`);
    
    // Проверка доступа
    if (!isAdmin(chatId)) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🚫 Нет доступа' });
        return bot.editMessageText('🚫 У вас нет доступа к этому боту.', {
            chat_id: chatId,
            message_id: messageId
        });
    }
    
    try {
        await bot.answerCallbackQuery(callbackQuery.id);
        
        if (data === 'menu') {
            // Возврат в главное меню
            const userName = callbackQuery.from.first_name || 'админ';
            await bot.editMessageText(`👋 Здравствуйте, ${userName}!\n\n📋 <b>Меню управления заявками</b>`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📋 Все заявки', callback_data: 'show_all_0' },
                            { text: '🆕 Новые', callback_data: 'show_new_0' }
                        ],
                        [
                            { text: '🎥 Медиа', callback_data: 'show_media_0' },
                            { text: '💻 Разработчик', callback_data: 'show_dev_0' }
                        ],
                        [
                            { text: '📞 Поддержка', callback_data: 'show_support_0' },
                            { text: '🔎 Тестировщик', callback_data: 'show_qa_0' }
                        ],
                        [
                            { text: '🏗️ Билдер', callback_data: 'show_builder_0' },
                            { text: '🛡️ Модератор', callback_data: 'show_moderator_0' }
                        ]
                    ]
                }
            });
            return;
        }
        
        // Обработка навигации по заявкам
        if (data.includes('_')) {
            const parts = data.split('_');
            
            if (parts[0] === 'show') {
                // Показать первую заявку категории
                const role = parts[1];
                const offset = parseInt(parts[2]) || 0;
                await showApplication(chatId, messageId, role, offset);
            } else {
                // Навигация вперед/назад
                const role = parts[0];
                const offset = parseInt(parts[1]) || 0;
                await showApplication(chatId, messageId, role, offset);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка обработки callback:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Ошибка' });
    }
});

// Прямые команды для категорий
const roleCommands = {
    '/media': 'media',
    '/dev': 'dev',
    '/support': 'support',
    '/qa': 'qa',
    '/builder': 'builder',
    '/moderator': 'moderator',
    '/new': 'new',
    '/all': 'all'
};

// Регистрация обработчиков для команд
Object.entries(roleCommands).forEach(([command, role]) => {
    bot.onText(new RegExp(command), (msg) => {
        const chatId = msg.chat.id;
        
        if (!isAdmin(chatId)) {
            return bot.sendMessage(chatId, '🚫 У вас нет доступа к этому боту.');
        }
        
        showApplication(chatId, null, role, 0);
    });
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('❌ Ошибка polling Telegram:', error.message);
    
    // Если ошибка 409 (два бота запущены), ждем и перезапускаем
    if (error.message.includes('409')) {
        console.log('⚠️ Обнаружено несколько ботов. Перезапуск через 5 секунд...');
        setTimeout(() => {
            console.log('🔄 Перезапуск бота...');
        }, 5000);
    }
});

bot.on('webhook_error', (error) => {
    console.error('❌ Ошибка webhook:', error.message);
});

console.log('✅ Telegram бот успешно запущен и готов к работе!');
console.log(`📱 Админы: ${ADMIN_CHAT_IDS.join(', ')}`);
console.log(`🌐 API URL: ${BASE_URL}`);

// Экспорт бота для использования в server.js
module.exports = bot;
