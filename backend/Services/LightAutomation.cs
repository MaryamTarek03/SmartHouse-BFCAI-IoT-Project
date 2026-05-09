using System.Collections.Concurrent;
using backend.Core.Models;
using backend.Mqtt;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using backend.Models;

namespace backend.Services;

/// <summary>
/// Reacts to motion sensor events and automatically controls lights.
/// Motion detected → light ON. No motion for N consecutive readings → light OFF.
///
/// Reacts to light level sensor events and automatically controls lights.
/// Low light level → light ON. High light level → light OFF.
/// 
/// Respects manual overrides.
/// </summary>
public class LightAutomation(MqttService mqtt, OverrideTracker overrides, ILogger<LightAutomation> logger)
{
    private const int NoMotionThreshold = 4;       // when to decide there is no motion anymore
    private const double DarkThreshold = 200.0;    // lux — below this, turn light ON
    private const double BrightThreshold = 400.0;  // lux — above this, turn light OFF (hysteresis)

    // (homeId, room) -> consecutive no-motion count
    private readonly ConcurrentDictionary<(string, string), int> _noMotionCounts = new();

    public async Task HandleLightAsync(SensorEvent evt, RoomState currentState)
    {
        if (evt.Type != SensorType.Motion && evt.Type != SensorType.LightLevel)
            return;

        if (overrides.IsOverridden(evt.HomeId, evt.Room, Device.Light))
            return;

        var key = (evt.HomeId, evt.Room);
        var motion = evt.Detected ?? currentState.MotionDetected;
        var lux = evt.Value ?? currentState.LightLevel;

        if (motion) // if detected = true
        {
            _noMotionCounts[key] = 0;

            // if there is movement, and it's dark, turn the light ON
            if (currentState.LightState == "OFF" && lux <= DarkThreshold)
            {
                await PublishLightCommand(evt.HomeId, evt.Room,"ON");
                logger.LogInformation("[AUTO] {Room} light ON (motion detected)", evt.Room);
            }
        }
        else
        {
            var count = _noMotionCounts.AddOrUpdate(key, 1, (_, c) => c + 1);

            // if no movement or it's too bright, turn the light OFF
            if ((count >= NoMotionThreshold || lux >= BrightThreshold) && currentState.LightState == "ON")
            {
                await PublishLightCommand(evt.HomeId, evt.Room, "OFF");
                logger.LogInformation("[AUTO] {Room} light OFF (no motion x{Count})", evt.Room, count);
            }
        }
    }

    private async Task PublishLightCommand(string homeId, string room, string state)
    {
        var topic = $"home/{homeId}/{room}/light/state";
        var payload = JsonSerializer.Serialize(new { state });
        await mqtt.PublishAsync(topic, payload);
    }
}
