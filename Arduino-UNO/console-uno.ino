// =========================================================================
//  FUNÇÕES AUXILIARES E PROCESSAMENTO SERIAL CENTRALIZADO
// =========================================================================

// Esta variável global precisa existir no código principal (carrinho.cpp)
extern bool permitirMovimento;

void serialEvent() {
  while (Serial.available() > 0) {
    //Serial.println("[UNO]Serial pego");
    char c = Serial.read();
    
    if (c == '\n' || c == '\r') {
      inputBuffer.trim();
            
      if (inputBuffer.length() > 0) {
        // --- FILTRO CENTRALIZADO: Comandos vindos do ESP32 ---
        Serial.print("[UNO] Serial: ");
        Serial.println(inputBuffer); 
        if (inputBuffer.startsWith("esp32:")) {
          
          // === COMANDOS DE CONTROLE MANUAL ===
          if (inputBuffer.indexOf("MANUAL_F") != -1) {
            estadoAtual = MANUAL;
            irParaFrente();
            Serial.println("[UNO]Para frente");
          }
          else if (inputBuffer.indexOf("MANUAL_B") != -1) {
            estadoAtual = MANUAL;
            irParaTras(); // Função criada abaixo
          }
          else if (inputBuffer.indexOf("MANUAL_L") != -1) {
            estadoAtual = MANUAL;
            girarEsquerda();
          }
          else if (inputBuffer.indexOf("MANUAL_R") != -1) {
            estadoAtual = MANUAL;
            girarDireita();
          }
          else if (inputBuffer.indexOf("MANUAL_S") != -1) {
            estadoAtual = MANUAL;
            pararMotores();
          }
          // Comando para devolver o controle ao GPS/Bússola autônomo
          else if (inputBuffer.indexOf("MANUAL_OFF") != -1) {
            estadoAtual = NAVEGANDO;
            pararMotores();
          }
          
          // --- MANTÉM OS SEUS COMANDOS ORIGINAIS ABAIXO ---
          else if (inputBuffer.indexOf("STAY_CAR") != -1) {
            permitirMovimento = false;
            pararMotores();
          }
          else if (inputBuffer.indexOf("GO_CAR") != -1) {
            permitirMovimento = true;
          }
          else if (inputBuffer.indexOf("Lat:") != -1 && inputBuffer.indexOf("Lng:") != -1) {
            extrairCoordenadas(inputBuffer);
          }
        }
        
        // Mantém a checagem antiga de telemetria GPS se necessário
        if (inputBuffer.startsWith("devKit:GPS:")) {
           // ... sua lógica existente ...
        }
        
        inputBuffer = ""; 
      }
    } else inputBuffer += c; 
  }
}


void extrairCoordenadas(String str) {
  int latIndex = str.indexOf("Lat:") + 4;
  int commaIndex = str.indexOf(",");
  int lngIndex = str.indexOf("Lng:") + 4;
  
  targetLat = str.substring(latIndex, commaIndex).toDouble();
  targetLng = str.substring(lngIndex).toDouble(); 
  
  estadoAtual = NAVEGANDO;
}