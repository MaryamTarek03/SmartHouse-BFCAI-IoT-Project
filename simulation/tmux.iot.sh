#!/bin/bash

tmux new-session -d -s iot

# Rename window
tmux rename-window -t iot:0 'iot'

# Pane 0: Mosquitto
tmux send-keys -t iot:0 "mosquitto -c ~/Dev/Arduino/MQTT/mosquitto.conf -v" C-m

# Split horizontally (creates right pane)
tmux split-window -h -t iot:0

# Pane 1: Python simulator
tmux send-keys -t iot:0.1 "source ../.venv/bin/activate; python main.py" C-m

# Split vertically (bottom-right pane)
tmux split-window -v -t iot:0.1

# Pane 2: Broker subscriber
tmux send-keys -t iot:0.2 "mosquitto_sub -h localhost -t 'home/1/#'" C-m

# Optional: even layout
tmux select-layout -t iot tiled

# Attach session
tmux attach -t iot