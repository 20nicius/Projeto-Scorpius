const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "database.sqlite");
let db;

async function initializeDatabase() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        db = new SQL.Database(fs.readFileSync(DB_PATH));
    } else {
        db = new SQL.Database();
    }
    
    db.run("PRAGMA foreign_keys = ON;");

    // Tabela de usuários final
    db.run(`CREATE TABLE IF NOT EXISTS user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_user TEXT,
        email TEXT UNIQUE,
        password TEXT,
        failed_attempts INTEGER DEFAULT 0
    )`);

    // Tabela de áreas
    db.run(`CREATE TABLE IF NOT EXISTS areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT,
        nome_grupo TEXT UNIQUE,
        coordenadas TEXT
    )`);

    // Tabela de usuários pendentes
    db.run(`CREATE TABLE IF NOT EXISTS pending_users (
        email TEXT PRIMARY KEY,
        name_user TEXT,
        password TEXT,
        code TEXT,
        created_at INTEGER
    )`);

    try {
        db.run("ALTER TABLE pending_users ADD COLUMN new_email TEXT");
    } catch (e) {
        // Coluna já existe ou não é necessária; ignora o erro.
    }
    
    // Tabela para dispositivos IoT (rota e email do usuário)
    db.run(`CREATE TABLE IF NOT EXISTS IoT (
        id TEXT PRIMARY KEY,
        user_email TEXT,
        rota TEXT,
        FOREIGN KEY (user_email) REFERENCES user(email) ON DELETE CASCADE
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS registros_dispositivo (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        device_id TEXT,
        rota TEXT,
        local TEXT,
        observacao_texto TEXT,
        foto BLOB,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_email) REFERENCES user(email) ON DELETE CASCADE
    )`);

    // Tabela para dados climáticos e de localização
    db.run(`CREATE TABLE IF NOT EXISTS climate_data (
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
    )`);

    saveDatabase();
    console.log("✅ Banco de dados sincronizado e pronto.");
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    }
}

function getDatabase() {
    return db;
}

module.exports = { initializeDatabase, getDatabase, saveDatabase };
