/*
 * Smart Parking Gate Barrier Controller - Arduino Uno R3
 *
 * So do dau noi phan cung:
 *   - D4  -> Day tin hieu (cam) cua Servo SG90
 *   - D2  -> Cam bien hong ngoai IR1 (du phong truoc barie)
 *   - D3  -> Cam bien hong ngoai IR2 (du phong sau barie)
 *   - GND -> Noi chung mass (GND) voi Breadboard / Adapter 5V DC / Servo SG90
 *   - Adapter 5V DC (+) -> Breadboard (+) -> Day do VCC cua Servo SG90
 *
 * Giao thuc Serial (9600 baud, ket thuc bang '\n'):
 *   Nhan tu PC:
 *     PING          -> Tra ve "PONG"
 *     OPEN          -> Mo barie trong 5000 ms (mac dinh), tra ve "ACK:OPEN"
 *     OPEN:<ms>     -> Mo barie trong <ms> mili-giay (1000..30000), tra ve "ACK:OPEN"
 *     CLOSE         -> Dong barie ngay lap tuc, tra ve "ACK:CLOSE"
 *     STATUS        -> Tra ve "STATUS:OPEN" hoac "STATUS:CLOSED"
 *   Su kien gui ve PC:
 *     READY:GATE_CONTROLLER
 *     EVENT:CLOSED
 */

#include <Servo.h>

// Chan ket noi theo so do
const uint8_t PIN_SERVO = 4;
const uint8_t PIN_IR1 = 2;
const uint8_t PIN_IR2 = 3;

// Goc dong / mo cua thanh chan SG90 (da can chinh theo co khi thuc te: 60 -> 120).
// Neu lap can gat bi nguoc chieu, doi lai 2 gia tri nay (vi du 120 va 60).
const int ANGLE_CLOSED = 60;
const int ANGLE_OPEN = 120;

// Thoi gian mo mac dinh (5 giay)
const unsigned long DEFAULT_OPEN_DURATION_MS = 5000UL;
const unsigned long MIN_OPEN_DURATION_MS = 1000UL;
const unsigned long MAX_OPEN_DURATION_MS = 30000UL;

// Dat thanh true khi ban gan them 2 cam bien IR1 (D2) va IR2 (D3).
// Mac dinh cam bien hong ngoai FC-51/TCRT5000 xuat LOW khi co vat can.
const bool USE_IR_SENSORS = false;
const uint8_t IR_DETECTED_LEVEL = LOW;
const unsigned long IR_CLEAR_DELAY_MS = 1200UL;
const unsigned long IR_MAX_HOLD_MS = 15000UL;

Servo gateServo;
bool gateIsOpen = false;
unsigned long gateOpenedAt = 0;
unsigned long gateOpenDuration = DEFAULT_OPEN_DURATION_MS;
bool ir2SeenAfterOpen = false;
unsigned long ir2ClearedAt = 0;

String serialBuffer = "";

void moveServoSmooth(int fromAngle, int toAngle) {
  int step = (toAngle >= fromAngle) ? 2 : -2;
  if (step > 0) {
    for (int angle = fromAngle; angle <= toAngle; angle += step) {
      gateServo.write(angle);
      delay(12);
    }
  } else {
    for (int angle = fromAngle; angle >= toAngle; angle += step) {
      gateServo.write(angle);
      delay(12);
    }
  }
  gateServo.write(toAngle);
}

void openGate(unsigned long durationMs) {
  if (durationMs < MIN_OPEN_DURATION_MS) durationMs = MIN_OPEN_DURATION_MS;
  if (durationMs > MAX_OPEN_DURATION_MS) durationMs = MAX_OPEN_DURATION_MS;

  gateOpenDuration = durationMs;
  gateOpenedAt = millis();
  ir2SeenAfterOpen = false;
  ir2ClearedAt = 0;

  if (!gateIsOpen) {
    gateIsOpen = true;
    digitalWrite(LED_BUILTIN, HIGH);
    moveServoSmooth(ANGLE_CLOSED, ANGLE_OPEN);
  }
  Serial.println("ACK:OPEN");
}

void closeGate(bool emitEvent) {
  if (gateIsOpen) {
    gateIsOpen = false;
    digitalWrite(LED_BUILTIN, LOW);
    moveServoSmooth(ANGLE_OPEN, ANGLE_CLOSED);
    if (emitEvent) {
      Serial.println("EVENT:CLOSED");
    }
  }
}

void handleCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.length() == 0) return;

  if (cmd == "PING") {
    Serial.println("PONG");
  } else if (cmd == "OPEN") {
    openGate(DEFAULT_OPEN_DURATION_MS);
  } else if (cmd.startsWith("OPEN:")) {
    long requested = cmd.substring(5).toInt();
    unsigned long duration =
        (requested > 0) ? (unsigned long)requested : DEFAULT_OPEN_DURATION_MS;
    openGate(duration);
  } else if (cmd == "CLOSE") {
    closeGate(false);
    Serial.println("ACK:CLOSE");
  } else if (cmd == "STATUS") {
    Serial.println(gateIsOpen ? "STATUS:OPEN" : "STATUS:CLOSED");
  } else {
    Serial.print("ERR:UNKNOWN_CMD:");
    Serial.println(cmd);
  }
}

void updateGateTimer() {
  if (!gateIsOpen) return;
  unsigned long now = millis();
  unsigned long elapsed = now - gateOpenedAt;

  if (!USE_IR_SENSORS) {
    if (elapsed >= gateOpenDuration) {
      closeGate(true);
    }
    return;
  }

  // Logic du phong khi gan du IR1 (D2) va IR2 (D3)
  bool ir1Active = (digitalRead(PIN_IR1) == IR_DETECTED_LEVEL);
  bool ir2Active = (digitalRead(PIN_IR2) == IR_DETECTED_LEVEL);

  if (ir2Active) {
    ir2SeenAfterOpen = true;
    ir2ClearedAt = 0;
  } else if (ir2SeenAfterOpen && ir2ClearedAt == 0) {
    ir2ClearedAt = now;
  }

  // Khong dong khi IR1 hoac IR2 van con phat hien xe (tru khi qua nguong an toan)
  if ((ir1Active || ir2Active) && elapsed < IR_MAX_HOLD_MS) {
    return;
  }

  if (ir2ClearedAt > 0 && (now - ir2ClearedAt) >= IR_CLEAR_DELAY_MS) {
    closeGate(true);
  } else if (elapsed >= max(gateOpenDuration, IR_MAX_HOLD_MS)) {
    closeGate(true);
  }
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(PIN_IR1, INPUT_PULLUP);
  pinMode(PIN_IR2, INPUT_PULLUP);

  Serial.begin(9600);
  gateServo.attach(PIN_SERVO);
  gateServo.write(ANGLE_CLOSED);
  digitalWrite(LED_BUILTIN, LOW);

  delay(200);
  Serial.println("READY:GATE_CONTROLLER");
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialBuffer.length() > 0) {
        handleCommand(serialBuffer);
        serialBuffer = "";
      }
    } else if (serialBuffer.length() < 64) {
      serialBuffer += c;
    }
  }

  updateGateTimer();
}
