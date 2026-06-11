// =========================================================================
//  server.ino  —  Comunicação HTTP com Servidor
// =========================================================================
//
//  ROTAS
//  ─────────────────────────────────────────────────────────────────────
//  GET  /api/iot/locais   header X-MAC: <wifiMac>
//       resposta JSON: {"nome_grupo": ["local1","local2",...], ...}
//
//  POST /api/iot/dados    body JSON: {info1..info7, info8: wifiMac}
//
//  POST /api/iot/upload   body: imagem JPEG (Content-Type: image/jpeg)
//
//  GARANTIA DE CONECTIVIDADE
//  ─────────────────────────────────────────────────────────────────────
//  tryServerConnect() é a única função que abre conexão com o servidor.
//  Ela só executa se: WiFi conectado + serverBase montado.
//  Somente com retorno true as demais funções de rede são invocadas,
//  evitando tentativas desnecessárias quando o servidor está inacessível.
// =========================================================================

// ─────────────────────────────────────────────────────────────────────────
//  tryServerConnect()
//  Faz GET /api/iot/locais. Se bem-sucedido, processa a resposta e
//  retorna true para que o loop() possa chamar as outras funções de rede.
// ─────────────────────────────────────────────────────────────────────────
bool tryServerConnect() {
  if (!wifi_configured || WiFi.status() != WL_CONNECTED || 
      WiFi.localIP() == IPAddress(0,0,0,0)) return false;
  
  if (serverBase.length() == 0) {
    buildServerBase();
    if (serverBase.length() == 0) {
      espLog(1, F("[Server] serverBase vazio após buildServerBase"));
      return false;
    }
  }
  
  serverBase.trim();
  String url = serverBase + F("/api/iot/check-status");
  
  // DIAGNÓSTICO CRÍTICO
  espLog(1, url);
  
  // Garante que a conexão anterior foi fechada
  http.end();
  
  // UMA ÚNICA chamada a http.begin() - escolhe o cliente correto
  bool beginSucesso = false;
  
  if (url.startsWith("https")) {
    client.setInsecure();
    beginSucesso = http.begin(client, url);
  } else {
    beginSucesso = http.begin(plainClient, url);
  }
  
  if (!beginSucesso) {
    espLog(1, F("[Server] Erro ao inicializar HTTP (begin retornou false)"));
    return false;
  }
  
  http.setTimeout(10000);
  http.addHeader(F("ngrok-skip-browser-warning"), F("true"));
  http.addHeader(F("x-mac"), String(meuIDnumeral));
  
  espLog(1, F("[DEBUG] Enviando GET..."));
  int code = http.GET();
  espLog(0, F("[DEBUG] Código HTTP: "));
  Serial.println(code);
  
  if (code == 200) {
    espLog(1, F("[Server] Conectado com sucesso"));
    http.end();
    #if UART0_UNO_ENABLED
      EstacionarUNO(true);
    #endif
    return true;
  }
  
  if (code < 0) {
    String erroMsg = F("[Server] Erro físico/DNS. Código: ");
    erroMsg += String(code);
    erroMsg += F(" -> ");
    erroMsg += http.errorToString(code);
    espLog(1, erroMsg);
  } else {
    String erroMsg = F("[Server] Bloqueado (HTTP ");
    erroMsg += String(code);
    erroMsg += F(")");
    espLog(1, erroMsg);
  }
  
  http.end();
  return false;
}



// ─────────────────────────────────────────────────────────────────────────
//  fetchProcessLocais()()
//
//  Formato esperado: {"nome_grupo": ["local1","local2",...], ...}
//
//  1. Limpa a pasta /locais/ no SD
//  2. Para cada grupo: cria /locais/<nome_grupo> com um local por linha
//  3. Envia o primeiro local encontrado ao Arduino Uno via Serial (UART0 TX)
//     ── Este envio só ocorre quando UART0_UNO_ENABLED for true ──
// ─────────────────────────────────────────────────────────────────────────
void fetchProcessLocais() {
  // 1. Verificações de segurança baseadas no seu padrão
  if (!sd_card_initialized || !wifi_configured || WiFi.status() != WL_CONNECTED) return;
  
  if (serverBase.length() == 0) {
    buildServerBase();
    if (serverBase.length() == 0) return;
  }

  
  client.setInsecure(); // Pular validação de certificado SSL para o Ngrok

  
  // Constrói a URL conforme a rota definida no seu Node.js
  String url = serverBase + F("/api/iot/locais");
  
  http.begin(url);
  http.addHeader(F("ngrok-skip-browser-warning"), F("true"));
  // Usa o header X-MAC conforme esperado pela sua rota Node.js e tryServerConnect
  http.addHeader(F("x-mac"), String(meuIDnumeral));
  http.setTimeout(10000); // 10 segundos de timeout para listas longas

  int code = http.GET();

  if (code == 200) {
    String body = http.getString(); // Captura o JSON enviado pelo servidor
    
    // --- Início do processamento original ---
    DynamicJsonDocument doc(4096);
    DeserializationError err = deserializeJson(doc, body);
    
    if (err || !doc.is<JsonObject>()) {
      espLog(1, F("[Server] ERRO: Resposta de locais inválida."));
      http.end();
      return;
    }

    clearLocaisFolder();
    String primeiroPonto = "";

    for (JsonPair kv : doc.as<JsonObject>()) {
      groupName = kv.key().c_str();
      JsonArray coords = kv.value().as<JsonArray>();

      if (coords.isNull() || coords.size() == 0) continue;

      String filepath = String(F("/locais/")) + groupName;
      File f = SD_MMC.open(filepath.c_str(), FILE_WRITE);

      if (f) {
        for (JsonVariant ponto : coords) {
          String pontoStr = ponto.as<String>();
          if (primeiroPonto.length() == 0) primeiroPonto = pontoStr;
          f.println(pontoStr); 
        }
        f.close();
        espLog(1, F("[SD] Locais atualizados e salvos."));
      }
    }

    preferences.begin("locais_idx", false);
    preferences.putInt("ponto", 1);
    preferences.end();

    #if UART0_UNO_ENABLED
      if (primeiroPonto.length() > 0) {
        espLog(1, "esp32: local: " + primeiroPonto); 
      }
    #endif
    // --- Fim do processamento original ---

  } else {
    espLog(1, String(F("[Server] Falha ao obter locais. Codigo: ")) + String(code));
  }

  http.end();
}

// ─────────────────────────────────────────────────────────────────────────
//  sendDadosToServer()
//  POST /api/iot/dados com JSON do Arduino Uno + info8 (MAC do ESP).
//  Fallback: salva em /dados/ no SD para reenvio posterior.
// ─────────────────────────────────────────────────────────────────────────
void sendDadosToServer(const String& jsonStr) {
  // Se o WiFi não estiver pronto ou a URL estiver vazia, salva direto no SD
  if (!wifi_configured || WiFi.status() != WL_CONNECTED || serverBase.length() == 0) {
    espLog(1, F("[Server] WiFi offline. Salvando dados no SD..."));
    saveDadosToSD(jsonStr);
    return;
  }

  
  client.setInsecure(); // Pular validação de certificado SSL para o Ngrok

  
  String url = serverBase + F("/api/iot/dados");
  
  http.begin(url);
  http.addHeader(F("ngrok-skip-browser-warning"), F("true"));
  http.addHeader(F("Content-Type"), F("application/json"));
  http.setTimeout(8000); // Timeout de 8 segundos para evitar travamentos

  // Realiza o POST
  int code = http.POST((uint8_t*)jsonStr.c_str(), jsonStr.length());
  http.end();

  if (code > 0 && code < 400) {
    espLog(1, F("[Server] Dados do Uno enviados com sucesso."));
  } else {
    espLog(1, String(F("[Server] Erro HTTP (")) + String(code) + F("). Movendo para SD."));
    saveDadosToSD(jsonStr);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  retryDadosFromSD()
//  Reenvia até 5 arquivos de /dados/ pendentes após tryServerConnect()=true.
// ─────────────────────────────────────────────────────────────────────────
void retryDadosFromSD() {
  // Só tenta se houver WiFi e se não estivermos enviando uma foto agora
  if (!sd_card_initialized || WiFi.status() != WL_CONNECTED || 
      serverBase.length() == 0 || isSending) return;

  File root = SD_MMC.open("/dados");
  if (!root) return;

  int count = 0;
  File f = root.openNextFile();

  // Tenta reenviar até 5 arquivos por ciclo para não bloquear o loop principal
  while (f && count < 5) {
    if (!f.isDirectory()) {
      String content = "";
      while (f.available() && content.length() < 2048) {
        content += (char)f.read();
      }
      
      String path = String(f.name());
      if (!path.startsWith("/")) path = "/dados/" + path;
      f.close();

      if (content.length() > 0) {
        
        client.setInsecure(); // Pular validação de certificado SSL para o Ngrok
        
        
        // GARANTIA: URL idêntica à usada na sendDadosToServer
        http.begin(serverBase + F("/api/iot/dados"));
        http.addHeader(F("ngrok-skip-browser-warning"), F("true"));
        http.addHeader(F("Content-Type"), F("application/json"));
        http.setTimeout(10000); // 10s para reenvio (SD é mais lento)

        int code = http.POST((uint8_t*)content.c_str(), content.length());
        http.end();

        if (code > 0 && code < 400) {
          SD_MMC.remove(path.c_str());
          espLog(1, String(F("[SD] Sucesso! Dado removido: ")) + path);
          count++;
          vTaskDelay(pdMS_TO_TICKS(200)); // Pequena pausa entre envios
        } else {
          espLog(1, String(F("[SD] Servidor ainda offline (")) + String(code) + F("). Abortando reenvio."));
          break; 
        }
      } else {
        SD_MMC.remove(path.c_str()); // Remove arquivos corrompidos/vazios
      }
    } else {
      f.close();
    }
    f = root.openNextFile();
  }
  root.close();
}

// ─────────────────────────────────────────────────────────────────────────
//  sendPhotoToServer()
//  fb != nullptr → envia buffer direto da câmera (PSRAM)
//  fb == nullptr → lê o arquivo do SD e envia via buffer alocado
// ─────────────────────────────────────────────────────────────────────────
bool sendPhotoToServer(camera_fb_t* fb, const String& filename) {
  if (!wifi_configured ||
      WiFi.status() != WL_CONNECTED ||
      serverBase.length() == 0)    return false;
  if (isSending)                   return false;

  isSending  = true;
  String url = serverBase + F("/api/iot/upload");
  
  int code   = -1;

  // Captura o nome do arquivo único da pasta locais
  String grupoLocal = obterNomeGrupoLocal();
  espLog(1, grupoLocal);
  
  if (grupoLocal.length() == 0) fetchProcessLocais();

  // ── Caso 1: buffer direto da câmera ──────────────────────────────────
  if (fb) {
    if (filename.length() > 0) {
      if (url.startsWith("https")) {
        client.setInsecure();
        http.begin(client, url + "?name=" + filename);
      } else http.begin(plainClient, url + "?name=" + filename);
    } else {
      if (url.startsWith("https")) {
        client.setInsecure();
        http.begin(client, url);
      } else http.begin(plainClient, url);
    }
    
    http.addHeader(F("ngrok-skip-browser-warning"), F("true"));
    http.addHeader(F("Content-Type"), F("image/jpeg")); 
    
    http.addHeader(F("x-device-id"), String(meuIDnumeral));
    http.addHeader(F("x-grupo-local"), grupoLocal);

    http.setTimeout(10000); //10s
    code = http.POST(fb->buf, fb->len); 
    http.end(); 
    isSending = false; 

    if (code > 0 && code < 400) { 
      espLog(1, F("[Server] Foto enviada (RAM).")); 
      return true; 
    }
    espLog(1, String(F("[Server] Falha foto RAM. Codigo: ")) + String(code)); 
    return false; 
  }

  // ── Caso 2: arquivo salvo no SD ──────────────────────────────────────
  if (filename.length() == 0) { isSending = false; return false; } 

  // Abre o arquivo para leitura
  File file = SD_MMC.open(filename.c_str(), FILE_READ); 
  if (!file) { isSending = false; return false; } 

  size_t fileSize = file.size(); 

  // =========================================================================
  // OTIMIZAÇÃO CRUCIAL: REMOVIDO TODO O BLOCO DE ALLOC/MALLOC/READ QUE TRAVAVA
  // =========================================================================

  // Configura a URL e inicia a conexão HTTP
  if (filename.length() > 0) {
    if (url.startsWith("https")) {
      client.setInsecure();
      http.begin(client, url + "?name=" + filename);
    } else http.begin(plainClient, url + "?name=" + filename);
  } else {
    if (url.startsWith("https")) {
      client.setInsecure();
      http.begin(client, url);
    } else http.begin(plainClient, url);
  }
  
  http.addHeader(F("ngrok-skip-browser-warning"), F("true"));
  http.addHeader(F("Content-Type"), F("image/jpeg")); 
  
  http.addHeader(F("x-device-id"), String(meuIDnumeral));
  http.addHeader(F("x-grupo-local"), grupoLocal);

  http.setTimeout(3000); // 3s de espera ao servidor

  // MODIFICAÇÃO AQUI: Passamos o ponteiro do arquivo '&file' diretamente.
  // O cliente HTTP vai ler do SD e transmitir por partes (Streaming) automaticamente.
  code = http.sendRequest("POST", &file, fileSize); 

  // IMPORTANTE: Só fechamos o arquivo APÓS o término do sendRequest
  file.close(); 
  http.end(); 

  isSending = false; 

  if (code > 0 && code < 400) { 
    espLog(1, String(F("[Server] Foto enviada por Streaming (SD): ")) + filename); 
    return true; 
  }
  espLog(1, String(F("[Server] Falha foto SD. Codigo: ")) + String(code)); 
  return false; 
}


// ─────────────────────────────────────────────────────────────────────────
//  sendAllPhotosFromSD()
//  Reenvia até 3 fotos de /fotos/ por ciclo.
//  Chamada somente após tryServerConnect() = true.
// ─────────────────────────────────────────────────────────────────────────
void sendAllPhotosFromSD() {
  if (!sd_card_initialized ||
      WiFi.status() != WL_CONNECTED ||
      isSending) return;

  File root = SD_MMC.open("/fotos");
  if (!root) return;

  int  count = 0;
  File file  = root.openNextFile();

  while (file && count < 3) {
    if (!file.isDirectory()) {
      String name = String(file.name());
      String path = name.startsWith("/") ? name : String(F("/fotos/")) + name;
      file.close();

      espLog(1, String(F("[SD] Reenviando foto: ")) + path);
      if (sendPhotoToServer(nullptr, path)) {
        SD_MMC.remove(path.c_str());
        count++;
        vTaskDelay(pdMS_TO_TICKS(500));
      } else {
        break;
      }
    } else {
      file.close();
    }
    file = root.openNextFile();
  }
  root.close();
}
