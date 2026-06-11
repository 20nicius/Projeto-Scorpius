// =========================================
// sd_card.ino - Gerenciamento do Cartão SD
// Core 3.3.5 / SD_MMC
// =========================================

// =========================================
// INICIALIZAÇÃO DO SD E CRIAÇÃO DE PASTAS
// =========================================
void initSDCard() {
  if (!SD_MMC.begin("/sdcard", true)) {
    espLog(1, F("[SD] ERRO: Falha ao inicializar SD Card."));
    sd_card_initialized = false;
    return;
  }

  espLog(1, F("[SD] SD Card OK."));
  sd_card_initialized = true;
  setSdLed(false);

  // Criar pastas necessárias se não existirem
  const char* pastas[] = { "/fotos", "/locais", "/dados" };
  for (int i = 0; i < 3; i++) {
    if (!SD_MMC.exists(pastas[i])) {
      if (SD_MMC.mkdir(pastas[i])) {
        espLog(0, F("[SD] Pasta criada: "));
        espLog(1, pastas[i]);
      } else {
        espLog(0, F("[SD] ERRO ao criar pasta: "));
        espLog(1, pastas[i]);
      }
    }
  }
}

// =========================================
// GERAR NOME DE ARQUIVO ÚNICO PARA FOTO
// =========================================

String getUniqueFilename() {
  if (!sd_card_initialized) return "";

  String filenameBase = "";
  String sufixoGps = "";

  // 1. OBTER DATA E HORA DO GPS (Se o sinal estiver válido)
  // gps.date.year() geralmente retorna o ano completo (ex: 2026)
  if (gps.date.isValid() && gps.time.isValid() && gps.date.year() >= 2026) {
    char buf[64];
    
    // NOTA: O horário do GPS vem por padrão em UTC (Horário de Greenwich).
    // Formato resultante: /fotos/2026-06-07_19-30-45
    sprintf(buf, "/fotos/%04d-%02d-%02d_%02d-%02d-%02d", 
            gps.date.year(), 
            gps.date.month(), 
            gps.date.day(),
            gps.time.hour(), 
            gps.time.minute(), 
            gps.time.second());
            
    filenameBase = String(buf);
  } else {
    // FALLBACK: Se o GPS ainda não pegou a hora certa dos satélites, usa o contador interno da memória Flash
    espLog(1, F("[GPS] Hora do GPS indisponível. Usando contador de segurança."));
    preferences.begin("p-count", false);
    unsigned long n = preferences.getULong("count", 0);
    filenameBase = String(F("/fotos/")) + String(n);
    preferences.putULong("count", n + 1);
    preferences.end();
  }

  // 2. OBTER COORDENADAS DO GPS (Se houver "Fix"/Sinal de satélite)
  if (gps.location.isValid()) {
    // O parâmetro '6' força o String a manter 6 casas decimais de precisão (padrão do GPS)
    // Formato resultante: _-23.550520,-46.633310
    sufixoGps = "_" + String(gps.location.lat(), 6) + "," + String(gps.location.lng(), 6);
  } else {
    espLog(1, F("[GPS] Sem sinal de localização no momento da foto."));
    sufixoGps = "_sem_localizacao";
  }

  // 3. MONTA O CAMINHO FINAL DO ARQUIVO
  // Exemplo com sinal completo: /fotos/2026-06-07_19-30-45_-23.550520,-46.633310.JPG
  String finalPath = filenameBase + sufixoGps + ".JPG";

  // Verificação de duplicata por milissegundos (segurança extra caso tire duas fotos no mesmo segundo)
  if (SD_MMC.exists(finalPath.c_str())) {
      finalPath = filenameBase + sufixoGps + "_" + String(millis() % 1000) + ".JPG";
  }

  espLog(1, String(F("[SD] Nome do arquivo gerado: ")) + finalPath);
  return finalPath;
}

String obterNomeGrupoLocal() {
  if (!sd_card_initialized) return "Desconhecido";
  
  String nomeGrupoLocal = "Desconhecido";
  File root = SD_MMC.open("/locais");
  if (root) {
    File file = root.openNextFile();
    if (file) {
      nomeGrupoLocal = String(file.name());
      if (nomeGrupoLocal.startsWith("/")) {
        nomeGrupoLocal = nomeGrupoLocal.substring(1);
      }
      file.close();
    }
    root.close();
  }
  return nomeGrupoLocal;
}

// =========================================
// SALVAR FOTO NO SD (/fotos/)
// =========================================
bool savePhotoToSD(camera_fb_t* fb, const String& filename) {
  if (!sd_card_initialized || !fb) return false;

  setSdLed(true);

  File file = SD_MMC.open(filename.c_str(), FILE_WRITE);
  if (!file) {
    espLog(1, F("[SD] ERRO: Nao foi possivel abrir arquivo para escrita."));
    setSdLed(false);
    return false;
  }

  size_t written = file.write(fb->buf, fb->len);
  file.close();
  setSdLed(false);

  if (written == fb->len) {
    espLog(0, F("[SD] Foto salva: "));
    espLog(1, filename);
    return true;
  }

  espLog(1, F("[SD] ERRO: Gravacao incompleta!"));
  return false;
}

// =========================================
// SALVAR DADOS DO ARDUINO UNO NO SD (/dados/)
// Usado como fallback quando servidor indisponível.
// Nome do arquivo: timestamp em ms.
// =========================================
void saveDadosToSD(const String& jsonStr) {
  if (!sd_card_initialized) return;

  // Nome do arquivo baseado no tempo de execução para evitar sobreposição
  String filepath = String(F("/dados/")) + String(millis()) + String(F(".json"));
  setSdLed(true);

  File f = SD_MMC.open(filepath.c_str(), FILE_WRITE);
  if (f) {
    f.print(jsonStr);
    f.close();
    espLog(1, String(F("[SD] Dados salvos para reenvio: ")) + filepath);
  } else {
    espLog(1, F("[SD] ERRO crítico ao gravar no cartão."));
  }

  setSdLed(false);
}

// =========================================
// LIMPAR PASTA /locais (antes de gravar novos)
// Remove todos os arquivos (não subpastas).
// =========================================
void clearLocaisFolder() {
  if (!sd_card_initialized) return;

  File root = SD_MMC.open("/locais");
  if (!root) return;

  File f = root.openNextFile();
  while (f) {
    if (!f.isDirectory()) {
      String name = String(f.name());
      String path = name.startsWith("/") ? name : String(F("/locais/")) + name;
      f.close();
      SD_MMC.remove(path.c_str());
      espLog(0, F("[SD] Removido: "));
      espLog(1, path);
    } else {
      f.close();
    }
    f = root.openNextFile();
  }
  root.close();
}

// =========================================
// LED DE ATIVIDADE DO SD (pino 33, Active LOW)
// =========================================
void setSdLed(bool state) {
  //digitalWrite(SD_LED_PIN, state ? LOW : HIGH);
}
