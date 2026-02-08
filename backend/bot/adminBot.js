async function showApplications(chatId, messageId, role, offset) {
    try {
        const roleParam = role === 'all' ? '' : role;
        
        // Получаем общее количество заявок для этой роли
        const totalResponse = await fetch(
            `${API_URL}/applications?role=${roleParam}`
        );
        const totalResult = await totalResponse.json();
        const total = totalResult.total || 0;
        
        // Если offset больше или равен общему количеству, значит заявок больше нет
        if (offset >= total) {
            let message = `📭 Нет заявок по роли "${getRoleName(role)}"`;
            
            const keyboardButtons = [];
            
            // Проверяем, есть ли предыдущие заявки
            if (offset > 0 && total > 0) {
                keyboardButtons.push({ text: '⬅️ Назад', callback_data: 'prev' });
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
            return;
        }
        
        // Получаем конкретную заявку по смещению
        const response = await fetch(
            `${API_URL}/applications?role=${roleParam}&limit=1&offset=${offset}`
        );
        
        if (!response.ok) throw new Error('Ошибка сервера');
        
        const result = await response.json();
        
        if (result.data && result.data.length > 0) {
            const app = result.data[0];
            
            const message = formatApplicationMessage(app, offset, total);
            
            const keyboardButtons = [];
            
            // Кнопка "Назад" показывается, если не первая заявка
            if (offset > 0) {
                keyboardButtons.push({ text: '⬅️ Назад', callback_data: 'prev' });
            }
            
            // Кнопка "Последняя" всегда показывается
            keyboardButtons.push({ text: '🔄 Последняя', callback_data: 'latest' });
            
            // Кнопка "Вперед" показывается, если не последняя заявка
            if (offset < total - 1) {
                keyboardButtons.push({ text: '➡️ Вперед', callback_data: 'next' });
            }
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        keyboardButtons,
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
            // Этот блок сработает, если API вернул 0 заявок, но offset < total
            let message = `📭 Нет заявок по роли "${getRoleName(role)}"`;
            
            const keyboardButtons = [];
            
            // Проверяем, есть ли предыдущие заявки
            if (offset > 0) {
                keyboardButtons.push({ text: '⬅️ Назад', callback_data: 'prev' });
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
