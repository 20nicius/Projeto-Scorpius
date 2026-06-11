require("dotenv").config();
const express = require("express");
const path = require("path");
const { initializeDatabase } = require("./database");
const router = require("./router");

const app = express();
const PORT = process.env.PORTA || 8080;

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// --- USAR O ROUTER --- 
app.use("/", router);

// --- INICIALIZAÇÃO DO BANCO DE DADOS E SERVIDOR ---
async function startServer() {
    await initializeDatabase();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Servidor Soja IA rodando em http://localhost:${PORT}`);
    });
    
    const url = await ngrok.connect({
        authtoken: process.env.NGROK_AUTHTOKEN,
        addr: PORTA,
        domain: process.env.BASE_URL?.replace(/^https?:\/\//, '')
    });
}

startServer();
