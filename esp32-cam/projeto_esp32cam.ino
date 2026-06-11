// =========================================================================
//  projeto_esp32cam.ino  —  Arquivo Principal
//  Hardware : ESP32-CAM AI Thinker
//  Core     : ESP32 Arduino Core 3.3.5  (ArduinoDroid)
//  Libs ext : NimBLE-Arduino (h2zero)  |  ArduinoJson v6
// =========================================================================

// Desativa escuta passiva de outros beacons
#define CONFIG_BT_NIMBLE_ROLE_OBSERVER 0
// Permite apenas 1 conexão por vez (Celular com ESP)
#define CONFIG_BT_NIMBLE_MAX_CONNECTIONS 1
// Desativa o gerenciador de segurança se não usar PIN
#define CONFIG_BT_NIMBLE_SM 0

// define obrigatoriamente CAMERA_MODEL_AI_THINKER por segurança
#define CAMERA_MODEL_AI_THINKER

// MUDE AQUI quando o Uno estiver pronto:
#define UART0_UNO_ENABLED  true

// =========================================================================
//  INCLUDES
// =========================================================================
#include "esp_camera.h"
#include <WiFi.h>
#include <NimBLEDevice.h>
#include "FS.h"
#include "SD_MMC.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include "esp_wifi.h"
#include <ArduinoJson.h>
#include <NimBLEServer.h>
#include "types.h"
#include <Arduino.h>
#include <TinyGPS++.h>
#include "driver/uart.h"

#if UART0_UNO_ENABLED
#include <time.h>
#include "types.h"
#endif

// =========================================================================
//  SERVIDOR
// =========================================================================
#define SERVER_IP_PARTIAL  "204"
#define SERVER_PORT        "8082"
#define meuIDnumeral        1000456

String serverBase = "";  

// =========================================================================
//  INTERVALOS (segundos)
// =========================================================================
#define PHOTO_INTERVAL_SEC   60     
#define SERVER_CYCLE_SEC     20     

// =========================================================================
//  PINOS
// =========================================================================
#define SD_LED_PIN      33
#define FLASH_LED_PIN   4

#define GPS_RX          -1
#define GPS_TX          13 
#define PONTE_H_PWM_PIN 12  // Pino que controlará a velocidade/tensão


// =========================================================================
//  BLE — Nordic UART Service (NUS)
// =========================================================================
#define BLE_DEVICE_NAME  "ESP32-CAM_Config"
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  
#define NUS_TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  

// =========================================================================
//  PINAGEM AI-THINKER
// =========================================================================
#define PWDN_GPIO_NUM    32
#define RESET_GPIO_NUM   -1
#define XCLK_GPIO_NUM     0
#define SIOD_GPIO_NUM    26
#define SIOC_GPIO_NUM    27
#define Y9_GPIO_NUM      35
#define Y8_GPIO_NUM      34
#define Y7_GPIO_NUM      39
#define Y6_GPIO_NUM      36
#define Y5_GPIO_NUM      21
#define Y4_GPIO_NUM      19
#define Y3_GPIO_NUM      18
#define Y2_GPIO_NUM       5
#define VSYNC_GPIO_NUM   25
#define HREF_GPIO_NUM    23
#define PCLK_GPIO_NUM    22

// =========================================================================
//  VARIÁVEIS GLOBAIS
// =========================================================================
Preferences preferences;
HTTPClient http;
WiFiClientSecure client;
WiFiClient plainClient;

bool ble_client_connected = false; 
bool sd_card_initialized  = false;
bool isSending            = false;
bool wifi_configured      = true;
bool ble_started          = false;
bool ble_connected        = false;

// --- CONFIGURAÇÃO DO PWM (Ponte H) ---
const int pwmChannel = 0;     // Canal PWM do ESP32 (0 a 15)
const int pwmFreq = 5000;     // Frequência de 5KHz é ótima para motores
const int pwmResolution = 8;  // Resolução de 8 bits (valores de 0 a 255)
const int dutyCycle6V = 20;  // 127 é 50% de 255. Transforma 12V em 6V médios.

unsigned long lastPhotoTime = 0;
unsigned long lastCycleTime = 0;

unsigned long ultimoEnvioGpsUno = 0;
const unsigned long INTERVALO_ENVIO_UNO = 1000; // 1 segundo de delay

String groupName = "";

// --- OBJETOS ---
TinyGPSPlus gps;
HardwareSerial SerialGPS(2); // Usa a Serial2 do ESP32

// Localização do carrinho
String ultimaLocalizacaoRecebida = "";

// BLE (NimBLE)
/*
NimBLEServer*          pBleServer    = nullptr;
NimBLECharacteristic*  pTxChar       = nullptr;
NimBLECharacteristic*  pRxChar       = nullptr;
String                 bleRxBuffer   = "";
volatile bool          bleMsgReady   = false;
String                 blePendingMsg = "";
*/

// UART0 ← Arduino Uno
String uartBuffer = "";

unsigned long tempoUltimaTentativaWiFi = 0;
#define INTERVALO_RECONEXAO_WIFI 5000

// =========================================================================
//  PROTÓTIPOS
// =========================================================================
void   setupCamera();
void   processPhotoCycle();
void   initSDCard();
String getUniqueFilename();
bool   savePhotoToSD(camera_fb_t* fb, const String& filename);
void   saveDadosToSD(const String& jsonStr);
void   clearLocaisFolder();
void   setSdLed(bool state);
bool   tryServerConnect();
void   fetchProcessLocais();
void   sendDadosToServer(const String& jsonStr);
void   retryDadosFromSD();
bool   sendPhotoToServer(camera_fb_t* fb, const String& filename);
void   sendAllPhotosFromSD();
void   startBLE();
void   stopBLE();
void   bleNotify(const String& msg);
void   handleBLERx();
void   processBLELine(const String& line);
void   connectWiFi();
void   buildServerBase();
void   handleUartData();
void   enviarLocalAoUno(bool repetirAtual);
void   espLog(bool Pular, const String& msg);
void   enviarTelemetriaParaUno();

// =========================================================================
//  LOG
// =========================================================================
void espLog(bool Pular, const String& msg) {
  if (Pular) Serial.println(msg);
  else Serial.print(msg);
}

// =========================================================================
//  SETUP
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(SD_LED_PIN,    OUTPUT);
  pinMode(FLASH_LED_PIN, OUTPUT);
  //digitalWrite(SD_LED_PIN,    HIGH);  
  digitalWrite(FLASH_LED_PIN, LOW);
  
  // ── FACTORY RESET (GPIO 0) ─────────────────────────────────────────────
  //pinMode(XCLK_GPIO_NUM, INPUT_PULLUP);
  
  //Serial.println(F("[ESP] Verificando botao BOOT para Factory Reset..."));
  
  /*
  // Pequeno loop para dar tempo do usuário segurar o botão
  unsigned long checkStart = millis();
  bool resetTriggered = false;
  while(millis() - checkStart < 1500) {
    if (digitalRead(XCLK_GPIO_NUM) == LOW) {
      resetTriggered = true;
      break;
    }
    delay(50);
  }
  
  if (resetTriggered) {
    Serial.println(F("[ESP] >>> FACTORY RESET ATIVADO! <<<"));
    preferences.begin("wifi-cfg", false);
    preferences.clear();
    preferences.end();
    
    // Pisca o LED de status para confirmar o reset
    for(int i=0; i<5; i++) {
      digitalWrite(SD_LED_PIN, LOW); delay(100);
      digitalWrite(SD_LED_PIN, HIGH); delay(100);
    }
    
    Serial.println(F("[ESP] Credenciais apagadas. Reiniciando em modo BLE."));
    wifi_configured = false;
  } else {
    // Verificar credenciais normais
    preferences.begin("wifi-cfg", true);
    String savedJson = preferences.getString("wifi_json", "");
    preferences.end();

    if (savedJson.length() > 0) {
      Serial.println(F("[ESP] Credenciais encontradas. Tentando WiFi..."));
      connectWiFi();
      if (WiFi.status() == WL_CONNECTED) {
        wifi_configured = true;
      } else {
        Serial.println(F("[ESP] Falha ao conectar no WiFi salvo. Fallback para BLE."));
        wifi_configured = false;
      }
    } else {
      Serial.println(F("[ESP] Sem credenciais salvas. Iniciando BLE."));
      wifi_configured = false;
    }
  }

  // Se não configurou WiFi (ou resetou), inicia o BLE
  if (!wifi_configured) {
    startBLE();
  }
  */

  // Iniciando WI-FI
  connectWiFi();
  // Inicializa câmera e SD (GPIO 0 agora será usado pela câmera)
  setupCamera();
  initSDCard();
  
  SerialGPS.begin(9600, SERIAL_8N1, GPS_TX, GPS_RX);
  Serial.println(F("[GPS] Aguardando dados do módulo..."));
  
  // 2. Configura o PWM estilo ESP32 Core 2.x
  ledcSetup(pwmChannel, pwmFreq, pwmResolution);
  ledcAttachPin(PONTE_H_PWM_PIN, pwmChannel);
  
  delay(200);
  
  // Enviar local ao UNO
  enviarLocalAoUno(true);
  
  espLog(1, F("[ESP] Setup concluido."));
}

// =========================================================================
//  LOOP
// =========================================================================
void loop() {
  /*
  if (!wifi_configured) {
    handleBLERx();
    delay(10);
    return;
  }
  */
  
  ledcWrite(pwmChannel, dutyCycle6V); // Define o ciclo de trabalho inicial

  
  if (SerialGPS.available() > 100) { // Se tiver muitos caracteres acumulados
    while (SerialGPS.available() > 0) {
      SerialGPS.read(); // Joga fora o caractere antigo
      uart_flush_input(UART_NUM_2);
    }
  }


  // Se o WiFi não estiver conectado
  if (WiFi.status() != WL_CONNECTED) {
    // Verifica se já se passaram 5 segundos desde a última tentativa
    if (millis() - tempoUltimaTentativaWiFi >= INTERVALO_RECONEXAO_WIFI) {
      tempoUltimaTentativaWiFi = millis();
      connectWiFi(); // Tenta conectar
    }
    // Independente de ter tentado conectar ou não, se continua desconectado,
    // usamos o 'return' para sair do loop de forma NÃO-BLOQUEANTE.
    // Assim, o loop() reinicia imediatamente e continua lendo o GPS.
    return;
  }


  if (millis() - lastCycleTime > (SERVER_CYCLE_SEC * 1000UL)) {
    lastCycleTime = millis();
    if (tryServerConnect()) {
      sendAllPhotosFromSD();   
      retryDadosFromSD();      
    }
  }

  if (!isSending && millis() - lastPhotoTime > (PHOTO_INTERVAL_SEC * 1000UL)) {
    lastPhotoTime = millis();
    processPhotoCycle();
  }
  
  handleUartData();
  
  enviarTelemetriaParaUno();
  
  Serial.println("fim de loop");

  vTaskDelay(pdMS_TO_TICKS(1)); // Converte 1 milissegundo em Ticks com segurança
}
