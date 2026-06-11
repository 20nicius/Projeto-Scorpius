// =========================================================================
//  FUNÇÃO DE LEITURA NÃO-BLOQUEANTE INTERCALADA (SONAR)
// =========================================================================
void atualizarSonares() {
  // Lemos um sensor a cada 60 milissegundos para evitar eco cruzado.
  if (millis() - tempoUltimaLeituraSonar >= INTERVALO_SONAR) {
    tempoUltimaLeituraSonar = millis();
    
    //Serial.println("[UNO]Leitura do ultraso.");
    // GARANTIA: Configura o pino como Entrada para escutar o eco
    pinMode(ECHO_COMUM, INPUT);
    
    int trigPinAtivo;
    
    // 1. Descobre qual canal de gatilho (Trig) deve ser ativado nesta rodada (Agora 3 sensores)
    if (sonarAtual == 0) { 
      trigPinAtivo = TRIG_ESQUERDA; 
    } else if (sonarAtual == 1) {
      trigPinAtivo = TRIG_CENTRO;
    } else { 
      trigPinAtivo = TRIG_DIREITA; 
    }
    
    // 2. Dispara o pulso ultrassônico apenas no sensor escolhido
    digitalWrite(trigPinAtivo, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPinAtivo, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPinAtivo, LOW);
    
    // 3. Mede o tempo de resposta no pino compartilhado (ECHO_COMUM)
    long duracao = pulseIn(ECHO_COMUM, HIGH, 12000);
    int distanciaCalculada = (duracao / 2) / 29.1;
    
    if (distanciaCalculada == 0) distanciaCalculada = 999;
    
    // 4. Salva o valor no sensor correspondente
    if (sonarAtual == 0) {
      distEsquerda = distanciaCalculada;
    } else if (sonarAtual == 1) {
      distCentro = distanciaCalculada;
    } else {
      distDireita = distanciaCalculada;
    }
    
    // Passa para o próximo sensor na próxima rodada (Alterna entre 0, 1 e 2)
    sonarAtual = (sonarAtual + 1) % 3;
  }
}

// =========================================================================
//  NAVEGAÇÃO AUTÔNOMA COM DESVIO DE OBSTÁCULO (ATUALIZADA)
// =========================================================================
void navegarAteAlvo() {
  if (!permitirMovimento) {
    pararMotores(); // Garante que os motores fiquem desligados se receber ordem de parar
    return;         // Aborta todo o resto da lógica (GPS, Bússola e Ultrassônicos)
  }

  // Segurança: Se o DevKit não enviar dados por mais de 5 segundos, considera sinal perdido
  if (millis() - ultimaAtualizacaoGPS > 5000) {
    gpsSinalValido = false;
  }

  // Só navega se a comunicação com o DevKit indicou sinal de satélite válido
  if (!gpsSinalValido) {
    pararMotores();
    return;
  }

  // ---- PASSO ZERO: ANALISAR EVASÃO DE OBSTÁCULOS COM 3 SENSORES (Prioridade Absoluta) ----
  
  // 1. Se o CENTRO estiver bloqueado, decide para onde girar com base no lado mais livre
  if (distCentro < DIST_OBSTACULO_FRENTE) {
    if (distEsquerda > distDireita) {
      girarEsquerda();
    } else {
      girarDireita();
    }
    return;
  }
  
  // 2. Se AMBOS os lados estiverem bloqueados ao mesmo tempo
  if (distEsquerda < DIST_OBSTACULO_FRENTE && distDireita < DIST_OBSTACULO_FRENTE) {
    if (distEsquerda > distDireita) {
      girarEsquerda();
    } else {
      girarDireita();
    }
    return;
  }
  
  // 3. Se apenas a ESQUERDA estiver bloqueada, foge para a direita
  if (distEsquerda < DIST_OBSTACULO_FRENTE) {
    girarDireita(); 
    return;
  }
  
  // 4. Se apenas a DIREITA estiver bloqueada, foge para a esquerda
  if (distDireita < DIST_OBSTACULO_FRENTE) {
    girarEsquerda();
    return;
  }

  // ---- SE A ÁREA ESTIVER LIMPA, EXECUTA A NAVEGAÇÃO COMPASS/GPS PADRÃO ----

  // Passamos as nossas variáveis double diretamente para a função estática da TinyGPSPlus
  double distancia = TinyGPSPlus::distanceBetween(minhaLatAtual, minhaLngAtual, targetLat, targetLng);

  if (distancia <= RAIO_PROXIMIDADE) {
    pararMotores();
    estadoAtual = AGUARDANDO_ALVO;
    Serial.println(F("UNO: PROXIMO_LOCAL")); // Avisa o DevKit que chegou
    return;
  }

  // Calcula o rumo usando as coordenadas guardadas
  double rumoDesejado = TinyGPSPlus::courseTo(minhaLatAtual, minhaLngAtual, targetLat, targetLng);
  
  Serial.println("Iniciando leitura da busúla");
  compass.read();

  Serial.print(compass.getX());
  Serial.print(compass.getY());
  Serial.println(compass.getZ());
  Serial.println(compass.getAzimuth());

  int rumoAtual = compass.getAzimuth(); 
  if (rumoAtual < 0) rumoAtual += 360;

  int erroDirecao = rumoDesejado - rumoAtual;
  if (erroDirecao < -180) erroDirecao += 360;
  if (erroDirecao > 180) erroDirecao -= 360;

  int toleranciaGiro = 15; 

  if (erroDirecao > toleranciaGiro) {
    girarDireita(); 
  } else if (erroDirecao < -toleranciaGiro) {
    girarEsquerda();
  } else {
    irParaFrente(); 
  }
}

void irParaFrente() {
  digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, LOW);
  digitalWrite(PIN_IN3, HIGH); digitalWrite(PIN_IN4, LOW);
}

void irParaTras() {
  digitalWrite(PIN_IN1, LOW);  digitalWrite(PIN_IN2, HIGH);
  digitalWrite(PIN_IN3, LOW);  digitalWrite(PIN_IN4, HIGH);
}
    

void girarDireita() {
  digitalWrite(PIN_IN1, HIGH); digitalWrite(PIN_IN2, LOW);
  digitalWrite(PIN_IN3, LOW);  digitalWrite(PIN_IN4, HIGH);
}

void girarEsquerda() {
  digitalWrite(PIN_IN1, LOW);  digitalWrite(PIN_IN2, HIGH);
  digitalWrite(PIN_IN3, HIGH); digitalWrite(PIN_IN4, LOW);
}

void pararMotores() {
  digitalWrite(PIN_IN1, LOW); digitalWrite(PIN_IN2, LOW);
  digitalWrite(PIN_IN3, LOW); digitalWrite(PIN_IN4, LOW);
}

