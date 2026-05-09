import json
import time
import random
import threading
import paho.mqtt.client as mqtt

BROKER_IP = "localhost"
PORT = 1883

HOME_ID = "1"

# Simulated rooms
ROOMS = ["livingroom", "bedroom", "kitchen"]

# Device states per room
room_states = {
    room: {
        "light": "OFF",
        "door": "CLOSED",
        "fan": "OFF",
        "smoke": False
    }
    for room in ROOMS
}


# ---------- MQTT CALLBACKS ----------

def on_connect(client, userdata, flags, rc):
    print("Connected to MQTT Broker")

    # Subscribe to control topics for all rooms
    for room in ROOMS:
        for device in ["light", "fan", "door"]:
            topic = f"home/{HOME_ID}/{room}/{device}/state"
            client.subscribe(topic)
            print(f"  Subscribed to {topic}")


def on_message(client, userdata, msg):
    """Handle state commands from the backend automation or user control."""
    try:
        payload = json.loads(msg.payload.decode())
    except json.JSONDecodeError:
        return

    for room in ROOMS:
        # Light commands
        if msg.topic == f"home/{HOME_ID}/{room}/light/state":
            if "state" in payload:
                room_states[room]["light"] = payload["state"]
                print(f"[LIGHT][{room}] -> {payload['state']}")

        # Fan commands
        elif msg.topic == f"home/{HOME_ID}/{room}/fan/state":
            if "state" in payload:
                room_states[room]["fan"] = payload["state"]
                print(f"[FAN][{room}] -> {payload['state']}")

        # Door commands
        elif msg.topic == f"home/{HOME_ID}/{room}/door/state":
            if "state" in payload:
                room_states[room]["door"] = payload["state"]
                print(f"[DOOR][{room}] -> {payload['state']}")


# ---------- SIMULATIONS ----------

def simulate_temperature(client, room):
    topic = f"home/{HOME_ID}/{room}/temperature/value"

    while True:
        temp = round(random.uniform(20, 35), 1)

        payload = {
            "value": temp,
            "unit": "C"
        }

        client.publish(topic, json.dumps(payload))
        print(f"[TEMP][{room}] {temp}°C")

        time.sleep(random.randint(4, 8))


def simulate_light_level(client, room):
    """Simulate ambient light level sensor (lux).
    Cycles through a day-like pattern with some noise."""
    topic = f"home/{HOME_ID}/{room}/lightlevel/value"

    base_lux = 300.0  # midpoint

    while True:
        # Simulate gradual changes with random drift
        base_lux += random.uniform(-50, 50)
        base_lux = max(50, min(800, base_lux))  # clamp 50-800 lux

        lux = round(base_lux + random.uniform(-20, 20), 1)

        payload = {
            "value": lux,
            "unit": "lux"
        }

        client.publish(topic, json.dumps(payload))
        print(f"[LUX][{room}] {lux} lux")

        time.sleep(random.randint(6, 12))


def simulate_smoke(client, room):
    topic = f"home/{HOME_ID}/{room}/smoke/value"

    while True:
        # small chance of smoke event
        smoke_detected = random.choices([True, False], weights=[1, 20])[0]
        room_states[room]["smoke"] = smoke_detected

        payload = {
            "detected": smoke_detected
        }

        client.publish(topic, json.dumps(payload))

        if smoke_detected:
            print(f"[SMOKE][{room}] 🚨 DETECTED!")
        else:
            print(f"[SMOKE][{room}] safe")

        time.sleep(random.randint(10, 20))


def simulate_motion(client, room):
    topic = f"home/{HOME_ID}/{room}/motion/value"

    while True:
        motion_detected = random.choices([True, False], weights=[7, 3])[0]

        payload = {
            "detected": motion_detected
        }

        client.publish(topic, json.dumps(payload))

        if motion_detected:
            print(f"[MOTION][{room}] 🏃 detected!")
        else:
            print(f"[MOTION][{room}] no motion")

        time.sleep(random.randint(5, 10))


# ---------- MAIN ----------

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

client.connect(BROKER_IP, PORT, 60)
client.loop_start()

# Start simulation threads per room
for room in ROOMS:
    threading.Thread(target=simulate_temperature, args=(client, room), daemon=True).start()
    threading.Thread(target=simulate_light_level, args=(client, room), daemon=True).start()
    threading.Thread(target=simulate_smoke, args=(client, room), daemon=True).start()
    threading.Thread(target=simulate_motion, args=(client, room), daemon=True).start()

# Keep running
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("Stopping...")
    client.loop_stop()
    client.disconnect()