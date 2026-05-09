using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using backend.Mqtt;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace api.Hubs;

[Authorize]
public class HomeHub(HomeStateStore store, AuthService auth, MqttService mqtt, OverrideTracker overrides) : Hub
{
    /// <summary>
    /// Client calls this to join a specific home's update group.
    /// Verifies ownership before allowing access.
    /// </summary>
    public async Task JoinHome(string homeId)
    {
        var userId = GetUserId();
        if (userId == null) { await Clients.Caller.SendAsync("Error", "Not authenticated"); return; }

        if (!await auth.OwnsHomeAsync(userId.Value, homeId))
        {
            await Clients.Caller.SendAsync("Error", "You don't own this home");
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, $"home-{homeId}");

        // Send current state snapshot + overrides
        var snapshot = store.GetHomeSnapshot(homeId);
        await Clients.Caller.SendAsync("HomeSnapshot", homeId, snapshot);
        await Clients.Caller.SendAsync("OverrideState", overrides.GetActiveOverrides(homeId));
    }

    /// <summary>
    /// Client controls a device. Publishes MQTT command + sets override + pushes override state to group.
    /// </summary>
    public async Task ControlDevice(string homeId, string room, string device, string state)
    {
        var userId = GetUserId();
        if (userId == null) { await Clients.Caller.SendAsync("Error", "Not authenticated"); return; }

        if (!await auth.OwnsHomeAsync(userId.Value, homeId))
        {
            await Clients.Caller.SendAsync("Error", "You don't own this home");
            return;
        }

        device = device.ToUpperInvariant();
        state = state.ToUpperInvariant();

        // Set override to suppress automation
        overrides.Set(homeId, room, device);

        // Publish MQTT command
        var topic = $"home/{homeId}/{room}/{device.ToLowerInvariant()}/state";
        var payload = JsonSerializer.Serialize(new { room, state });
        await mqtt.PublishAsync(topic, payload);

        // Push updated overrides to the entire home group
        await Clients.Group($"home-{homeId}").SendAsync("OverrideState", overrides.GetActiveOverrides(homeId));
    }

    /// <summary>
    /// Client removes an override, re-enabling automation. Pushes updated state to group.
    /// </summary>
    public async Task RemoveOverride(string homeId, string room, string device)
    {
        var userId = GetUserId();
        if (userId == null) { await Clients.Caller.SendAsync("Error", "Not authenticated"); return; }

        if (!await auth.OwnsHomeAsync(userId.Value, homeId))
        {
            await Clients.Caller.SendAsync("Error", "You don't own this home");
            return;
        }

        overrides.Remove(homeId, room, device);

        // Push updated overrides to the entire home group
        await Clients.Group($"home-{homeId}").SendAsync("OverrideState", overrides.GetActiveOverrides(homeId));
    }

    public async Task LeaveHome(string homeId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"home-{homeId}");
    }

    private int? GetUserId()
    {
        var claim = Context.User?.FindFirst("sub")?.Value
                 ?? Context.User?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return claim != null && int.TryParse(claim, out var id) ? id : null;
    }
}
