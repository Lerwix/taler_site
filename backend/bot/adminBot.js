const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
// URL API для Railway
const API_URL = process.env.RAILWAY_STATIC_URL 
  ? `https://${process.env.RAILWAY_STATIC_URL}/api` 
  : 'http://localhost:3000/api';
const bot = new TelegramBot(process.env.TELEGRAM_ADMIN_BOT_TOKEN, { polling: true });
const adminChatIds = process.env.ADMIN_CHAT_IDS ? process.env.ADMIN_CHAT_IDS.split(',') : [];

console.log('🤖 Telegram админ-бот запущен...');

const userStates = new Map();

const roles = {
    'media': '🎥 Медиа Проекта',
    'dev': '💻 Разработчик',
    'support': '📞 Поддержка игроков',
    'qa': '🔎 Тестировщик',
    'builder': '🏗️ Билдер',
    'moderator': '🛡️ Модератор',
    'all': '📋 Все заявки'
};

function getRoleName(roleKey) {
    return roles[roleKey] || roleKey;
}

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!adminChatIds.includes(userId.toString())) {
        bot.sendMessage(chatId, '⛔ У вас нет доступа к этому боту.');
        return;
    }
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🎥 Медиа', callback_data: 'role_media' },
                    { text: '💻 Разраб.', callback_data: 'role_dev' }
                ],
                [
                    { text: '📞 Поддержка', callback_data: 'role_support' },
                    { text: '🔎 Тестир.', callback_data: 'role_qa' }
                ],
                [
                    { text: '🏗️ Билдер', callback_data: 'role_builder' },
                    { text: '🛡️ Модератор', callback_data: 'role_moderator' }
                ],
                [
                    { text: '📋 Все заявки', callback_data: 'role_all' }
                ]
            ]
        }
    };
    
    bot.sendMessage(chatId, '📊 Панель управления заявками TALER\nВыберите роль для просмотра:', {
        parse_mode: 'Markdown',
        ...keyboard
    });
});

bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    
    if (!adminChatIds.includes(userId.toString())) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '⛔ Нет доступа' });
        return;
    }
    
    if (data.startsWith('role_')) {
        const role = data.replace('role_', '');
        userStates.set(chatId, { role, offset: 0 });
        await showApplications(chatId, messageId, role, 0);
    } 
    else if (data === 'prev') {
        const state = userStates.get(chatId);
        if (state) {
            if (state.offset > 0) {
                state.offset -= 1;
            }
            await showApplications(chatId, messageId, state.role, state.offset);
        }
    } 
    else if (data === 'next') {
        const state = userStates.get(chatId);
        if (state) {
            state.offset += 1;
            await showApplications(chatId, messageId, state.role, state.offset);
        }
    } 
    else if (data === 'latest') {
        const state = userStates.get(chatId);
        if (state) {
            state.offset = 0;
            await showApplications(chatId, messageId, state.role, 0);
        }
    }
    else if (data === 'back_menu') {
        bot.deleteMessage(chatId, messageId).catch(() => {});
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🎥 Медиа', callback_data: 'role_media' },
                        { text: '💻 Разраб.', callback_data: 'role_dev' }
                    ],
                    [
                        { text: '📞 Поддержка', callback_data: 'role_support' },
                        { text: '🔎 Тестир.', callback_data: 'role_qa' }
                    ],
                    [
                        { text: '🏗️ Билдер', callback_data: 'role_builder' },
                        { text: '🛡️ Модератор', callback_data: 'role_moderator' }
                    ],
                    [
                        { text: '📋 Все заявки', callback_data: 'role_all' }
                    ]
                ]
            }
        };
        
        bot.sendMessage(chatId, '📊 Панель управления заявками TALER\nВыберите роль для просмотра:', {
            parse_mode: 'Markdown',
            ...keyboard
        });
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
});

function formatApplicationMessage(app, offset, total) {
    const roleNames = {
        'media': '🎥 Медиа Проекта',
        'dev': '💻 Разработчик',
        'support': '📞 Поддержка игроков',
        'qa': '🔎 Тестировщик',
        'builder': '🏗️ Билдер',
        'moderator': '🛡️ Модератор'
    };
    
    const date = new Date(app.created_at);
    const formattedDate = date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }) + ', ' + date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    let message = `🎮 <b>ЗАЯВКА НА СЕРВЕР TALER</b>\n\n`;
    
    message += `<b>👤 Основная информация:</b>\n`;
    message += `• Никнейм: <code>${app.nickname}</code>\n`;
    message += `• Возраст: ${app.age}\n`;
    message += `• Часовой пояс: ${app.timezone}\n`;
    message += `• Telegram: @${app.telegram}\n`;
    message += `• Discord: ${app.discord || 'Не указан'}\n\n`;
    
    message += `<b>🎯 Роль:</b>\n`;
    message += `${roleNames[app.role] || app.role}\n\n`;
    
    message += `<b>📊 Опыт:</b>\n`;
    message += `${app.experience}\n\n`;
    
    message += `<b>⛏️ Опыт в Minecraft:</b>\n`;
    message += `${app.minecraft_exp}\n\n`;
    
    message += `<b>💪 Мотивация:</b>\n`;
    message += `${app.motivation}\n\n`;
    
    message += `<b>🔗 Портфолио:</b>\n`;
    message += `${app.portfolio || 'Не указано'}\n\n`;
    
    message += `<b>⏰ Время:</b>\n`;
    message += `${app.time_available}\n\n`;
    
    message += `<b>📅 Дата:</b>\n`;
    message += `${formattedDate}\n\n`;
    
    message += `────────────────\n`;
    message += `<b>ID заявки:</b> #${app.id}\n`;
    message += `<b>Статус:</b> ${app.status || 'новая'}\n`;
    message += `<b>Просмотр:</b> ${offset + 1} из ${total}`;
    
    return message.trim();
}

async function showApplications(chatId, messageId, role, offset) {
    try {
        const roleParam = role === 'all' ? '' : role;
        const response = await fetch(
            `${API_URL}/applications?role=${roleParam}&limit=1&offset=${offset}`
        );
        
        if (!response.ok) throw new Error('Ошибка сервера');
        
        const result = await response.json();
        
        if (result.data && result.data.length > 0) {
            const app = result.data[0];
            
            const totalResponse = await fetch(
                `${API_URL}/applications?role=${roleParam}&limit=1&offset=${offset}`
            );
            const totalResult = await totalResponse.json();
            const total = totalResult.total || result.data.length;
            
            const message = formatApplicationMessage(app, offset, total);
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⬅️ Назад', callback_data: 'prev' },
                            { text: '🔄 Последняя', callback_data: 'latest' },
                            { text: '➡️ Вперед', callback_data: 'next' }
                        ],
                        [
                            { text: '📋 В меню', callback_data: 'back_menu' }
                        ]
                    ]
                }
            };
            
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                ...keyboard
            });
            
        } else {
            let message = `📭 Нет заявок по роли "${getRoleName(role)}"`;
            
            const prevResponse = await fetch(
                `${API_URL}/applications?role=${roleParam}&limit=1&offset=${offset}`
            );
            
            const keyboardButtons = [];
            
            if (prevResponse.ok) {
                const prevResult = await prevResponse.json();
                if (prevResult.data && prevResult.data.length > 0 && offset > 0) {
                    keyboardButtons.push({ text: '⬅️ Назад', callback_data: 'prev' });
                }
            }
            
            keyboardButtons.push({ text: '📋 В меню', callback_data: 'back_menu' });
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [keyboardButtons]
                }
            };
            
            bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...keyboard
            });
        }
        
    } catch (error) {
        console.error('Ошибка:', error);
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⬅️ Назад', callback_data: 'prev' },
                        { text: '📋 В меню', callback_data: 'back_menu' }
                    ]
                ]
            }
        };
        
        bot.editMessageText('❌ Ошибка загрузки заявок', {
            chat_id: chatId,
            message_id: messageId,
            ...keyboard
        });
    }
}

bot.on('polling_error', (error) => {
    console.error('❌ Ошибка polling:', error.code);
});

console.log('✅ Бот готов!');
