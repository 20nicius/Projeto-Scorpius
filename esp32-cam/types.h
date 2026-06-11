#ifndef TYPES_H
#define TYPES_H

#include <Arduino.h>

struct DadosSensores {
  float temperatura;
  float umidadeAr;
  int umidadeSolo;
  int gasToxico;
  int gasVolatil;
  bool chuva;
  String dataHora;
  float latitude;
  float longitude;
};

#endif
