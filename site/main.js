require("dotenv").config();
const express = require("express");
const path = require("path");
const { initializeDatabase } = require("./database");
const router = require("./router");
const ngrok = require("@ngrok/ngrok");

const app = express();
const PORT = process.env.PORTA || 8080;

// --- MIDDLEWARES ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// --- USAR O ROUTER --- 
app.use("/", router);

// --- ERRO GLOBAIS ---
app.use((err, req, res, next) => {
    // Captura conexões abortadas (como o erro raw-body de request aborted)
    if (err.type === 'aborted' || err.status === 400 || err.message?.includes('aborted')) {
        console.warn("[HTTP] Um dispositivo interrompeu ou abortou o envio da foto no meio do caminho.");
        // Importante: garante que a resposta só seja enviada se os headers já não tiverem sido despachados
        if (!res.headersSent) {
            return res.status(400).json({ erro: "Conexão interrompida pelo cliente." });
        }
        return;
    }
    
    // Qualquer outro erro interno não tratado
    console.error("Erro não tratado na aplicação:", err);
    if (!res.headersSent) {
        res.status(500).json({ erro: "Erro interno no servidor." });
    }
});

// --- INICIALIZAÇÃO DO BANCO DE DADOS E SERVIDOR ---
async function startServer() {
    await initializeDatabase();
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Servidor Soja IA rodando em http://localhost:${PORT}`);
    });
    
    const url = await ngrok.connect({
        authtoken: process.env.NGROK_AUTHTOKEN,
        addr: PORT,
        domain: process.env.BASE_URL?.replace(/^https?:\/\//, '')
    });
}

startServer();
