-- Создание таблицы заявок
CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    -- Основная информация
    nickname VARCHAR(100) NOT NULL,
    age INTEGER NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    
    -- Роль (ваши 6 ролей)
    role VARCHAR(20) NOT NULL CHECK (
        role IN ('media', 'dev', 'support', 'qa', 'builder', 'moderator')
    ),
    experience TEXT NOT NULL,
    
    -- Контактная информация
    telegram VARCHAR(100) NOT NULL,
    discord VARCHAR(100),
    
    -- О себе
    minecraft_exp TEXT NOT NULL,
    motivation TEXT NOT NULL,
    portfolio TEXT,
    time_available TEXT NOT NULL,
    
    -- Технические поля
    created_at TIMESTAMP DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'new',
    reviewed_by VARCHAR(100),
    notes TEXT
);

-- Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_applications_role ON applications(role);
CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
