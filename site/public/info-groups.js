// --- GERENCIAMENTO DE GRUPOS ---

// Armazenar coordenadas dos grupos globalmente
window.groupsCoordinates = {};

// Carregar grupos do backend
async function loadGroups() {
    const token = localStorage.getItem('token');
    try {
        const response = await fetch('/api/minhas-areas', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const areas = await response.json();
        const groupList = document.getElementById('groupList');
        
        if (areas.length === 0) {
            groupList.innerHTML = '<p style="color: #999; text-align: center;">Nenhum grupo encontrado</p>';
            return;
        }

        // Gerar HTML de forma segura, armazenando coordenadas globalmente
        groupList.innerHTML = areas.map((area, index) => {
            const groupId = 'group_' + index;
            window.groupsCoordinates[groupId] = area.coordenadas;
            
            return `
                <div class="group-item" data-group-id="${groupId}" data-group-name="${area.nome}">
                    <i class="fas fa-map-pin"></i> ${area.nome}
                </div>
            `;
        }).join('');

        // Adicionar event listeners aos grupos
        document.querySelectorAll('.group-item').forEach(item => {
            item.addEventListener('click', function() {
                const groupId = this.getAttribute('data-group-id');
                const groupName = this.getAttribute('data-group-name');
                const coords = window.groupsCoordinates[groupId];
                
                if (coords) {
                    selectGroup(groupName, coords);
                } else {
                    console.error('Coordenadas não encontradas para:', groupId);
                    showToast('Erro ao carregar coordenadas', true);
                }
            });
        });
    } catch (e) {
        console.error('Erro ao carregar grupos:', e);
        showToast('Erro ao carregar grupos', true);
    }
}

// Selecionar um grupo
function selectGroup(name, coords) {
    console.log('Selecionando grupo:', name, 'com', coords.length, 'pontos');
    
    // Garantir que coords é um array
    if (!Array.isArray(coords)) {
        console.error('Coordenadas não é um array:', coords);
        showToast('Erro: Coordenadas inválidas', true);
        return;
    }
    
    // Limpar coordenadas malformadas (com espaços nas chaves)
    coords = coords.map(coord => {
        if (typeof coord === 'object' && coord !== null) {
            const cleanCoord = {};
            for (let key in coord) {
                const cleanKey = key.trim();
                cleanCoord[cleanKey] = coord[key];
            }
            return cleanCoord;
        }
        return coord;
    });
    
    window.selectedGroup = { name, coords };
    
    // Atualizar seleção visual
    document.querySelectorAll('.group-item').forEach(el => el.classList.remove('selected'));
    document.querySelector(`[data-group-name="${name}"]`)?.classList.add('selected');

    if (coords && coords.length > 0) {
        // Forçar atualização do mapa
        if (window.map) {
            window.map.invalidateSize();
        }
        
        setTimeout(() => {
            const firstCoord = coords[0];
            let lat, lng;
            
            console.log('Primeiro ponto do grupo:', firstCoord);
            
            // Tentar extrair lat/lng de diferentes formatos
            if (typeof firstCoord === 'object' && firstCoord !== null) {
                lat = firstCoord.lat !== undefined ? firstCoord.lat : 
                      firstCoord.latitude !== undefined ? firstCoord.latitude : 
                      firstCoord[0];
                lng = firstCoord.lng !== undefined ? firstCoord.lng : 
                      firstCoord.longitude !== undefined ? firstCoord.longitude : 
                      firstCoord[1];
            } else {
                lat = firstCoord[0];
                lng = firstCoord[1];
            }
            
            lat = parseFloat(lat);
            lng = parseFloat(lng);
            
            console.log('Centralizando mapa em:', {lat, lng, name});
            
            if (!isNaN(lat) && !isNaN(lng) && window.map) {
                window.map.setView([lat, lng], 13);
                showToast('Mapa centralizado em ' + name, false);
            } else {
                console.warn('Coordenadas inválidas para zoom:', {lat, lng, firstCoord});
                showToast('Erro ao centralizar mapa: coordenadas inválidas', true);
            }
        }, 150);
    }

    loadClimateDataForGroup(name);
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', function() {
    console.log('Carregando grupos...');
    loadGroups();
});


//
// Carregamento da aba da foto
//
async function carregarGaleriaFotos() {
    const token = localStorage.getItem('token');
    const container = document.getElementById("galeria-fotos");
    
    try {
        const response = await fetch("/api/historico-fotos", {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error("Erro de rede");
        
        const fotos = await response.json();
        
        if (!fotos || fotos.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">
                    <i class="fas fa-images" style="font-size: 48px; margin-bottom: 15px;"></i>
                    <p>Nenhum registro de foto encontrado no banco de dados.</p>
                </div>`;
            return;
        }

        container.innerHTML = ""; // Limpa o loading anterior

        fotos.forEach(reg => {
            // Define a cor do badge com base no diagnóstico do modelo de IA
            let classeBadge = "badge-default";
            const diagnosticoLower = (reg.observacao_texto || "").toLowerCase();
            
            if (diagnosticoLower.includes("saudavel") || diagnosticoLower.includes("0")) {
                classeBadge = "badge-saudavel";
            } else if (diagnosticoLower.includes("ferrugem") || diagnosticoLower.includes("mancha") || diagnosticoLower.includes("largata")) {
                classeBadge = "badge-alerta";
            }

            // Fallback caso a foto falhe ou venha vazia
            const imagemSrc = reg.foto || "https://placehold.co/400x300?text=Sem+Imagem";

            const card = document.createElement("div");
            card.className = "foto-card";
            card.innerHTML = `
                <div class="foto-img-container">
                    <img src="${imagemSrc}" alt="Análise de Campo" loading="lazy">
                    <span class="foto-badge ${classeBadge}">${reg.observacao_texto.slice(2) || "Não Classificado"}</span>
                </div>
                <div class="foto-info">
                    <h4>Rota: ${reg.rota || "Não informado"}</h4>
                    <div class="foto-detalhes">
                        <p><i class="fas fa-calendar-alt"></i> ${reg.criado_em}</p>
                        <p><i class="fas fa-map-marker-alt"></i> Coordenadas: ${reg.local || "Sem GPS"}</p>
                        <p><i class="fas fa-microchip"></i> ID Dispositivo: ${reg.device_id || "N/A"}</p>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

    } catch (error) {
        console.error("Falha ao montar galeria:", error);
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--vermelho);">
                <i class="fas fa-exclamation-triangle" style="font-size: 32px; margin-bottom: 10px;"></i>
                <p>Ocorreu um erro ao carregar o histórico de fotos do servidor.</p>
            </div>`;
    }
}