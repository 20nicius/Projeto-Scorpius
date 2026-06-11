// =========================================
// camera.ino - Câmera OV2640 (AI Thinker)
// Core 3.3.5
// =========================================

void setupCamera() {
  camera_config_t config;
  config.ledc_channel  = LEDC_CHANNEL_0;
  config.ledc_timer    = LEDC_TIMER_0;
  config.pin_d0        = Y2_GPIO_NUM;
  config.pin_d1        = Y3_GPIO_NUM;
  config.pin_d2        = Y4_GPIO_NUM;
  config.pin_d3        = Y5_GPIO_NUM;
  config.pin_d4        = Y6_GPIO_NUM;
  config.pin_d5        = Y7_GPIO_NUM;
  config.pin_d6        = Y8_GPIO_NUM;
  config.pin_d7        = Y9_GPIO_NUM;
  config.pin_xclk      = XCLK_GPIO_NUM;
  config.pin_pclk      = PCLK_GPIO_NUM;
  config.pin_vsync     = VSYNC_GPIO_NUM;
  config.pin_href      = HREF_GPIO_NUM;
  config.pin_sscb_sda  = SIOD_GPIO_NUM;
  config.pin_sscb_scl  = SIOC_GPIO_NUM;
  config.pin_pwdn      = PWDN_GPIO_NUM;
  config.pin_reset     = RESET_GPIO_NUM;
  config.xclk_freq_hz  = 20000000; //20Mhz
  config.pixel_format  = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_UXGA;
    config.jpeg_quality = 5;
    config.fb_count     = 1;
  } else {
    config.frame_size   = FRAMESIZE_SVGA;
    config.jpeg_quality = 12;
    config.fb_count     = 1;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    espLog(1, F("[CAM] ERRO: Falha ao inicializar camera!"));
    return;
  }
  espLog(1, F("[CAM] Camera inicializada."));
}

void processPhotoCycle() {
  // Flash breve para iluminação
  digitalWrite(FLASH_LED_PIN, HIGH);
  EstacionarUNO(true);
  digitalWrite(FLASH_LED_PIN, LOW);
  vTaskDelay(pdMS_TO_TICKS(2000));
  
  camera_fb_t* fb = esp_camera_fb_get();
  
  vTaskDelay(pdMS_TO_TICKS(500));
  EstacionarUNO(false);

  if (!fb) {
    espLog(1, F("[CAM] ERRO: Falha ao capturar frame!"));
    return;
  }

  String filename = "";

  // 1. Backup local no SD
  if (sd_card_initialized) {
    filename = getUniqueFilename();
    if (filename.length() > 0) {
      savePhotoToSD(fb, filename);
    }
  }

  // 2. Enviar ao servidor se WiFi disponível e servidor acessível
  if (WiFi.status() == WL_CONNECTED && serverBase.length() > 0) {
    sendPhotoToServer(fb, filename);
  }

  esp_camera_fb_return(fb);
}
