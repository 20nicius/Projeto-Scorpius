async function parearDispositivo() {
    const token = localStorage.getItem('token');
    if (!token) return alert("Você precisa estar logado!");

    // UUIDs PADRÃO NORDIC UART (Ajustados para bater com o ESP32)
    const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const RX_CHAR_UUID      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Site Escreve (wifi: e ok)
    const TX_CHAR_UUID      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Site Lê (ID:)

    let deviceIdNumeral = null; // Variável para armazenar o ID recebido

    try {
        // 1. Solicita o dispositivo Bluetooth
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'ESP32' }],
            optionalServices: [UART_SERVICE_UUID]
        });

        console.log("Conectando ao GATT Server...");
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(UART_SERVICE_UUID);
        
        const rxCharacteristic = await service.getCharacteristic(RX_CHAR_UUID);
        const txCharacteristic = await service.getCharacteristic(TX_CHAR_UUID);

        const decoder = new TextDecoder('utf-8');

        // Adiciona um listener para notificações da característica TX
        txCharacteristic.addEventListener('characteristicvaluechanged', event => {
            const value = event.target.value;
            const respESP = decoder.decode(value).trim();
            console.log("Notificação TX recebida:", respESP);

            if (respESP.startsWith("ID:")) {
                deviceIdNumeral = respESP.replace("ID:", "");
                console.log("ID Identificado via notificação:", deviceIdNumeral);
            }
        });
        await txCharacteristic.startNotifications();
        console.log("Notificações da característica TX iniciadas.");

        // 2. Coleta de redes Wi-Fi (Mínimo 1)
        let redesObjeto = {}; 
        let ssid = prompt("Nome do Wi-Fi (SSID):");
        if (!ssid) return;
        let senha = prompt(`Senha para ${ssid}:`);
        redesObjeto[ssid] = senha; 

        // 3. Envia o comando Wi-Fi
        const mensagemFinal = `wifi:${JSON.stringify(redesObjeto)}\n`; 
        const encoder = new TextEncoder();

        console.log("Enviando credenciais...");
        await rxCharacteristic.writeValue(encoder.encode(mensagemFinal));
        
        // 4. Aguarda a resposta do ID vinda do ESP32 via notificação
        console.log("Aguardando identificação (ID) via notificação...");
        // Espera até que o deviceIdNumeral seja preenchido pela notificação
        const maxWaitTime = 10000; // 10 segundos
        const startTime = Date.now();
        while (deviceIdNumeral === null && (Date.now() - startTime < maxWaitTime)) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Espera 100ms
        }

        if (deviceIdNumeral === null) {
            throw new Error("Timeout: Não foi possível receber o ID do dispositivo.");
        }

        // 5. ENVIA O 'OK' PARA O ESP32 (Libera o desligamento do BLE lá)
        await rxCharacteristic.writeValue(encoder.encode("ok\n"));
        console.log("Confirmação 'ok' enviada. O ESP32 agora pode conectar ao WiFi.");

        // 6. Pergunta a rota e registra no servidor Node.js
        const rota = prompt(`Sensor Detectado: ${deviceIdNumeral}\nDigite o nome do local (ex: Estufa 01):`);
        if (!rota) return;

        const response = await fetch('/api/iot/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                device_id: deviceIdNumeral, 
                rota: rota 
            })
        });

        if (response.ok) {
            alert(`Sucesso! Sensor ${deviceIdNumeral} configurado e registrado.`);
        } else {
            const err = await response.json();
            alert("Erro no registro: " + err.erro);
        }

    } catch (error) {
        console.error("Erro Bluetooth:", error);
        alert("Falha na configuração: " + error.message);
    }
}

// Execute essa função quando a página carregar
document.addEventListener('DOMContentLoaded', carregarPainelDispositivos, atualizarRota);

async function carregarPainelDispositivos() {
    const container = document.getElementById('dispositivos-container');
    const token = localStorage.getItem('token');

    if (!token) return;

    try {
        // 1. Buscamos as áreas/rotas do usuário em paralelo ou antes
        const responseAreas = await fetch('/api/minhas-areas', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const listaAreas = await responseAreas.json(); // Array de áreas [{id, nome, coordenadas}, ...]

        // 2. Buscamos os dispositivos vinculados
        const responseDevices = await fetch('/api/devices', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await responseDevices.json();

        if (data.devices && data.devices.length > 0) {
            container.innerHTML = '';

            data.devices.forEach(dev => {
                const deviceElement = document.createElement('div');
                deviceElement.className = 'device-item';

                // 3. Geramos dinamicamente as opções do select com base nas áreas do usuário
                // Se a área do laço for igual à rota atual do dispositivo, adicionamos o atributo 'selected'
                const optionsHTML = listaAreas.map(area => {
                    const isSelected = area.nome === dev.rota ? 'selected' : '';
                    return `<option value="${area.nome}" ${isSelected}>${area.nome}</option>`;
                }).join('');

                // 4. Montamos o HTML injetando a opção padrão ("Sem definição") e a lista dinâmica
                deviceElement.innerHTML = `
                    <div class="device-info">
                        <strong>ESP32-${dev.device_id}</strong>
                    </div>
                    <select class="route-select" data-id="${dev.device_id}">
                        <option value="Sem definição" ${!dev.rota || dev.rota === 'Sem definição' ? 'selected' : ''}>Sem definição</option>
                        ${optionsHTML}
                    </select>
                `;

                container.appendChild(deviceElement);

                // 5. O evento 'change' continua funcionando exatamente igual, pegando o value selecionado
                const select = deviceElement.querySelector('.route-select');
                select.addEventListener('change', (e) => atualizarRota(dev.device_id, e.target.value));
            });
        }
    } catch (error) {
        console.error("Erro ao carregar dispositivos e áreas:", error);
    }
}

// Função para enviar a nova rota ao servidor
async function atualizarRota(deviceId, novaRota) {
    const token = localStorage.getItem('token');
    try {
        const response = await fetch('/api/iot/update-route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ device_id: deviceId, rota: novaRota })
        });

        if (response.ok) {
            alert("Rota atualizada com sucesso!");
        } else {
            alert("Erro ao atualizar rota.");
        }
    } catch (error) {
        console.error("Erro na requisição:", error);
    }
}