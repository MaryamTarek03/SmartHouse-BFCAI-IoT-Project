using System.Collections.Concurrent;
using backend.Core.Models;
using backend.Models;

namespace backend.Services;

/// <summary>
/// SIMPLE CACHE
/// In-memory store for current states of all homes
/// thread-safe & highly concurrent
/// </summary>
public class HomeStateStore
{
    // homeId -> room -> RoomState
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, RoomState>> _homes = new();

    /// <summary>
    /// Fires when any room state changes. Parameters: homeId, updated RoomState.
    /// </summary>
    public event Action<string, RoomState>? OnStateChanged;

    /// <summary>
    /// Fires when a system log message is generated for a home.
    /// </summary>
    public event Action<string, string>? OnSystemLog;

    public void LogMessage(string homeId, string message)
    {
        OnSystemLog?.Invoke(homeId, message);
    }

    public void Update(string homeId, SensorEvent evt)
    {
        var rooms = _homes.GetOrAdd(homeId, _ => new ConcurrentDictionary<string, RoomState>());

        var room = rooms.GetOrAdd(evt.Room, _ => new RoomState
        {
            HomeId = homeId,
            Room = evt.Room
        });

        lock (room)
        {
            switch (evt.Type)
            {
                case SensorType.Temperature:
                    if (evt.Value.HasValue)
                        room.Temperature = evt.Value.Value;
                    break;

                case SensorType.Door:
                    if (!string.IsNullOrEmpty(evt.State))
                        room.DoorState = evt.State;
                    break;

                case SensorType.Light:
                    if (!string.IsNullOrEmpty(evt.State))
                        room.LightState = evt.State;
                    break;

                case SensorType.Smoke:
                    if (evt.Detected.HasValue)
                        room.SmokeDetected = evt.Detected.Value;
                    break;

                case SensorType.Motion:
                    if (evt.Detected.HasValue)
                        room.MotionDetected = evt.Detected.Value;
                    break;

                case SensorType.Fan:
                    if (!string.IsNullOrEmpty(evt.State))
                        room.FanState = evt.State;
                    break;

                case SensorType.LightLevel:
                    if (evt.Value.HasValue)
                        room.LightLevel = evt.Value.Value;
                    break;
            }

            room.LastUpdated = DateTime.UtcNow;
        }

        OnStateChanged?.Invoke(homeId, room);
    }

    public List<RoomState> GetHomeSnapshot(string homeId)
    {
        return _homes.TryGetValue(homeId, out var rooms) ? rooms.Values.ToList() : [];
    }

    public RoomState? GetRoomState(string homeId, string room)
    {
        if (_homes.TryGetValue(homeId, out var rooms) &&
            rooms.TryGetValue(room, out var state))
            return state;

        return null;
    }
}
