#include <SoftwareSerial.h>
#include <Wire.h>
#include <QMC5883LCompass.h>
#include <DHT.h>
#include <Servo.h>
#include <Adafruit_NeoPixel.h>
#include <TinyGPSPlus.h>

// Defina o pino de dados conectado na placa
#define PIN 3

// Defina a quantidade de LEDs que a sua fita possui
#define NUMPIXELS 18

// Inicializa a biblioteca da fita
Adafruit_NeoPixel pixels(NUMPIXELS, PIN, NEO_GRB + NEO_KHZ800);

// --- CONFIGURAÇÃO DA BÚSSOLA E GPS ---
QMC5883LCompass compass;
TinyGPSPlus gps;


// --- CONFIGURAÇÃO DO GPS ---
bool gpsSinalValido = false;  // Substitui o gps.location.isValid()
double minhaLatAtual = 0.0;   // Guarda a latitude enviada pelo DevKit
double minhaLngAtual = 0.0;   // Guarda a longitude enviada pelo DevKit
unsigned long ultimaAtualizacaoGPS = 0; // Para segurança (Timeout)


// --- CONFIGURAÇÃO DA PONTE H L298N (Mantidos) ---
const int PIN_IN1 = 4;
const int PIN_IN2 = 5;
const int PIN_IN3 = 6;
const int PIN_IN4 = 7;


// --- CONFIGURAÇÃO DOS 3 SENSORES ULTRASSÔNICOS HC-SR04 ---
// Usaremos pinos digitais e analógicos (como digitais) para faltar pinos no Uno se necessário.
const int TRIG_CENTRO   = 2;
const int TRIG_ESQUERDA = 9;
const int TRIG_DIREITA  = 10;
const int ECHO_COMUM    = 11;


// Distâncias de segurança em centímetros
const int DIST_OBSTACULO_FRENTE = 40;   // Para e desvia de forma agressiva
const int DIST_OBSTACULO_LATERAL = 30;  // Correção leve de curso


// Variáveis para armazenar as distâncias atuais
int distCentro = 999;
int distFrente = 999;
int distEsquerda = 999;
int distDireita = 999;


unsigned long tempoUltimaLeituraSonar = 0;
const int INTERVALO_SONAR = 200; // Lê os sonares a cada 200ms (evita interferência de eco entre eles)
int sonarAtual = 0; // 0 (Esquerda), 1 (Direita)


// --- VARIÁVEIS DE ESTADO E NAVEGAÇÃO ---
enum EstadoRobo { AGUARDANDO_ALVO, NAVEGANDO };
EstadoRobo estadoAtual = AGUARDANDO_ALVO;
double targetLat = 0.0, targetLng = 0.0;
const float RAIO_PROXIMIDADE = 3.0; 
String inputBuffer = "";
bool permitirMovimento = true; // Começa permitindo o movimento por padrão


// --- VARIÁVEIS DOS SERVOS ---
Servo servo1;
Servo servo2;
int posAtual1 = 10; 
int posAtual2 = 90;
int intervaloPaso = 15; 
const int PINO_SERVO1 = 8;
const int PINO_SERVO2 = 14;

// Adicione junto com as definições de estados existentes:
const int MANUAL = 99; 


//
// --- DEFINIÇÃO DOS PINOS DOS SENSORES ---
//
const int PINO_UMIDADE_SOLO   = 15; // Sensor Capacitivo (Analógico)
const int PINO_MQ135          = 16; // Sensor de Gás/Qualidade do Ar (Analógico)
const int PINO_MQ2            = 17; // Sensor de Gás/Fumaça (Analógico)

const int PINO_DHT            = 12; // Sensor de Temperatura e Umidade (Digital)
const int PINO_PRESENCA_AGUA  = 13; // Sensor de nível/presença de água (Digital)

DHT dht(PINO_DHT, DHT11);

// --- STRUCT PARA AGRUPAR AS LEITURAS ---
struct DadosSensores {
  int umidadeSolo;      // Mapeado 0 a 100
  int qualidadeArMQ135; // Mapeado 0 a 100
  int gasMQ2;          // Mapeado 0 a 100
  float temperatura;    // DHT11
  int umidadeAr;        // DHT11
  bool temAgua;         // Digital (true/false)
};

// Instância global da struct para ser acessada de qualquer lugar do código
DadosSensores sensoresAtuais;

// Controle de tempo para leitura dos sensores
unsigned long tempoUltimaLeituraSensores = 0;
const unsigned long INTERVALO_SENSORES = 60000; // Atualiza a cada 60 segundos (ideal para o DHT11)



void setup() {
  Serial.begin(115200);
  Wire.begin();
  compass.init();
  dht.begin();
  pixels.begin();
  
  // Pinos dos Motores
  pinMode(PIN_IN1, OUTPUT); pinMode(PIN_IN2, OUTPUT);
  // Pinos dos Motores
  pinMode(PIN_IN3, OUTPUT); pinMode(PIN_IN4, OUTPUT);
 
  // Pinos dos Sensores Ultrassônicos
  pinMode(TRIG_CENTRO, OUTPUT);
  pinMode(TRIG_ESQUERDA, OUTPUT);
  pinMode(TRIG_DIREITA, OUTPUT);
  pinMode(ECHO_COMUM, INPUT);

  pararMotores();
  
  servo1.attach(PINO_SERVO1);
  servo2.attach(PINO_SERVO2);
  servo1.write(posAtual1);
  servo2.write(posAtual2);
  delay(500); 
  servo1.detach();
  servo2.detach();
  
  Serial.println(F("uno: inicializado_com_sucesso"));
}

void loop() {
  atualizarSensoresAmbientais();
  atualizarSonares();
  
  // Chama o arco-íris de forma contínua. 
  // O número 10 é o tempo de espera (antigo wait) entre cada mudança de cor.
  atualizarRainbow(10); 

  if (estadoAtual == NAVEGANDO) {
    navegarAteAlvo(); 
  }
  
  //serialEvent(); // Continua ouvindo o ESP32 instantaneamente!
    
}


// Variáveis globais para controlar a animação sem travar
unsigned long tempoUltimoArcoIris = 0;
long frameArcoIris = 0; // Substitui o 'firstPixelHue' do loop for

void atualizarRainbow(int wait) {
  // Verifica se já passou o tempo necessário para o próximo quadro
  if (millis() - tempoUltimoArcoIris >= (unsigned long)wait) {
    tempoUltimoArcoIris = millis(); // Reseta o cronômetro para o próximo quadro

    // Desenha as cores atuais na fita de LEDs
    for(int i = 0; i < pixels.numPixels(); i++) {
      int pixelHue = frameArcoIris + (i * 65536L / pixels.numPixels());
      pixels.setPixelColor(i, pixels.gamma32(pixels.ColorHSV(pixelHue)));
    }
    pixels.show(); // Atualiza a fita para mostrar as novas cores

    // Avança o passo da cor para o próximo quadro
    frameArcoIris += 256;

    // Se completou as 5 voltas inteiras no espectro de cores, reseta o ciclo
    if (frameArcoIris >= 5 * 65536L) {
      frameArcoIris = 0;
    }
  }
}
