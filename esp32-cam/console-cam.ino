#if UART0_UNO_ENABLED

void EstacionarUNO(bool state) {
  if (state) {
    // Servidor conectado com sucesso
    espLog(1, F("esp32: STAY_CAR")); 
    espLog(1, F("[UART0] Comando 'staycar' enviado ao Uno (Servidor OK)."));
  } else {
    // Servidor offline ou falha na conexão
    espLog(1, F("esp32: GO_CAR")); // Exemplo de comando para retomar
    espLog(1, F("[UART0] Servidor offline. Uno avisado."));
  }
}

void handleUartData() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    
    if (c == '\n' || c == '\r') {
      uartBuffer.trim();
      
      if (uartBuffer.length() > 0) {
 
        if (uartBuffer.startsWith("UNO: PROXIMO_LOCAL")) {
            espLog(1, F("[UART0] Uno solicitou próximo local."));
            enviarLocalAoUno(false);
            uartBuffer = ""; // Limpa o buffer após processar
        }

        // --- MANTÉM: Processamento de JSON de sensores ---
        else if (uartBuffer.startsWith("UNO: {") && uartBuffer.endsWith("}")) {
          processarJsonUno(uartBuffer.substring(5)); // Sua função que já existe
          uartBuffer = "";
        }
      }
    } else {
      if (uartBuffer.length() < 512) uartBuffer += c;
    }
  }
}

// Função interna para processar a ordem específica dos dados
void processarJsonUno(const String& jsonStr) {
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, jsonStr);

  if (error) {
    espLog(1, F("[UART0] Erro ao decodificar JSON do Uno."));
    return;
  }
    
  String nomeGrupoLocal = "não definido";
  if (sd_card_initialized) {
    File root = SD_MMC.open("/locais");
    if (root) {
      File file = root.openNextFile();
      if (file) {
        nomeGrupoLocal = String(file.name()); // Pega o nome do arquivo (ex: "Setor_Norte")
        file.close();
      }
      root.close();
    }
  }  

  DadosSensores dados;
  dados.temperatura = doc["temp"];
  dados.umidadeAr   = doc["umid_ar"];
  dados.umidadeSolo = doc["umid_s"];
  dados.gasToxico   = doc["gas_t"];
  dados.gasVolatil  = doc["gas_v"];
  dados.chuva       = doc["chuva"];
  dados.latitude    = doc["lat"];
  dados.longitude   = doc["lon"];

  // =================================================================
  // NOVA LÓGICA: O ESP32 pega a data e hora do seu próprio módulo GPS
  // =================================================================
  if (gps.date.isValid() && gps.time.isValid()) {
    char bufferDT[21];
    sprintf(bufferDT, "%04d-%02d-%02d_%02d:%02d:%02d",
            gps.date.year(), gps.date.month(), gps.date.day(),
            gps.time.hour(), gps.time.minute(), gps.time.second());
    dados.dataHora = String(bufferDT);
  } else {
    dados.dataHora = "00/00/0000 00:00:00"; // Fallback caso o GPS do ESP esteja sem sinal de tempo
  }

  // Agora montamos o JSON final para o servidor (incluindo o ID do dispositivo)
  StaticJsonDocument<768> outputDoc;
  outputDoc["temperature"]   = dados.temperatura;
  outputDoc["humidity"]      = dados.umidadeAr;
  outputDoc["soil_humidity"] = dados.umidadeSolo;
  outputDoc["noxious_gas"]   = dados.gasToxico;
  outputDoc["volatile_gas"]  = dados.gasVolatil;
  outputDoc["rain"]          = dados.chuva;
  outputDoc["timestamp"]     = dados.dataHora; // Agora usa o timestamp gerado localmente pelo ESP32
  outputDoc["latitude"]      = dados.latitude;
  outputDoc["longitude"]     = dados.longitude;
  outputDoc["device_id"]     = meuIDnumeral;
  outputDoc["grupo_local"]   = nomeGrupoLocal; 
    
  String finalJson;
  serializeJson(outputDoc, finalJson);
  
  // Envia para o servidor ou salva no SD se falhar
  sendDadosToServer(finalJson);
}

void enviarLocalAoUno(bool repetirAtual) {
  if (!sd_card_initialized) return;

  // 1. Abre as preferências
  preferences.begin("locais_idx", false);
  int indiceALer = preferences.getInt("ponto", 0);

  // 2. Localiza o arquivo na pasta /locais
  File root = SD_MMC.open("/locais");
  File file = root.openNextFile(); 
  
  if (!file || file.isDirectory()) {
    espLog(1, F("[SD] Erro: Arquivo em /locais não encontrado"));
    if(file) file.close();
    root.close();
    preferences.end();
    fetchProcessLocais();
    return;
  }

  String localEncontrado = "";
  int linhaContador = 0;
  bool sucesso = false;

  // 3. Varre o arquivo até o índice desejado
  while (file.available()) {
    String linha = file.readStringUntil('\n');
    linha.trim();
    if (linha.length() == 0) continue;

    if (linhaContador == indiceALer) {
      localEncontrado = linha;
      sucesso = true;
      break;
    }
    linhaContador++;
  }

  // 4. Lógica de envio e incremento
  if (sucesso) {
    // Envia para o Uno
    espLog(1, "esp32: " + localEncontrado);
    
    if (repetirAtual) {
      espLog(1, " [UART0] REPETINDO ponto " + String(indiceALer) + ": " + localEncontrado);
      // NÃO incrementamos o "ponto" nas Preferences
    } else {
      espLog(1, " [UART0] ENVIADO ponto " + String(indiceALer) + ": " + localEncontrado);
      // INCREMENTA para a próxima chamada
      preferences.putInt("ponto", indiceALer + 1);
    }
  } 
  else {
    // Se não encontrou a linha (fim do arquivo)
    espLog(1, F("[SD] Fim da lista ou erro. Resetando para ponto 0..."));
    preferences.putInt("ponto", 0);
    fetchProcessLocais();
    
    // Opcional: Se quiser que ele tente enviar o ponto 0 imediatamente ao falhar:
    // preferences.end(); file.close(); root.close();
    // enviarLocalAoUno(false); 
    // return;
      
  }

  file.close();
  root.close();
  preferences.end();
}

void enviarTelemetriaParaUno() {
  // Executa estritamente no intervalo definido (ex: 1 segundo)
  if (millis() - ultimoEnvioGpsUno >= INTERVALO_ENVIO_UNO) {
    ultimoEnvioGpsUno = millis();

    // Se o GPS tiver sinal válido, monta a string no formato esperado pelo decodificador do Uno
    if (gps.location.isValid()) {
      Serial.print("devKit:GPS:");
      Serial.print(gps.location.lat(), 6);
      Serial.print(",");
      Serial.println(gps.location.lng(), 6);
    } 
    else {
      // Caso o GPS perca o sinal temporariamente (ex: embaixo de árvores ou galpão)
      // Avisa o Uno para que ele tome a decisão de segurança de parar os motores
      Serial.println(F("devKit:GPS:SemSinal"));
    }
  }
}

#endif