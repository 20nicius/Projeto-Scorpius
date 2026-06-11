// --- FUNCIONALIDADES AVANÇADAS DE CLIMA E MAPA ---

// Variáveis para Debug
let debugDeviceId = null;
let isDebugDataEnabled = false;
let debugData = []; // Dados gerados no frontend para debug

// Verificar Query Parameters para Debug
function checkDebugParams() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // ?teste--D : Gerar device_id aleatório
    if (urlParams.has('teste--D')) {
        debugDeviceId = 'DEBUG-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        console.log('🐞 Debug Mode: Device ID gerado:', debugDeviceId);
        showToast('Debug: Device ID gerado: ' + debugDeviceId, false);
    }

    // ?teste--A : Habilitar geração de dados ao clicar no mapa
    if (urlParams.has('teste--A')) {
        isDebugDataEnabled = true;
        console.log('🐞 Debug Mode: Geração de dados ao clicar habilitada');
        showToast('Debug: Clique no mapa para gerar dados', false);
    }
}

// Carregar dados climáticos do grupo selecionado
async function loadClimateDataForGroup(groupName) {
    const token = localStorage.getItem('token');
    console.log("%c🚀 [DEBUG] Iniciando busca para o grupo:", "color: #008b8b; font-weight: bold;", groupName);
    
    try {
        // 1. Monitorar chamada de Dispositivos
        const devicesResponse = await fetch('/api/devices', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const devices = await devicesResponse.json();
        
        console.log("📦 [DEBUG] Retorno bruto de /api/devices:", devices);
        console.log("🤔 [DEBUG] O tipo do retorno de devices é:", Array.isArray(devices) ? "Array/Lista ✅" : typeof devices);

        // Proteção extra caso o backend ainda envie o objeto encapsulado
        const listaDeDispositivos = Array.isArray(devices) ? devices : (devices.devices || []);
        console.log("🔧 [DEBUG] Lista real que será iterada no loop:", listaDeDispositivos);

        let dadosCombinados = [];

        // 2. Monitorar a busca de dados de cada dispositivo
        for (const dev of listaDeDispositivos) {
            const idDoDispositivo = dev.device_id || dev.id;
            console.log(`📡 [DEBUG] Solicitando dados para o dispositivo ID: ${idDoDispositivo}`);

            const dataResponse = await fetch(`/api/data/${idDoDispositivo}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const deviceData = await dataResponse.json();
            
            console.log(`📥 [DEBUG] Dados recebidos do dispositivo [${idDoDispositivo}]:`, deviceData);

            if (Array.isArray(deviceData)) {
                dadosCombinados = dadosCombinados.concat(deviceData);
            } else {
                console.warn(`⚠️ [AVISO] Os dados vindos do dispositivo ${idDoDispositivo} não vieram como Array:`, deviceData);
            }
        }

        console.log("📊 [DEBUG] TODOS os dados acumulados de todos os dispositivos ANTES de filtrar por rota:", dadosCombinados);

        // 3. Monitorar o filtro por Nome do Grupo (Rota) com tolerância total
        window.climateData = dadosCombinados.filter(l => {
            // Pega o valor da rota tentando todas as propriedades possíveis que o backend possa ter enviado
            const valorRotaBanco = l.rota || l.group_name || l.group || '';
            
            const rotaNoBanco = String(valorRotaBanco).trim().toLowerCase();
            const grupoNoFrontend = String(groupName || '').trim().toLowerCase();
            
            // Compara se são iguais ou se um contém o outro (evita problemas com espaços)
            const bateu = rotaNoBanco === grupoNoFrontend || 
                          (rotaNoBanco !== '' && grupoNoFrontend.includes(rotaNoBanco));
            
            return bateu;
        });

        console.log(`🎯 [DEBUG] Total de registros filtrados que vão para a tela para o grupo "${groupName}":`, window.climateData.length, window.climateData);

        if (window.climateData.length === 0) {
            console.warn(`❌ [ALERTA] A lista foi limpa no filtro! Forçando exibição completa para não quebrar a tela.`);
            // SINAL DE EMERGÊNCIA: Se o filtro zerar tudo por incompatibilidade de nome, 
            // mostramos todos os dados capturados para o mapa e a tabela não ficarem vazios!
            window.climateData = dadosCombinados; 
        }

        // 4. Chamar renderizadores
        console.log("🎨 [DEBUG] Chamando funções de mapa e tabela...");
        updateMapWithClimateData(window.climateData);
        renderTableData();

    } catch (error) {
        console.error("🚨 [ERRO CRÍTICO] Falha catastrófica no fluxo de dados climáticos:", error);
    }
}

// Gerar dados aleatórios para debug ao clicar no mapa
function generateDebugData(lat, lng) {
    if (!isDebugDataEnabled) return;

    const timestamp = new Date().toISOString();
    const newData = {
        id: 'debug-' + Date.now(),
        device_id: debugDeviceId || 'DEBUG-DEFAULT',
        latitude: lat,
        longitude: lng,
        timestamp: timestamp,
        temperature: (Math.random() * (40 - 15) + 15).toFixed(2),
        air_humidity: (Math.random() * (100 - 30) + 30).toFixed(2),
        noxious_gas: (Math.random() * 100).toFixed(2),
        volatile_gas: (Math.random() * 100).toFixed(2),
        soil_humidity: (Math.random() * 100).toFixed(2),
        estaChovendo: Math.random() > 0.8 ? 1 : 0 // Simulação de chuva
    };

    debugData.push(newData);
    window.climateData = (window.climateData || []).concat([newData]);
    
    updateMapWithClimateData();
    renderTableData();
    showToast('Dados de debug gerados no ponto clicado', false);
}

// Obter os valores de um tipo de clima específico
function getClimateValues(climateType) {
    const values = [];
    if (!window.climateData) return values;
    
    window.climateData.forEach(point => {
        let value = 0;
        switch(climateType) {
            case 'temperature': value = parseFloat(point.temperature) || 0; break;
            case 'humidity': value = parseFloat(point.air_humidity) || 0; break;
            case 'noxious_gas': value = parseFloat(point.noxious_gas) || 0; break;
            case 'volatile_gas': value = parseFloat(point.volatile_gas) || 0; break;
            case 'soil_humidity': value = parseFloat(point.soil_humidity) || 0; break;
        }
        values.push(value);
        console.log(value);
    });
    
    return values;
}

// Normalizar valores para o heatmap (0-1)
function normalizeValue(value, min, max) {
    if (max === min) return 0.5; // Se todos os valores são iguais
    return (value - min) / (max - min);
}

// Atualizar mapa com dados climáticos
function updateMapWithClimateData() {
    if (!window.climateData || window.climateData.length === 0) return;

    // Remover camada anterior
    if (window.heatLayer) {
        window.map.removeLayer(window.heatLayer);
    }

    // Obter valores do tipo de clima selecionado
    const climateType = window.selectedClimate;
    const values = getClimateValues(climateType);
    
    if (values.length === 0) {
        console.warn('Nenhum valor encontrado para o tipo de clima:', climateType);
        return;
    }

    // Calcular min e max para normalização
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    
    console.log(`Heatmap para ${climateType}: Min=${minValue}, Max=${maxValue}`);

    // Preparar dados para o heatmap (formato: [lat, lng, valor normalizado])
    const heatPoints = window.climateData.map((point, index) => {
        const value = values[index];
        const normalizedValue = normalizeValue(value, minValue, maxValue);
        
        return [
            parseFloat(point.latitude),
            parseFloat(point.longitude),
            normalizedValue
        ];
    });

    // Usar L.heatLayer (leaflet.heat) com gradiente apropriado
    if (typeof L.heatLayer === 'function') {
        const gradientConfig = window.climateGradients[climateType];
        window.heatLayer = L.heatLayer(heatPoints, {
            radius: 50,
            blur: 30,
            maxZoom: 14,
            max: 1.0,
            gradient: createGradientObject(gradientConfig.colors)
        }).addTo(window.map);
        
        console.log('Heatmap criado com sucesso');
    } else {
        console.warn('L.heatLayer não está disponível. Verifique se leaflet.heat foi carregado.');
    }

// Variável para controlar o tempo da última atualização
let lastUpdate = 2900;

window.map.on('zoom', function() {
    const now = Date.now();
    
    // Só executa se tiver passado mais de 100 milissegundos desde a última vez
    if (/*now - lastUpdate > 100*/0) { 
        if (window.heatLayer) {
            const currentZoom = window.map.getZoom();
            
            // Cálculo do raio (ajuste os números 3.5 e 2.1 se precisar de bolhas maiores/menores)
            let dynamicRadius = currentZoom * 3.5; 
            let dynamicBlur = currentZoom * 2.1;

            if (dynamicRadius < 10) dynamicRadius = 10;
            if (dynamicBlur < 8) dynamicBlur = 8;

            window.heatLayer.setOptions({
                radius: dynamicRadius,
                blur: dynamicBlur
            });
            
            lastUpdate = now; // Atualiza o cronômetro
        }
    }
});
    
    updateGradientRange();
}

// Criar objeto de gradiente para o Leaflet Heat
function createGradientObject(colors) {
    const gradient = {};
    colors.forEach((color, index) => {
        gradient[index / (colors.length - 1)] = color;
    });
    return gradient;
}

// Atualizar range do gradiente na legenda
function updateGradientRange() {
    if (!window.climateData || window.climateData.length === 0) return;

    const values = getClimateValues(window.selectedClimate);
    
    if (values.length === 0) return;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);

    const gradientRange = document.getElementById('gradientRange');
    if (gradientRange) {
        gradientRange.textContent = `Min: ${min.toFixed(2)} | Máx: ${max.toFixed(2)} | Média: ${avg}`;
    }
}

// Renderizar Tabela de Dados (Estilo record.html)
function renderTableData() {
    // 1. Captura o corpo da tabela
    const tbody = document.querySelector("#tabelaLeituras tbody");
    if (!tbody) {
        console.error("❌ Tabela #tabelaLeituras não foi encontrada no DOM.");
        return;
    }

    // 2. Limpa o conteúdo atual (remove o "Carregando...")
    tbody.innerHTML = "";

    // 3. Pega os dados globais
    const dados = window.climateData || [];

    if (dados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #999;">Nenhum dado encontrado para este grupo.</td></tr>`;
        return;
    }

    // 4. Alimenta a tabela linha por linha
    dados.forEach(row => {
        const tr = document.createElement("tr");

        // Formata a data de forma legível
        const dataFormatada = row.timestamp ? new Date(row.timestamp).toLocaleString('pt-BR') : '--';
        
        // Trata a propriedade de chuva (que vem do backend/debug)
        const chuvaTexto = (row.estaChovendo == 1 || row.rain == 1) ? "Sim 🌧️" : "Não ☀️";

        tr.innerHTML = `
            <td>${dataFormatada}</td>
            <td>${row.temperature || '--'} °C</td>
            <td>${row.air_humidity || row.humidity || '--'}%</td>
            <td>${row.soil_humidity || '--'}%</td>
            <td>${row.volatile_gas || '--'}%</td>
            <td>${row.noxious_gas || '--'}%</td>
            <td>${chuvaTexto}</td>
        `;
        
        tbody.appendChild(tr);
    });
    
    console.log("🎨 [DEBUG] Tabela renderizada com sucesso com", dados.length, "linhas.");
}

// Exportar CSV
function exportCSV() {
    if (!window.climateData || window.climateData.length === 0) return alert('📭 Nenhum dado para exportar.');

    const header = [
        'Horário','Temp (°C)','Umid. Ar (%)','Umid. Solo (%)',
        'Gás Volátil (%)','Gás Nocivo (%)','Chuva'
    ];
    const rows = window.climateData.map(l => [
        l.timestamp ? new Date(l.timestamp).toLocaleString() : 'N/A',
        l.temperature || 'N/A',
        l.air_humidity || 'N/A',
        l.soil_humidity || 'N/A',
        l.volatile_gas || 'N/A',
        l.noxious_gas || 'N/A',
        (l.estaChovendo === 1 || l.estaChovendo === true) ? 'Sim' : 'Não'
    ]);

    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'historico_clima.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Inicializar Debug
window.addEventListener('DOMContentLoaded', checkDebugParams);
