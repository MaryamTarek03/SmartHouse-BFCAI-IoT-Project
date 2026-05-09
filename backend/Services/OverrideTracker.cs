using System.Collections.Concurrent;
using backend.Models;

namespace backend.Services;

/// <summary>
/// Tracks manual user overrides for devices.
/// When a user manually controls a device, automation is suppressed for that device
/// for a configurable duration.
/// </summary>
public class OverrideTracker
{
    private static readonly TimeSpan DefaultDuration = TimeSpan.FromMinutes(10);

    // (homeId, room, device) -> expiry time
    private readonly ConcurrentDictionary<(string, string, string), DateTime> _overrides = new();

    /// <summary>
    /// Sets a manual override for a specific device in a room.
    /// </summary>
    public void Set(string homeId, string room, string device, TimeSpan? duration = null)
    {
        var key = (homeId, room, device.ToUpperInvariant());
        _overrides[key] = DateTime.UtcNow + (duration ?? DefaultDuration);
    }

    /// <summary>
    /// Returns true if automation should be suppressed for this device.
    /// </summary>
    public bool IsOverridden(string homeId, string room, Device device)
    {
        var key = (homeId, room, device.ToString().ToUpperInvariant());

        if (_overrides.TryGetValue(key, out var expiry))
        {
            if (DateTime.UtcNow < expiry)
                return true;

            // Override expired, clean up
            _overrides.TryRemove(key, out _);
        }

        return false;
    }

    /// <summary>
    /// Removes a manual override, re-enabling automation.
    /// </summary>
    public bool Remove(string homeId, string room, string device)
    {
        var key = (homeId, room, device.ToUpperInvariant());
        return _overrides.TryRemove(key, out _);
    }

    /// <summary>
    /// Returns all active (non-expired) overrides for a given home.
    /// </summary>
    public List<OverrideInfo> GetActiveOverrides(string homeId)
    {
        var now = DateTime.UtcNow;
        var result = new List<OverrideInfo>();

        foreach (var (key, expiry) in _overrides)
        {
            if (key.Item1 != homeId) continue;

            if (now >= expiry)
            {
                _overrides.TryRemove(key, out _);
                continue;
            }

            result.Add(new OverrideInfo
            {
                Room = key.Item2,
                Device = key.Item3,
                ExpiresAt = expiry,
                RemainingSeconds = (int)(expiry - now).TotalSeconds
            });
        }

        return result;
    }
}

public class OverrideInfo
{
    public required string Room { get; set; }
    public required string Device { get; set; }
    public DateTime ExpiresAt { get; set; }
    public int RemainingSeconds { get; set; }
}
