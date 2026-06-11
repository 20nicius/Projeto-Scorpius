const loginForm = document.getElementById('loginForm');
const btnEntrar = document.getElementById('btnEntrar');
const passInput = document.getElementById('passInput');
const eyeIcon = document.getElementById('eyeIcon');
const timerDisplay = document.getElementById('timer');
const lockdownArea = document.getElementById('lockdownArea');
let countdownInterval;

// --- REDIRECIONAMENTO AUTOMÁTICO (LOGADO) ---
(function () {
    const token = localStorage.getItem('token');
    if (token) {
        window.location.href = "/";
    }
})();

eyeIcon.addEventListener('click', function () {
    const isPassword = passInput.type === 'password';
    passInput.type = isPassword ? 'text' : 'password';
    this.classList.toggle('fa-eye');
    this.classList.toggle('fa-eye-slash');
});

function showToast(message, isError = true) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.className = 'toast-message ' + (isError ? 'toast-error' : 'toast-success');
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 3000);
}

function startCountdown(seconds) {
    clearInterval(countdownInterval);
    lockdownArea.style.display = 'block';
    btnEntrar.disabled = true;

    let timer = seconds;
    countdownInterval = setInterval(() => {
        const mins = Math.floor(timer / 60);
        const secs = timer % 60;
        timerDisplay.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        if (--timer < 0) {
            clearInterval(countdownInterval);
            lockdownArea.style.display = 'none';
            btnEntrar.disabled = false;
            showToast("Bloqueio encerrado. Pode tentar novamente.", false);
        }
    }, 1000);
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = passInput.value;

    btnEntrar.innerText = "A verificar...";
    btnEntrar.disabled = true;

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            showToast("Login realizado com sucesso!", false);
            localStorage.setItem('token', data.token);
            localStorage.setItem('userName', data.name_user);
            setTimeout(() => window.location.href = "/", 1000);
        } else {
            if (response.status === 429) {
                showToast("Muitas tentativas falhas.");
                startCountdown(data.retryAfter || 1800);
            } else {
                showToast(data.erro || "E-mail ou senha incorretos.");
                btnEntrar.disabled = false;
                btnEntrar.innerText = "Entrar";
            }
        }
    } catch (err) {
        showToast("Erro ao conectar ao servidor.");
        btnEntrar.disabled = false;
        btnEntrar.innerText = "Entrar";
    }
});