using System.Text.Json;
using backend.Core.Models;
using backend.Models;

namespace backend.Mqtt;

public class MessageRouter
{
    private static readonly Dictionary<string, SensorType> TopicToSensorType = new(StringComparer.OrdinalIgnoreCase)
    {
        ["temperature"] = SensorType.Temperature,
        ["door"] = SensorType.Door,
        ["light"] = SensorType.Light,
        ["smoke"] = SensorType.Smoke,
        ["motion"] = SensorType.Motion,
        ["fan"] = SensorType.Fan,
        ["lightlevel"] = SensorType.LightLevel
    };

    public SensorEvent? Parse(string topic, string payload)
    {
        var parts = topic.Split('/');

        // Expected: home/{homeId}/{room}/{sensorType}/...
        if (parts.Length < 4)
            return null;

        var homeId = parts[1];
        var room = parts[2];
        var typeStr = parts[3];

        // Skip "set" command topics — we only process state/value topics
        if (parts is [_, _, _, _, "set", ..])
            return null;

        if (!TopicToSensorType.TryGetValue(typeStr, out var sensorType))
            return null; // unknown sensor type, skip

        var json = JsonDocument.Parse(payload);
        
        var evt = new SensorEvent
        {
            HomeId = homeId,
            Room = room,
            Type = sensorType,
            Value = json.RootElement.TryGetProperty("value", out var v) ? v.GetDouble() : null,
            Detected = json.RootElement.TryGetProperty("detected", out var d) ? d.GetBoolean() : null,
            State = json.RootElement.TryGetProperty("state", out var s) ? s.GetString() : null
        };

        return evt;
    }
}