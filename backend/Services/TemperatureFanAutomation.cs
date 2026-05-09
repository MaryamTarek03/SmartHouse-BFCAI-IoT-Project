using System.Collections.Concurrent;
using backend.Core.Models;
using backend.Mqtt;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using backend.Models;

namespace backend.Services;

/// <summary>
/// Reacts to temperature sensor events and automatically controls the fan.
/// Temp above threshold → fan ON. Temp below threshold → fan OFF.
/// Respects manual overrides.
/// </summary>
public class TemperatureFanAutomation(
    MqttService mqtt,
    OverrideTracker overrides,
    ILogger<TemperatureFanAutomation> logger)
{
    private const double FanOnThreshold = 30.0;
    private const double FanOffThreshold = 25.0;

    public async Task HandleTemperatureAsync(SensorEvent evt, RoomState currentState)
    {
        if (evt.Type != SensorType.Motion && evt.Type != SensorType.Temperature)
            return;

        if (overrides.IsOverridden(evt.HomeId, evt.Room, Device.Fan))
            return;

        var temp = evt.Value ?? currentState.Temperature;
        var motion = evt.Detected ?? currentState.MotionDetected;

        if (temp >= FanOnThreshold && motion && currentState.FanState == "OFF")
        {
            await PublishFanCommand(evt.HomeId, evt.Room, "ON");
            logger.LogInformation("[AUTO] {Room} fan ON (temp {Temp:F1}°C >= {Threshold}°C)", evt.Room, temp, FanOnThreshold);
        }
        else if (temp <= FanOffThreshold && currentState.FanState == "ON")
        {
            await PublishFanCommand(evt.HomeId, evt.Room, "OFF");
            logger.LogInformation("[AUTO] {Room} fan OFF (temp {Temp:F1}°C <= {Threshold}°C)", evt.Room, temp, FanOffThreshold);
        }
    }

    private async Task PublishFanCommand(string homeId, string room, string state)
    {
        var topic = $"home/{homeId}/{room}/fan/state";
        var payload = JsonSerializer.Serialize(new { state });
        await mqtt.PublishAsync(topic, payload);
    }
}
