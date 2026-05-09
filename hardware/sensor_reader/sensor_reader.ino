#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

// WiFi & MQTT config
#define WIFI_SSID "WIFI"
#define WIFI_PASSWORD "PASSWORD"
const char* BROKER_IP = "192.168.1.12"; 
const int PORT = 1883;

const char* HOME_ID = "1";
const char* ROOM = "diningroom";

#define PIN_LED_GREEN D1   // Room Light
#define PIN_LED_YELLOW D2  // Fan
#define PIN_LED_RED D5     // Smoke Alarm Indicator
#define PIN_PIR D6         // Motion Sensor
#define PIN_LDR A0         // LDR (Analog Input)
#define PIN_BUTTON D3      // Door Sensor (Flash Button)
#define PIN_DHT D7         // DHT11 Sensor

#define DHTTYPE DHT11
DHT dht(PIN_DHT, DHTTYPE);

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastSensorRead = 0;
unsigned long lastSmokeCheck = 0;

int lastPirState = LOW;
int lastLdrState = -1;
int lastButtonState = HIGH;
bool doorOpen = false;

// MQTT Helpers
void publishJson(const char* deviceOrSensor, const char* jsonPayload, bool isState = false) {
  char topic[64];
  sprintf(topic, "home/%s/%s/%s/%s", HOME_ID, ROOM, deviceOrSensor, isState ? "state" : "value");
  client.publish(topic, jsonPayload);
  
  // Flash built-in LED to with every publish
  digitalWrite(LED_BUILTIN, LOW);
  delay(20);
  digitalWrite(LED_BUILTIN, HIGH);
}

void on_message(char* topic, byte* payload, unsigned int length) {
  // Convert payload to null-terminated string
  char msg[length + 1];
  for (unsigned int i = 0; i < length; i++) {
    msg[i] = (char)payload[i];
  }
  msg[length] = '\0';
  
  Serial.printf("Command received on %s: %s\n", topic, msg);

  // Flash built-in LED to indicate receiving a command
  digitalWrite(LED_BUILTIN, LOW);
  delay(20);
  digitalWrite(LED_BUILTIN, HIGH);

  // Simple string matching to avoid heavy JSON libraries
  // If the command contains ("state":"ON") or ("state": "ON"), then it is ON
  bool isOn = (strstr(msg, "\"state\":\"ON\"") != NULL || strstr(msg, "\"state\": \"ON\"") != NULL);
  bool isOff = (strstr(msg, "\"state\":\"OFF\"") != NULL || strstr(msg, "\"state\": \"OFF\"") != NULL);

  if (strstr(topic, "/light/") != NULL) {
    if (isOn) digitalWrite(PIN_LED_GREEN, HIGH);
    else if (isOff) digitalWrite(PIN_LED_GREEN, LOW);
  } 
  else if (strstr(topic, "/fan/") != NULL) {
    if (isOn) digitalWrite(PIN_LED_YELLOW, HIGH);
    else if (isOff) digitalWrite(PIN_LED_YELLOW, LOW);
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Create a random ID
    String clientId = "ESP8266Client-";
    clientId += String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");

      char subTopic[64];
      sprintf(subTopic, "home/%s/%s/+/state", HOME_ID, ROOM);
      client.subscribe(subTopic);
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  // Serial.begin(115200);
  Serial.begin(9600);
  
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_LDR, INPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  
  digitalWrite(LED_BUILTIN, HIGH);    // inverted
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
  digitalWrite(PIN_LED_RED, LOW);

  dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("---");
  Serial.print("\nConnecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");

    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
  }
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("\nWiFi connected! IP: " + WiFi.localIP().toString());

  client.setServer(BROKER_IP, PORT);
  client.setCallback(on_message);
  
  randomSeed(analogRead(A0));
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  unsigned long now = millis();

  // Read sensors (PIR and Door)
  int currentPirState = digitalRead(PIN_PIR);
  if (currentPirState != lastPirState) {
    lastPirState = currentPirState;
    char payload[64];
    sprintf(payload, "{\"detected\":%s}", currentPirState == HIGH ? "true" : "false");
    publishJson("motion", payload);
    Serial.printf("[PIR] Motion %s\n", currentPirState == HIGH ? "Detected" : "Ended");
  }

  // Button acts as a Door toggle
  int currentButtonState = digitalRead(PIN_BUTTON);
  if (currentButtonState == LOW && lastButtonState == HIGH) {
    // Button pressed: Toggle Door State
    doorOpen = !doorOpen;
    char payload[64];
    sprintf(payload, "{\"state\":\"%s\"}", doorOpen ? "OPEN" : "CLOSED");
    publishJson("door", payload, true); // door uses /state topic
    Serial.printf("[DOOR] Toggled to %s\n", doorOpen ? "OPEN" : "CLOSED");
    delay(200); // Simple debounce
  }
  lastButtonState = currentButtonState;

  // Read sensors every 5 seconds (DHT & LDR)
  if (now - lastSensorRead > 5000) {
    lastSensorRead = now;

    // Temperature
    float t = dht.readTemperature();
    if (!isnan(t)) {
      char payload[64];
      sprintf(payload, "{\"value\":%.1f,\"unit\":\"C\"}", t);
      Serial.printf("{\"value\":%.1f,\"unit\":\"C\"}\n", t);
      publishJson("temperature", payload);
    }

    // Light Level (LDR) 
    // Read analog value (0 - 1023)
    int rawLdr = analogRead(PIN_LDR);
    int adjustedLdr = constrain(map(rawLdr, 600, 1023, 0, 1023), 0, 1023);
    
    if (abs(adjustedLdr - lastLdrState) > 20 || lastLdrState == -1) {
      int temp = lastLdrState;
      lastLdrState = adjustedLdr;
      
      char payload[64];
      sprintf(payload, "{\"value\":%d,\"unit\":\"lux\"}", adjustedLdr);
      publishJson("lightlevel", payload);
      Serial.printf("[LDR] Analog %d -> %d lux [RAW] %d\n", temp, adjustedLdr, rawLdr);
    }
  }

  // Random Smoke Simulation every 10 seconds
  if (now - lastSmokeCheck > 10000) {
    lastSmokeCheck = now;
    
    bool hasSmoke = (random(100) < 20); 
    
    digitalWrite(PIN_LED_RED, hasSmoke ? HIGH : LOW);
    
    char payload[64];
    sprintf(payload, "{\"detected\":%s}", hasSmoke ? "true" : "false");
    publishJson("smoke", payload);
    
    if (hasSmoke) Serial.println("[SMOKE] 🚨 Simulated smoke detected!");
  }
}
