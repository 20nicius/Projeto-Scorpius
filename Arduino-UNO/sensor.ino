// =========================================================================
//  FUNÇÃO PERSONALIZADA DE ATUALIZAÇÃO DOS SENSORES AMBIENTAIS (COM JSON)
// =========================================================================
void atualizarSensoresAmbientais() {
  // Executa de forma não-bloqueante apenas no intervalo definido
  if (millis() - tempoUltimaLeituraSensores >= INTERVALO_SENSORES) {
    tempoUltimaLeituraSensores = millis();
    
    delay(200);

    moverSuave(100);

    // 1. Leituras Analógicas com Mapeamento padrão de 0-1023 para 0-100%
    sensoresAtuais.qualidadeArMQ135 = map(analogRead(PINO_MQ135), 0, 1023, 0, 100);
    sensoresAtuais.gasMQ2           = map(analogRead(PINO_MQ2), 0, 1023, 0, 100);
    
    // 2. Leituras Digitais (DHT11)
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    // Verifica se a leitura do DHT falhou antes de salvar para não corromper a struct
    if (!isnan(t) && !isnan(h)) {
      sensoresAtuais.temperatura = t;
      sensoresAtuais.umidadeAr   = (int)h;
    }

    sensoresAtuais.umidadeSolo      = map(max(0, analogRead(PINO_UMIDADE_SOLO) - 300), 768, 0, 0, 100);

    // 3. Leitura do Sensor de Presença de Água (Chuva)
    sensoresAtuais.temAgua = (digitalRead(PINO_PRESENCA_AGUA) == HIGH);
    
    // 4. Criação e Envio do Pacote JSON para o ESP32
    // Imprime o cabeçalho exato esperado pelo ESP32 (5 caracteres: "UNO: ")
    Serial.print(F("UNO: {"));
    
    // Chaves de Sensores Ambientais
    Serial.print(F("\"temp\":"));     Serial.print(sensoresAtuais.temperatura, 1);
    Serial.print(F(",\"umid_ar\":")); Serial.print(sensoresAtuais.umidadeAr);
    Serial.print(F(",\"umid_s\":"));  Serial.print(sensoresAtuais.umidadeSolo);
    Serial.print(F(",\"gas_t\":"));   Serial.print(sensoresAtuais.qualidadeArMQ135);
    Serial.print(F(",\"gas_v\":"));   Serial.print(sensoresAtuais.gasMQ2);
    
    // Chave de chuva (Envia 1 para verdadeiro/tem água e 0 para falso)
    Serial.print(F(",\"chuva\":"));   Serial.print(sensoresAtuais.temAgua ? 1 : 0);

    // Chaves de Localização (lat e lon) obtidas do GPS
    Serial.print(F(",\"lat\":"));
    if (gps.location.isValid()) Serial.print(gps.location.lat(), 6);
    else Serial.print(F("0.0"));
    
    Serial.print(F(",\"lon\":"));
    if (gps.location.isValid()) Serial.print(gps.location.lng(), 6);
    else Serial.print(F("0.0"));
    
    // Fecha o JSON com o caractere final esperado pelo endsWith("}") do ESP32
    Serial.println(F("}"));

    moverSuave(0);
  }
}


// Função moverSuave original mantida exatamente como você enviou
void moverSuave(int percent) {
  percent = constrain(percent, 0, 100);
  int alvo1 = map(percent, 0, 100, 10, 110);
  int alvo2 = map(percent, 0, 100, 40, 70);

  // RELIGA os servos para permitir o movimento nos novos pinos 12 e 13
  servo1.attach(PINO_SERVO1);
  servo2.attach(PINO_SERVO2);

  while (posAtual1 != alvo1 || posAtual2 != alvo2) {
    if (posAtual1 < alvo1) posAtual1++;
    else if (posAtual1 > alvo1) posAtual1--;

    if (posAtual2 < alvo2) posAtual2++;
    else if (posAtual2 > alvo2) posAtual2--;

    servo1.write(posAtual1);
    servo2.write(posAtual2);
    delay(intervaloPaso);
  }
  
  // DESLIGA o sinal para relaxar os motores e economizar bateria
  servo1.detach();
  servo2.detach();
  Serial.println(F("[UNO] SERVOS_OK"));
}
