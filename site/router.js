const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");
const tf = require("@tensorflow/tfjs");
const sharp = require("sharp");
const fs = require("fs");
const { getDatabase, saveDatabase } = require("./database");

const router = express.Router();
const SECRET = process.env.JWT_SECRET || "chave_segura_2026";

// --- CONFIGURAÇÃO DA IA ---
let modelIA = null;
let classNames = [];

// Executa a inicialização da IA em segundo plano
loadModelIA();

// Middleware para processar requisições com corpo binário puro (Buffer de imagem JPEG)
const binarioBodyParser = express.raw({ type: 'image/jpeg', limit: '2mb' }); //


// --- CONFIGURAÇÃO DE LIMITADORES (RATE LIMIT) ---
const generalLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30 minutos
    max: 10,
    handler: (req, res) => {
        const resetTime = req.rateLimit.resetTime;
        const segundosRestantes = Math.round((resetTime - new Date()) / 1000);
        res.status(429).json({ 
            erro: "Muitas tentativas.",
            retryAfter: segundosRestantes 
        });
    }
});

const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // Limite de 5 tentativas de verificação de código
    message: { erro: "Muitas tentativas de verificação. Tente novamente em 15 minutos." }
});

// --- MIDDLEWARE DE AUTENTICAÇÃO JWT ---
function verificarToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.startsWith("Bearer ") 
        ? authHeader.split(" ")[1] 
        : authHeader;

    if (!token) return res.status(401).json({ erro: "Acesso negado. Faça login." });

    jwt.verify(token, SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ erro: "Token inválido ou expirado." });
        req.userEmail = decoded.email;
        next();
    });
}

// --- CONFIGURAÇÃO DO NODEMAILER ---
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- ROTAS DE PÁGINAS ---
router.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "main.html")));
router.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
router.get("/cadastro", (req, res) => res.sendFile(path.join(__dirname, "public", "cadastro.html")));
router.get("/verificar", (req, res) => res.sendFile(path.join(__dirname, "public", "verificar.html")));
router.get("/user", (req, res) => res.sendFile(path.join(__dirname, "public", "user.html")));
router.get("/mapa", (req, res) => res.sendFile(path.join(__dirname, "public", "mapa.html")));
router.get("/config", (req, res) => res.sendFile(path.join(__dirname, "public", "config.html")));
router.get("/info", (req, res) => res.sendFile(path.join(__dirname, "public", "info.html")));
router.get("/redefinir", (req, res) => res.sendFile(path.join(__dirname, "public", "redefinir.html")));

// --- ROTAS DE AUTENTICAÇÃO ---
router.get("/api/checar-sessao", verificarToken, (req, res) => {
    res.json({ logado: true, email: req.userEmail });
});

// --- OBTER DADOS DO USUÁRIO LOGADO ---
router.get("/api/me", verificarToken, (req, res) => {
    const email = req.userEmail;
    const db = getDatabase();
    try {
        const resSet = db.exec("SELECT name_user, email FROM user WHERE email = ?", [email]);

        if (resSet.length === 0 || resSet[0].values.length === 0) {
            return res.status(404).json({ erro: "Usuário não encontrado.", emailUpdated: true });
        }

        const userData = resSet[0].values[0];
        res.json({
            name: userData[0],
            email: userData[1]
        });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar dados do usuário." });
    }
});

// --- ATUALIZAR NOME DO USUÁRIO ---
router.post("/api/update-name", verificarToken, (req, res) => {
    const { newName } = req.body;
    const email = req.userEmail;
    const db = getDatabase();

    if (!newName || newName.trim() === "") {
        return res.status(400).json({ erro: "Nome não pode estar vazio." });
    }

    try {
        db.run("UPDATE user SET name_user = ? WHERE email = ?", [newName, email]);
        saveDatabase();
        res.json({ mensagem: "Nome atualizado com sucesso!", name: newName });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao atualizar nome." });
    }
});

// --- VERIFICAR MUDANÇA PENDENTE DE EMAIL ---
router.get("/api/verificar-mudanca-email-pendente", verificarToken, (req, res) => {
    const currentEmail = req.userEmail;
    const db = getDatabase();

    try {
        const result = db.exec("SELECT new_email FROM pending_users WHERE email = ?", [currentEmail]);

        if (result.length > 0 && result[0].values.length > 0) {
            const newEmail = result[0].values[0][0];
            if (newEmail) {
                return res.json({ pending: true, newEmail: newEmail });
            }
        }

        return res.json({ pending: false });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ erro: "Erro ao verificar mudanças pendentes." });
    }
});

// --- SOLICITAR MUDANÇA DE EMAIL (envia link de confirmação para email atual) ---
router.post("/api/solicitar-mudanca-email", verificarToken, async (req, res) => {
    const { newEmail } = req.body;
    const currentEmail = req.userEmail;
    const db = getDatabase();

    if (!newEmail || newEmail.trim() === "") {
        return res.status(400).json({ erro: "Novo email não pode estar vazio." });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail.trim())) {
        return res.status(400).json({ erro: "Email inválido." });
    }

    // Verificar se o novo email já existe
    const existingUser = db.exec("SELECT * FROM user WHERE email = ?", [newEmail]);
    if (existingUser.length > 0 && existingUser[0].values.length > 0) {
        return res.status(400).json({ erro: "Este email já está cadastrado." });
    }

    const token = crypto.randomBytes(20).toString("hex");
    const now = Date.now();
    const confirmUrl = `/confirmar-mudanca-email?token=${token}`;

    try {
        // Salvar na tabela pending_users com o novo email
        db.run("INSERT OR REPLACE INTO pending_users (email, new_email, code, created_at) VALUES (?, ?, ?, ?)",
               [currentEmail, newEmail, token, now]);

        saveDatabase();

        // Enviar email para o EMAIL ATUAL pedindo confirmação via botão
        try {
            await transporter.sendMail({
                from: "\"Soja IA\" <suporte@sojaia.com>",
                to: currentEmail,
                subject: "Confirmação de Mudança de Email",
                text: `Você solicitou mudar seu email para: ${newEmail}\n\nPara confirmar a troca, acesse: ${confirmUrl}\n\nEste link expira em 1 minuto.\n\nSe não foi você, ignore este email.`,
                html: `
                    <p>Você solicitou mudar seu email para: <strong>${newEmail}</strong>.</p>
                    <p>Para confirmar a troca, clique no botão abaixo:</p>
                    <a href="${confirmUrl}" style="display:inline-block;padding:12px 20px;background:#008b8b;color:white;border-radius:8px;text-decoration:none;font-weight:700;">Confirmar troca de email</a>
                    <p>Este link expira em 1 minuto.</p>
                    <p>Se não foi você, ignore este email.</p>
                `
            });
        } catch (emailError) {
            console.warn("Aviso ao enviar email:", emailError.message);
            // Continua mesmo se o email falhar, para não bloquear o fluxo
        }

        return res.json({ mensagem: "Verifique seu email atual para confirmar a troca de email.", code: token });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ erro: "Erro ao solicitar mudança de email." });
    }
});

// --- CONFIRMAR MUDANÇA DE EMAIL VIA LINK ---
router.get("/confirmar-mudanca-email", (req, res) => {
    const { token } = req.query;
    const db = getDatabase();

    if (!token) {
        return res.status(400).send(`
            <html lang="pt-br">
            <head><meta charset="UTF-8"><title>Erro</title></head>
            <body style="font-family:Arial,sans-serif;padding:40px;">
                <h1>Token inválido.</h1>
                <p>O link de confirmação não pôde ser identificado.</p>
            </body>
            </html>
        `);
    }

    try {
        const result = db.exec("SELECT * FROM pending_users WHERE code = ?", [token]);
        if (result.length === 0 || result[0].values.length === 0) {
            return res.status(404).send(`
                <html lang="pt-br">
                <head><meta charset="UTF-8"><title>Erro</title></head>
                <body style="font-family:Arial,sans-serif;padding:40px;">
                    <h1>Link inválido ou expirado.</h1>
                    <p>Solicite uma nova troca de email no site.</p>
                </body>
                </html>
            `);
        }

        const pending = result[0].values[0];
        const currentEmail = pending[0];
        const newEmail = pending[5];
        const createdAt = pending[4];

        if (!newEmail) {
            return res.status(400).send(`
                <html lang="pt-br">
                <head><meta charset="UTF-8"><title>Erro</title></head>
                <body style="font-family:Arial,sans-serif;padding:40px;">
                    <h1>Dados incompletos.</h1>
                    <p>Não foi possível confirmar a troca de email.</p>
                </body>
                </html>
            `);
        }

        if (Date.now() - createdAt > 60000) {
            db.run("DELETE FROM pending_users WHERE code = ?", [token]);
            saveDatabase();
            return res.status(401).send(`
                <html lang="pt-br">
                <head><meta charset="UTF-8"><title>Link expirado</title></head>
                <body style="font-family:Arial,sans-serif;padding:40px;">
                    <h1>O link expirou.</h1>
                    <p>Solicite uma nova troca de email no site.</p>
                </body>
                </html>
            `);
        }

        const existingUser = db.exec("SELECT * FROM user WHERE email = ?", [newEmail]);
        if (existingUser.length > 0 && existingUser[0].values.length > 0) {
            db.run("DELETE FROM pending_users WHERE code = ?", [token]);
            saveDatabase();
            return res.status(400).send(`
                <html lang="pt-br">
                <head><meta charset="UTF-8"><title>Email já usado</title></head>
                <body style="font-family:Arial,sans-serif;padding:40px;">
                    <h1>O novo email já está em uso.</h1>
                    <p>Escolha outro email no site.</p>
                </body>
                </html>
            `);
        }

        db.run("UPDATE user SET email = ? WHERE email = ?", [newEmail, currentEmail]);
        db.run("DELETE FROM pending_users WHERE code = ?", [token]);
        saveDatabase();

        return res.send(`
            <html lang="pt-br">
            <head><meta charset="UTF-8"><title>Email atualizado</title></head>
            <body style="font-family:Arial,sans-serif;padding:40px;">
                <h1>Email atualizado com sucesso!</h1>
                <p>Você pode voltar ao site e fazer login com o novo email.</p>
                <p><a href="/login">Ir para login</a></p>
                <script>
                    try {
                        localStorage.setItem('emailChangeConfirmed', 'true');
                        localStorage.setItem('newEmailConfirmed', ${JSON.stringify(newEmail)});
                    } catch (e) {
                        console.error(e);
                    }
                </script>
            </body>
            </html>
        `);
    } catch (e) {
        console.error(e);
        return res.status(500).send(`
            <html lang="pt-br">
            <head><meta charset="UTF-8"><title>Erro</title></head>
            <body style="font-family:Arial,sans-serif;padding:40px;">
                <h1>Erro ao confirmar a troca de email.</h1>
                <p>Tente novamente mais tarde.</p>
            </body>
            </html>
        `);
    }
});

// --- CONFIRMAR MUDANÇA DE EMAIL ---
router.post("/api/confirmar-mudanca-email", verificarToken, (req, res) => {
    const { code, newEmail } = req.body;
    const currentEmail = req.userEmail;
    const now = Date.now();
    const db = getDatabase();

    if (!code || !newEmail) {
        return res.status(400).json({ erro: "Código e novo email são obrigatórios." });
    }

    try {
        const result = db.exec("SELECT * FROM pending_users WHERE email = ? AND code = ?", [currentEmail, code]);

        if (result.length === 0 || result[0].values.length === 0) {
            return res.status(401).json({ erro: "Código inválido ou expirado." });
        }

        const pendingData = result[0].values[0];
        const storedNewEmail = pendingData[5] || newEmail;

        if (!storedNewEmail) {
            return res.status(400).json({ erro: "Novo email não encontrado no pedido pendente." });
        }

        // Verificar se o código não expirou (1 minuto)
        if (now - pendingData[4] > 60000) {
            db.run("DELETE FROM pending_users WHERE email = ?", [currentEmail]);
            saveDatabase();
            return res.status(401).json({ erro: "O código expirou. Solicite um novo." });
        }

        // Atualizar o email do usuário
        db.run("UPDATE user SET email = ? WHERE email = ?", [storedNewEmail, currentEmail]);

        // Limpar os registros pendentes
        db.run("DELETE FROM pending_users WHERE email = ?", [currentEmail]);

        saveDatabase();

        return res.json({ mensagem: "Email atualizado com sucesso!", email: storedNewEmail });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ erro: "Erro ao confirmar mudança de email." });
    }
});

// --- SOLICITAR RESET DE SENHA ---
router.post("/api/solicitar-reset", async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const now = Date.now();
    const db = getDatabase();

    try {
        // Verificar se o email existe
        const user = db.exec("SELECT * FROM user WHERE email = ?", [email]);
        if (user.length === 0 || user[0].values.length === 0) {
            return res.status(404).json({ erro: "Email não encontrado." });
        }

        // Salvar código na tabela pending_users
        db.run("INSERT OR REPLACE INTO pending_users (email, code, created_at) VALUES (?, ?, ?)",
               [email, code, now]);
        saveDatabase();

        // Enviar email com o código
        await transporter.sendMail({
            from: "\"Soja IA\" <suporte@sojaia.com>",
            to: email,
            subject: "Código para Redefinir Senha",
            text: `Seu código de verificação é: ${code}. Ele expira em 1 minuto.`
        });

        res.json({ mensagem: "Código de verificação enviado para o seu email." });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao solicitar reset de senha." });
    }
});

router.post("/api/login", generalLimiter, async (req, res) => {
    const { email, password } = req.body;
    const db = getDatabase();
    try {
        const resSet = db.exec("SELECT * FROM user WHERE email = ?", [email]);
        
        if (resSet.length === 0 || resSet[0].values.length === 0) {
            return res.status(401).json({ erro: "E-mail ou senha incorretos." });
        }

        const userData = resSet[0].values[0]; 
        const senhaValida = await bcrypt.compare(password, userData[3]);

        if (!senhaValida) {
            const newAttempts = (userData[5] || 0) + 1;
            db.run("UPDATE user SET failed_attempts = ? WHERE email = ?", [newAttempts, email]);
            
            if (newAttempts >= 5) {
                await transporter.sendMail({
                    from: "\"Segurança Soja IA\" <seguranca@sojaia.com>",
                    to: email,
                    subject: "Alerta de Segurança: Tentativas de login",
                    text: "Detectamos várias tentativas falhas. Se não foi você, mude sua senha."
                });
            }
            saveDatabase();
            return res.status(401).json({ erro: "E-mail ou senha incorretos." });
        }

        db.run("UPDATE user SET failed_attempts = 0 WHERE email = ?", [email]);
        saveDatabase();
        
        const token = jwt.sign(
            { email: userData[2], nome: userData[1] }, 
            SECRET, 
            { expiresIn: "24h" }
        );

        res.json({ 
            mensagem: "Sucesso!", 
            token: token, 
            name_user: userData[1] 
        });

    } catch (e) { 
        console.error(e);
        res.status(500).json({ erro: "Erro interno no servidor." }); 
    }
});

router.post("/api/cadastrar", async (req, res) => {
    const { name_user, email, password } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const now = Date.now();
    const db = getDatabase();
    try {
        const hash = await bcrypt.hash(password, 10);
        db.run("INSERT OR REPLACE INTO pending_users (email, name_user, password, code, created_at) VALUES (?, ?, ?, ?, ?)", 
               [email, name_user, hash, code, now]);
        saveDatabase();

        await transporter.sendMail({
            from: "\"Soja IA\" <suporte@sojaia.com>",
            to: email,
            subject: "Seu Código de Verificação",
            text: `Seu código é ${code}. Ele expira em 1 minuto.`
        });
        res.json({ mensagem: "Código enviado com sucesso!" });
    } catch (e) { 
        res.status(500).json({ erro: "Erro ao processar cadastro." }); 
    }
});

router.post("/api/verificar-geral", verifyLimiter, async (req, res) => {
    const { email, code, newPassword, flow } = req.body;
    const now = Date.now();
    const db = getDatabase();

    if (!code || !flow) {
        return res.status(400).json({ erro: "Dados de verificação incompletos." });
    }

    if (flow === "reset" && !newPassword) {
        return res.status(400).json({ erro: "Nova senha não fornecida." });
    }

    if ((flow !== "delete") && !email) {
        return res.status(400).json({ erro: "Email não fornecido para verificação." });
    }

    try {
        const resSet = db.exec("SELECT * FROM pending_users WHERE email = ? AND code = ?", [email, code]);
        
        if (resSet.length === 0 || resSet[0].values.length === 0) {
            return res.status(401).json({ erro: "Código incorreto ou e-mail inválido." });
        }

        const userData = resSet[0].values[0]; 
        
        if (now - userData[4] > 60000) {
            db.run("DELETE FROM pending_users WHERE email = ?", [email]);
            saveDatabase();
            return res.status(401).json({ erro: "O código expirou. Solicite um novo." });
        }

        let token;
        let nomeUsuario = userData[1];

        if (flow === "reset") {
            const hash = await bcrypt.hash(newPassword, 10);
            db.run("UPDATE user SET password = ? WHERE email = ?", [hash, email]);
            token = jwt.sign({ email: email }, SECRET, { expiresIn: "24h" });
        } else {
            db.run("INSERT INTO user (name_user, email, password) VALUES (?, ?, ?)", 
                   [userData[1], userData[0], userData[2]]);
            
            token = jwt.sign({ email: userData[0], nome: userData[1] }, SECRET, { expiresIn: "24h" });
        }

        db.run("DELETE FROM pending_users WHERE email = ?", [email]);
        saveDatabase();

        res.json({ 
            mensagem: "Verificado com sucesso!", 
            token: token, 
            name_user: nomeUsuario 
        });

    } catch (err) { 
        console.error("Erro /api/verificar-geral:", err);
        res.status(500).json({ erro: "Erro interno na verificação." }); 
    }
});

router.post("/api/solicitar-exclusao", verificarToken, async (req, res) => {
    const email = req.userEmail; 
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const now = Date.now();
    const db = getDatabase();

    try {
        db.run("INSERT OR REPLACE INTO pending_users (email, code, created_at) VALUES (?, ?, ?)", 
               [email, code, now]);
        saveDatabase();

        await transporter.sendMail({ 
            from: "\"Soja IA\" <suporte@sojaia.com>", 
            to: email, 
            subject: "Confirmação de Exclusão de Conta", 
            text: `Seu código para excluir a conta é: ${code}. Se não foi você, ignore este e-mail.` 
        });

        res.json({ mensagem: "Código de confirmação enviado para o seu e-mail." });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao processar solicitação." });
    }
});

router.post("/api/confirmar-exclusao", verifyLimiter, verificarToken, (req, res) => {
    const { code } = req.body;
    const email = req.userEmail; 
    const db = getDatabase();

    try {
        const result = db.exec("SELECT * FROM pending_users WHERE email=? AND code=?", [email, code]);
        
        if (result.length > 0 && result[0].values.length > 0) {
            db.run("DELETE FROM user WHERE email = ?", [email]);
            db.run("DELETE FROM areas WHERE user_email = ?", [email]);
            db.run("DELETE FROM pending_users WHERE email = ?", [email]);
            
            saveDatabase();
            res.json({ mensagem: "Sua conta e todos os seus dados foram excluídos com sucesso." });
        } else {
            res.status(401).json({ erro: "Código inválido ou expirado." });
        }
    } catch (e) {
        res.status(500).json({ erro: "Erro ao excluir conta." });
    }
});

router.post("/api/salvar-area", verificarToken, (req, res) => {
    const { nome, coordenadas } = req.body;
    const email = req.userEmail;
    const db = getDatabase();

    if (!nome || !coordenadas) return res.status(400).json({ erro: "Dados incompletos." });

    try {
        const coordsString = JSON.stringify(coordenadas);
        db.run("INSERT OR REPLACE INTO areas (user_email, nome_grupo, coordenadas) VALUES (?, ?, ?)", 
               [email, nome, coordsString]);
        
        saveDatabase();
        res.json({ mensagem: "Área salva/atualizada com sucesso!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: "Erro ao salvar no banco de dados." });
    }
});

router.get("/api/minhas-areas", verificarToken, (req, res) => {
    const email = req.userEmail;
    const db = getDatabase();
    try {
        const result = db.exec("SELECT id, nome_grupo, coordenadas FROM areas WHERE user_email = ?", [email]);
        
        if (result.length === 0 || !result[0].values) {
            console.log("Nenhuma área encontrada no banco para:", email);
            return res.json([]);
        }
        
        const areas = result[0].values.map(v => ({
            id: v[0],
            nome: v[1],
            coordenadas: JSON.parse(v[2]) 
        }));

        console.log("Áreas enviadas para o front:", areas); 
        res.json(areas);
    } catch (err) {
        console.error("Erro no SELECT:", err);
        res.status(500).json({ erro: "Erro ao buscar áreas." });
    }
});

// --- ROTA DE HISTÓRICO DE FOTOS (CORRIGIDA) ---
router.get("/api/historico-fotos", verificarToken, (req, res) => {
    const email = req.userEmail;
    const db = getDatabase();
    try {
        // CORREÇÃO CRÍTICA: O WHERE vem antes do ORDER BY. 
        // Os parâmetros [email] agora estão fora das crases do SQL de forma limpa.
        const result = db.exec(
            `SELECT id, device_id, rota, local, observacao_texto, foto, criado_em 
             FROM registros_dispositivo 
             WHERE user_email = ?
             ORDER BY criado_em DESC`, 
            [email]
        );

        if (result.length === 0 || !result[0].values) {
            return res.json([]); // Retorna lista vazia se não houver registros
        }

        const colunas = result[0].columns;
        const linhas = result[0].values;

        // Mapeia as linhas transformando o Buffer do BLOB em String Base64
        const listaFotos = linhas.map(linha => {
            const registro = {};
            colunas.forEach((col, index) => {
                if (col === 'foto' && linha[index]) {
                    // O pacote sql.js retorna Uint8Array para campos BLOB. Convertemos para NodeJS Buffer e depois Base64.
                    const buffer = Buffer.from(linha[index]);
                    registro[col] = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                } else {
                    registro[col] = Math.round(linha[index]) === linha[index] ? parseInt(linha[index]) : linha[index];
                }
            });
            return registro;
        });

        res.json(listaFotos);

    } catch (e) {
        console.error("Erro ao buscar histórico de fotos:", e);
        res.status(500).json({ erro: "Erro interno ao buscar histórico de fotos." });
    }
});

// Rota para buscar dispositivos do usuário logado
router.get("/api/devices", verificarToken, (req, res) => {
    const email = req.userEmail;
    const db = getDatabase();

    try {
        // Busca os dispositivos vinculados ao email do usuário
        const result = db.exec("SELECT id, rota FROM IoT WHERE user_email = ?", [email]);

        if (result.length === 0 || !result[0].values) {
            return res.json({ devices: [] });
        }

        // Formata os dados para o frontend
        const devices = result[0].values.map(row => ({
            device_id: row[0],
            rota: row[1]
        }));

        res.json(devices);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: "Erro ao buscar dispositivos." });
    }
});



//
// Rota para atualizar a rota vinculada ao ESP32
//
router.post("/api/iot/update-route", verificarToken, async (req, res) => {
    const { device_id, rota } = req.body;
    const user_email = req.userEmail; // Obtido do verificarToken
    const db = getDatabase();

    if (!device_id || !rota) {
        return res.status(400).json({ erro: "ID do dispositivo e rota são obrigatórios." });
    }

    try {
        // Atualiza a rota apenas se o dispositivo pertencer ao utilizador logado
        // Isso evita que um utilizador mude a rota de um dispositivo de outra pessoa
        const result = db.exec(
            "UPDATE IoT SET rota = ? WHERE id = ? AND user_email = ?",
            [rota, device_id, user_email]
        );

        saveDatabase(); // Importante para persistir no ficheiro .sqlite ou JSON

        res.json({ mensagem: "Rota atualizada com sucesso!" });
    } catch (e) {
        console.error("Erro ao atualizar rota IoT:", e);
        res.status(500).json({ erro: "Erro interno ao atualizar a rota." });
    }
});



//
// Rotas para dados IoT e clima
//

router.post("/api/iot/dados", async (req, res) => {
    // 1. Extraímos os dados usando os novos nomes definidos no outputDoc do ESP32
    const { 
        device_id, 
        grupo_local, 
        latitude, 
        longitude, 
        temperature, 
        humidity, 
        noxious_gas, 
        volatile_gas, 
        soil_humidity,
        rain,
        timestamp 
    } = req.body;

    const db = getDatabase();

    // Validação básica
    if (!device_id) {
        return res.status(400).json({ erro: "ID do dispositivo ausente." });
    }

    try {
        // 2. Verificar a qual usuário este device_id pertence
        const deviceResult = db.exec("SELECT user_email FROM IoT WHERE id = ?", [device_id]);
        
        if (deviceResult.length === 0 || !deviceResult[0].values) {
            return res.status(403).json({ erro: "Dispositivo não registrado ou não autorizado." });
        }
        
        const user_email = deviceResult[0].values[0][0];
        
        // Nota: Usamos o 'timestamp' enviado pelo ESP32 em vez do DEFAULT do banco
        db.run(
            `INSERT INTO climate_data (
                device_id, user_email, rota, latitude, longitude, 
                temperature, air_humidity, noxious_gas, volatile_gas, 
                soil_humidity, rain, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                device_id, 
                user_email, 
                grupo_local, 
                latitude, 
                longitude, 
                temperature, 
                humidity, 
                noxious_gas, 
                volatile_gas, 
                soil_humidity,
                rain,
                timestamp // O formato YYYY-MM-DD_HH:MM:SS é compatível com SQLite
            ]
        );

        saveDatabase();
        console.log(`[HTTP] Dados recebidos do sensor ${device_id}`);
        res.json({ mensagem: "Dados registrados com sucesso!" });

    } catch (e) {
        console.error("Erro ao processar dados IoT:", e);
        res.status(500).json({ erro: "Erro interno no servidor." });
    }
});

// --- No seu router.js ---
router.get("/api/data/:device_id", verificarToken, async (req, res) => {
    const { device_id } = req.params;
    const user_email = req.userEmail;
    const db = getDatabase();

    try {
        // CORREÇÃO 1: Buscamos aceitando o ID tanto como Texto quanto como Número (Evita o bug de lista vazia no SQLite)
        const query = `
            SELECT id, device_id, user_email, rota, latitude, longitude, 
                   temperature, air_humidity, noxious_gas, volatile_gas, 
                   soil_humidity, rain, timestamp 
            FROM climate_data 
            WHERE (device_id = ? OR device_id = ?) AND user_email = ? 
            ORDER BY timestamp DESC
        `;

        const idNumero = !isNaN(device_id) ? Number(device_id) : device_id;
        const data = db.exec(query, [device_id, idNumero, user_email]);
        
        if (data.length === 0 || !data[0].values) {
            return res.json([]);
        }
        
        const formattedData = data[0].values.map(row => ({
            id: row[0],
            device_id: row[1],
            user_email: row[2],
            rota: row[3],
            latitude: Number(row[4]),
            longitude: Number(row[5]),
            temperature: row[6],
            air_humidity: row[7],
            humidity: row[7],
            noxious_gas: row[8],
            volatile_gas: row[9],
            soil_humidity: row[10],
            rain: row[11],
            estaChovendo: row[11],
            timestamp: row[12]
        }));

        res.json(formattedData);
    } catch (e) {
        console.error("Erro ao buscar dados IoT:", e);
        res.status(500).json({ erro: "Erro interno ao buscar dados IoT." });
    }
});



// --- VERSÃO REVOLUCIONÁRIA USANDO FS E IO_HANDLER CUSTOMIZADO ---
async function loadModelIA() {
    try {
        // 1. Definimos os caminhos físicos absolutos no disco rígido
        const jsonPath = path.join(__dirname, "public", "modelo_ia", "model.json");
        const modelDir = path.dirname(jsonPath);

        // 2. Criamos o nosso próprio manipulador de E/S (IOHandler)
        const nodeFSHandler = {
            load: async () => {
                // A. Lê o arquivo de arquitetura (model.json) usando o FS normal
                const modelJsonRaw = fs.readFileSync(jsonPath, "utf8");
                const modelTopologyAndWeights = JSON.parse(modelJsonRaw);

                // B. Isola a topologia do modelo (as camadas da IA)
                const modelTopology = modelTopologyAndWeights.modelTopology;
                const weightsManifest = modelTopologyAndWeights.weightsManifest;

                // C. Se o modelo tiver pesos binários associados (nosso arquivo .bin)
                let weightSpecs = [];
                let weightData = new ArrayBuffer(0);

                if (weightsManifest && weightsManifest.length > 0) {
                    weightSpecs = weightsManifest[0].weights;
                    
                    // Descobre o nome do arquivo binário (Ex: group1-shard1of1.bin)
                    const binFileName = weightsManifest[0].paths[0];
                    const binPath = path.join(modelDir, binFileName);

                    // Lê o arquivo .bin bruto do disco rígido e o converte em ArrayBuffer
                    const binBuffer = fs.readFileSync(binPath);
                    weightData = binBuffer.buffer.slice(
                        binBuffer.byteOffset, 
                        binBuffer.byteOffset + binBuffer.byteLength
                    );
                }

                // D. Retorna os dados mastigados para o TensorFlow.js
                return {
                    modelTopology: modelTopology,
                    weightSpecs: weightSpecs,
                    weightData: weightData
                };
            }
        };

        // 3. Passamos o nosso manipulador personalizado para a função do TensorFlow!
        modelIA = await tf.loadLayersModel(nodeFSHandler);

        // 4. Carrega as labels de diagnóstico (labels.txt)
        const labelsPath = path.join(__dirname, "labels.txt");
        if (fs.existsSync(labelsPath)) {
            classNames = fs.readFileSync(labelsPath, "utf-8")
                .split("\n")
                .map(line => line.trim())
                .filter(line => line.length > 0);
        }

        console.log("🤖 [IA] Modelo carregado com sucesso via Custom Node FS Handler!");
    } catch (err) {
        console.error("❌ [IA] Erro ao carregar o modelo ou labels via Custom IO:", err);
    }
}

router.post("/api/iot/upload", binarioBodyParser, async (req, res) => {
    const deviceIdHeader = req.headers['x-device-id']; //
    const grupoLocalHeader = req.headers['x-grupo-local']; //

    if (!deviceIdHeader || !grupoLocalHeader) {
        return res.status(400).json({ erro: "Headers de identificação ausentes." }); //
    }

    if (!req.body || req.body.length === 0) {
        return res.status(400).json({ erro: "Buffer da foto vazio ou inválido." }); //
    }

    const db = getDatabase(); //

    try {
        // 1. Buscar o e-mail do proprietário associado ao dispositivo
        const deviceQuery = db.exec("SELECT user_email FROM IoT WHERE id = ?", [deviceIdHeader]); //
        
        if (deviceQuery.length === 0 || !deviceQuery[0].values) {
            return res.status(404).json({ erro: "Dispositivo IoT não cadastrado no sistema." }); //
        }
        
        console.log(`IoT ${deviceIdHeader}`);
        
        const userEmail = deviceQuery[0].values[0][0]; //

        // 2. Extração de Metadados do Nome do Arquivo (Data e Localização)
        let dataFormatadaBanco = new Date().toISOString().slice(0, 19).replace('T', ' '); //
        let localizacaoGps = "Não informada"; //

        const filenameOriginal = req.query.name || ""; //
        if (filenameOriginal.length > 0) {
            const cleanName = filenameOriginal.replace("/fotos/", "").replace(".JPG", "").replace(".jpg", ""); //
            const partes = cleanName.split("_"); //

            if (partes.length >= 4) {
                const dataParte = partes[0]; //
                const horaParte = partes[1].replace(/-/g, ":"); //
                dataFormatadaBanco = `${dataParte} ${horaParte}`; //
                
                const possivelGps = partes[partes.length - 1]; //
                if (possivelGps.includes(",")) {
                    localizacaoGps = possivelGps; //
                }
            }
        }

        // 3. EXECUÇÃO DA INFERÊNCIA DA IA
        let resultadoDiagnostico = "Classificação indisponível (IA descarregada)";

        if (modelIA) {
            try {
                // Redimensiona o buffer bruto para 224x224 pixels usando Sharp (Equivalente ao ImageOps.fit)
                const imageBuffer224 = await sharp(req.body)
                    .resize(224, 224, { fit: 'cover' })
                    .raw() // Extrai os pixels em formato de array puro (RGB de 8 bits)
                    .toBuffer();

                // Converte o buffer bruto em um Tensor 3D [shape: (224, 224, 3)]
                const tensorImagem = tf.tensor3d(new Uint8Array(imageBuffer224), [224, 224, 3]);

                // Normalização matemática idêntica ao script Python: (img / 127.5) - 1
                const tensorNormalizado = tensorImagem.toFloat().div(tf.scalar(127.5)).sub(tf.scalar(1));

                // Expande a dimensão para simular o lote (batch): shape final (1, 224, 224, 3)
                const inputBatch = tensorNormalizado.expandDims(0);

                // Executa a inferência e extrai os resultados sincronamente
                const prediction = modelIA.predict(inputBatch);
                const dataPrediction = await prediction.data();

                // Encontra o maior índice previsto (Equivalente ao np.argmax)
                const maxIndex = prediction.argMax(1).dataSync()[0];

                if (classNames.length > maxIndex) {
                    resultadoDiagnostico = classNames[maxIndex]; // Exemplo: "1 largata"
                } else {
                    resultadoDiagnostico = `Classe detectada: Índice ${maxIndex}`;
                }

                // Limpeza manual de memória para evitar vazamento de memória de tensores (Memory Leaks)
                tf.dispose([tensorImagem, tensorNormalizado, inputBatch, prediction]);

            } catch (iaError) {
                console.error("Erro durante o processamento da imagem pela IA:", iaError);
                resultadoDiagnostico = "Erro interno no processamento do diagnóstico.";
            }
        }

        // 4. Inserir os dados processados e a resposta da IA no SQLite
        db.run(
            `INSERT INTO registros_dispositivo (
                user_email, device_id, rota, local, observacao_texto, foto, criado_em
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`, //
            [
                userEmail,              // e-mail correspondente ao hardware
                deviceIdHeader,         // ID do dispositivo
                grupoLocalHeader,       // Rota vinculada
                localizacaoGps,         // Coordenadas extraídas do nome
                resultadoDiagnostico,   // Mudança solicitada: Guarda o retorno da IA na tabela
                req.body,               // Buffer da foto (BLOB)
                dataFormatadaBanco      // Data correta recuperada do nome do arquivo
            ]
        );

        saveDatabase(); // Persiste no arquivo SQLite
        console.log(`[HTTP] Diagnóstico finalizado: "${resultadoDiagnostico}" para dispositivo: ${deviceIdHeader}`);

        return res.status(200).json({ 
            status: "sucesso", 
            diagnostico: resultadoDiagnostico,
            mensagem: "Dados salvos e analisados com sucesso." 
        });

    } catch (error) {
        console.error("Erro crítico na rota de upload de foto:", error); //
        return res.status(500).json({ erro: "Erro interno ao processar e salvar a foto." }); //
    }
});

router.post("/api/iot/register", verificarToken, async (req, res) => {
    const { device_id, rota } = req.body;
    const user_email = req.userEmail;
    const db = getDatabase();

    // 1. Convertemos para Number e removemos espaços
    // Se device_id for "123", vira o número 123. 
    // Se for "ABC", vira NaN.
    const device_id_number = device_id ? Number(device_id) : null;

    // 2. Validação de Segurança:
    // Verificamos se é nulo, se NÃO é um número (isNaN) ou se é um número negativo
    if (device_id_number === null || isNaN(device_id_number) || device_id_number <= 0 || !rota) {
        return res.status(400).json({ 
            erro: "ID do dispositivo inválido. Deve ser um número inteiro positivo." 
        });
    }

    try {
        // 3. O SQLite tratará o valor como INTEGER se a tabela estiver configurada assim
        db.run(
            "INSERT OR REPLACE INTO IoT (id, user_email, rota) VALUES (?, ?, ?)", 
            [device_id_number, user_email, rota]
        );
        
        saveDatabase();
        res.json({ 
            mensagem: "Dispositivo IoT registrado com sucesso!",
            device_id: device_id_number // Retorna o número limpo
        });
    } catch (e) {
        console.error("Erro ao registrar dispositivo IoT:", e);
        res.status(500).json({ erro: "Erro interno ao registrar dispositivo IoT." });
    }
});

router.get("/api/iot/locais", async (req, res) => {
    const device_id = req.headers['x-mac']; 
    const db = getDatabase();

    try {
        // 1. Buscamos o nome_grupo e as coordenadas da tabela 'areas'
        // Fazemos o JOIN entre IoT e areas através do nome_grupo/rota
        const result = db.exec(`
            SELECT a.nome_grupo, a.coordenadas 
            FROM areas a
            JOIN IoT i ON i.rota = a.nome_grupo
            WHERE i.id = ?`, [device_id]);

        if (result.length === 0 || !result[0].values) {
            return res.json({}); 
        }

        const nomeGrupo = result[0].values[0][0];
        const coordenadasRaw = result[0].values[0][1]; // Isso é a string JSON do banco

        // 2. Processar as coordenadas
        // Como o banco salva como TEXT, precisamos transformar em array/objeto
        let listaCoordenadas = [];
        try {
            const coordsArray = JSON.parse(coordenadasRaw);
            
            // Se você quiser enviar cada ponto (lat/lng) como uma string na lista:
            listaCoordenadas = coordsArray.map(ponto => 
                `Lat: ${ponto.lat}, Lng: ${ponto.lng}`
            );
        } catch (parseError) {
            console.error("Erro ao processar JSON de coordenadas:", parseError);
            listaCoordenadas = ["Erro no formato das coordenadas"];
        }

        // 3. Formata a resposta para o ESP32
        // O ESP32 receberá: {"NomeDoGrupo": ["Lat: -23.04..., Lng: -50.08...", "..."]}
        const respostaParaESP = {
            [nomeGrupo]: listaCoordenadas
        };

        res.json(respostaParaESP);

    } catch (e) {
        console.error("Erro ao buscar locais para o ESP32:", e);
        res.status(500).json({ erro: "Erro interno ao buscar locais." });
    }
});

// --- VERSÃO COM SUPER DEBUG PARA DIAGNÓSTICO ---
router.get("/api/iot/check-status", async (req, res) => {
    // Captura o ID do header enviado pelo ESP32 (Express deixa tudo em minúsculo)
    const device_id = req.headers['x-mac']; 
    
    const db = getDatabase();

    if (!device_id) {
        console.warn("⚠️ [AVISO] Requisição rejeitada: Header 'x-mac' veio vazio ou ausente.");
        return res.status(400).json({ erro: "ID do dispositivo não fornecido." });
    }

    try {
        // Verifica se o dispositivo está na tabela IoT
        const result = db.exec("SELECT id FROM IoT WHERE id = ?", [device_id]);

        // Se o resultado estiver vazio, o dispositivo não está registrado
        if (result.length === 0 || !result[0].values) {
            console.error(`❌ [BLOQUEADO] Dispositivo com ID ${device_id} NÃO existe na tabela IoT.`);
            return res.status(404).json({ registrado: false, erro: "erro no dispositivo" });
        }

        const idEncontrado = result[0].values[0][0];
        return res.status(200).json({ registrado: true, message: "Dispositivo autorizado." });

    } catch (e) {
        console.error("💥 [ERRO CRÍTICO] Falha interna ao checar status do ESP32:", e);
        return res.status(500).json({ erro: "Erro interno no servidor." });
    }
});


module.exports = router;
