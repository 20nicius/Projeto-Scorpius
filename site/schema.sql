-- Tabela de usuários
CREATE TABLE IF NOT EXISTS user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_user TEXT NOT NULL CHECK(email <> ''),
    email TEXT UNIQUE NOT NULL CHECK(email <> ''),
    password TEXT NOT NULL CHECK(email <> ''),
    failed_attempts INTEGER DEFAULT 0
);

-- Tabela de áreas
CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    nome_grupo TEXT UNIQUE,
    coordenadas TEXT,
    FOREIGN KEY (user_email) REFERENCES user(email) ON DELETE CASCADE
);

-- Tabela de usuários pendentes
CREATE TABLE IF NOT EXISTS pending_users (
    email TEXT PRIMARY KEY,
    name_user TEXT,
    password TEXT,
    code TEXT,
    created_at INTEGER,
    new_email TEXT
);

-- Tabela para dispositivos IoT
CREATE TABLE IF NOT EXISTS IoT (
    id INTEGER PRIMARY KEY,
    user_email TEXT,
    rota TEXT,
    FOREIGN KEY (rota) REFERENCES areas(nome_grupo) ON DELETE SET NULL,
    FOREIGN KEY (user_email) REFERENCES user(email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS registros_dispositivo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    device_id TEXT,
    rota TEXT,
    local TEXT,
    observacao_texto TEXT,
    foto BLOB,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES user(email) ON DELETE CASCADE
);

-- Tabela para dados climáticos e de localização
CREATE TABLE IF NOT EXISTS climate_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT,
    device_id INTEGER,
    rota TEXT,
    latitude REAL,
    longitude REAL,
    temperature REAL,
    air_humidity REAL,
    soil_humidity REAL,
    noxious_gas REAL,
    volatile_gas REAL,
    rain BOOLEAN,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_email) REFERENCES user(email) ON DELETE CASCADE
);
