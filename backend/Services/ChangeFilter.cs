using System.Collections.Concurrent;
using backend.Core.Models;
using backend.Models;

namespace backend.Services;

public class ChangeFilter
{
    private const double TemperatureThreshold = 0.5;

    // Key: (homeId, room, sensorType) -> last logged value as string
    private readonly ConcurrentDictionary<(string, string, SensorType), string> _lastLogged = new();

    /// <summary>
    /// Returns true if the sensor event represents a meaningful change worth persisting.
    /// </summary>
    public bool IsSignificant(SensorEvent evt)
    {
        var key = (evt.HomeId, evt.Room, evt.Type);

        switch (evt.Type)
        {
            case SensorType.Temperature:
            {
                if (!evt.Value.HasValue)
                    return false;

                var currentStr = evt.Value.Value.ToString("F1");

                if (!_lastLogged.TryGetValue(key, out var lastStr))
                {
                    _lastLogged[key] = currentStr;
                    return true; // first reading is always significant
                }

                if (double.TryParse(lastStr, out var lastVal) &&
                    Math.Abs(evt.Value.Value - lastVal) >= TemperatureThreshold)
                {
                    _lastLogged[key] = currentStr;
                    return true;
                }

                return false;
            }

            case SensorType.Door:
            case SensorType.Light:
            {
                var currentState = evt.State ?? "";

                if (!_lastLogged.TryGetValue(key, out var lastState))
                {
                    _lastLogged[key] = currentState;
                    return true;
                }

                if (!string.Equals(currentState, lastState, StringComparison.OrdinalIgnoreCase))
                {
                    _lastLogged[key] = currentState;
                    return true;
                }

                return false;
            }

            case SensorType.Smoke:
            case SensorType.Motion:
            {
                var currentDetected = (evt.Detected ?? false).ToString();

                if (!_lastLogged.TryGetValue(key, out var lastDetected))
                {
                    _lastLogged[key] = currentDetected;
                    return true;
                }

                if (!string.Equals(currentDetected, lastDetected, StringComparison.OrdinalIgnoreCase))
                {
                    _lastLogged[key] = currentDetected;
                    return true;
                }

                return false;
            }

            default:
                return true;
        }
    }
}
