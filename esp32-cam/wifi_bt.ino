// =========================================================================
//  wifi_bt.ino  —  BLE NimBLE (Nordic UART Service) + WiFi multi-rede
// =========================================================================

/*
class BleServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pSvr, NimBLEConnInfo& connInfo) override {
    ble_client_connected = true; 
    espLog(F("[BLE] Cliente conectado."));
  }

  void onDisconnect(NimBLEServer* pSvr, NimBLEConnInfo& connInfo, int reason) override {
    ble_client_connected = false;
    espLog(F("[BLE] Cliente desconectado."));
    NimBLEDevice::startAdvertising();
  }
};

class BleRxCB : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) override {
    std::string val = pChar->getValue();
    for (char c : val) {
      if (c == '\n' || c == '\r') {
        if (bleRxBuffer.length() > 0 && !bleMsgReady) {
          blePendingMsg = bleRxBuffer;
          bleRxBuffer   = "";
          bleMsgReady   = true;
        }
      } else {
        if (bleRxBuffer.length() < 512) bleRxBuffer += c;
      }
    }
  }
};

void startBLE() {
  if (ble_started) return;

  NimBLEDevice::init(BLE_DEVICE_NAME);
  pBleServer = NimBLEDevice::createServer();
  pBleServer->setCallbacks(new BleServerCB());

  NimBLEService* pSvc = pBleServer->createService(NUS_SERVICE_UUID);

  // TX: ESP → Phone (notify)
  pTxChar = pSvc->createCharacteristic(
    NUS_TX_UUID,
    NIMBLE_PROPERTY::NOTIFY
  );

  // RX: Phone → ESP
  pRxChar = pSvc->createCharacteristic(
    NUS_RX_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  pRxChar->setCallbacks(new BleRxCB());

  pSvc->start();

  NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
  pAdv->addServiceUUID(NUS_SERVICE_UUID);
  pAdv->start();

  ble_started   = true;
  bleRxBuffer   = "";
  bleMsgReady   = false;

  espLog(F("[BLE] NimBLE iniciado. Aguardando credenciais..."));
}

void stopBLE() {
  if (!ble_started) return;
  NimBLEDevice::deinit(true);  
  pBleServer    = nullptr;
  pTxChar       = nullptr;
  pRxChar       = nullptr;
  ble_started   = false;
  ble_client_connected = false;
  delay(200);
  espLog(F("[BLE] NimBLE desligado."));
}

void bleNotify(const String& msg) {
  if (!ble_started || !ble_client_connected || !pTxChar) return;
  const uint8_t CHUNK = 20;           
  for (int i = 0; i < (int)msg.length(); i += CHUNK) {
    String chunk = msg.substring(i, i + CHUNK);
    pTxChar->setValue((uint8_t*)chunk.c_str(), chunk.length());
    pTxChar->notify();
    delay(20);
  }
  const uint8_t nl = '\n';
  pTxChar->setValue(&nl, 1);
  pTxChar->notify();
}

void handleBLERx() {
  if (!bleMsgReady) return;
  String line   = blePendingMsg;
  bleMsgReady   = false;
  blePendingMsg = "";
  processBLELine(line);
}

void processBLELine(const String& line) {
  static bool servidor_confirmou_ok = false;
  String lc = line;
  lc.toLowerCase();
  lc.trim();

  Serial.print("[BLE-DEBUG] Recebido: ");
  espLog(lc);

  if (lc == "ok") {
    servidor_confirmou_ok = true;
    espLog(F("[BLE] Handshake OK."));
    return;
  }

  if (!lc.startsWith("wifi:")) return;

  int jsonStart = line.indexOf('{');
  if (jsonStart < 0) return;
  String jsonPart = line.substring(jsonStart);

  DynamicJsonDocument doc(1024);
  DeserializationError err = deserializeJson(doc, jsonPart);
  if (err) {
    espLog(F("[BLE] Erro JSON"));
    return;
  }

  preferences.begin("wifi-cfg", false);
  preferences.putString("wifi_json", jsonPart);
  preferences.end();
  
  espLog(F("[BLE] Credenciais salvas. Enviando ID..."));
  String resp = "ID:" + String(meuIDnumeral);
  bleNotify(resp);
  
  // Handshake
  servidor_confirmou_ok = false;
  unsigned long startWait = millis();
  while (!servidor_confirmou_ok && (millis() - startWait < 15000)) {
    handleBLERx(); 
    delay(100); 
  }

  if (!servidor_confirmou_ok) {
    espLog(F("[BLE] Timeout handshake."));
  }

  delay(500); 
  wifi_configured = true;
  stopBLE();
  connectWiFi();
  vTaskDelay(pdMS_TO_TICKS(1000));
  enviarLocalAoUno(false);

  if (WiFi.status() != WL_CONNECTED) {
    wifi_configured = false;
    espLog(F("[WiFi] Falha. Retornando ao BLE."));
    startBLE();
  }
}
*/

void connectWiFi() {
  //preferences.begin("wifi-cfg", true);
  String wifiJson = "{"
                    "\":)\": \"26082008\","
                    "\"Family\": \"26100289\","
                    "\"Generoso\": \"cecm2024@\""
                    "}"; //preferences.getString("wifi_json", "");
  //preferences.end();

  if (wifiJson.length() == 0) {
    wifi_configured = false;
    return;
  }

  DynamicJsonDocument doc(1024);
  if (deserializeJson(doc, wifiJson) != DeserializationError::Ok) {
    wifi_configured = false;
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);

  bool connected = false;
  for (JsonPair kv : doc.as<JsonObject>()) {
    String ssid = kv.key().c_str();
    String pass = kv.value().as<String>();

    espLog(0, F("[WiFi] Conectando a: "));
    espLog(1, ssid);

    WiFi.begin(ssid.c_str(), pass.c_str());

    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 20) {
      delay(200);
      espLog(0, ".");
      retries++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      connected = true;
      espLog(0, F("[WiFi] IP: "));
      espLog(1, WiFi.localIP().toString());
      buildServerBase();
      break;
    }
    WiFi.disconnect(true);
    delay(300);
  }

  if (!connected) {
    wifi_configured = false;
  }
}

void buildServerBase() {
  String localIP = WiFi.localIP().toString();
  int lastDot    = localIP.lastIndexOf('.');
  if (lastDot < 0) return;
  if (serverBase.length() == 0) {
    serverBase = String(F("http://")) +
                 localIP.substring(0, lastDot) + "." +
                 String(F(SERVER_IP_PARTIAL)) + ":" +
                 String(F(SERVER_PORT));
  }

  espLog(0, F("[WiFi] Servidor: "));
  espLog(1, serverBase);
}
