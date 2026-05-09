using System.Security.Claims;
using backend.Core.Models;
using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace api.Endpoints;

public static class HomeEndpoints
{
    public static WebApplication MapHomeEndpoints(this WebApplication app)
    {
        var homeGroup = app.MapGroup("/api/homes").RequireAuthorization();

        homeGroup.MapGet("/", async (
            ClaimsPrincipal user,
            SmartHouseDbContext db) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            var homes = await db.Homes
                .Where(h => h.OwnerId == userId)
                .Select(h => new { h.HomeId, h.Name, h.CreatedAt })
                .ToListAsync();

            return Results.Ok(homes);
        });

        homeGroup.MapPost("/", async (
            [FromBody] AddHomeRequest req,
            ClaimsPrincipal user,
            SmartHouseDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(req.HomeId))
                return Results.BadRequest(new { error = "HomeId is required" });

            if (string.IsNullOrWhiteSpace(req.Name))
                return Results.BadRequest(new { error = "Name is required" });

            var userId = AuthEndpoints.GetUserId(user);

            // Check if home is already claimed
            if (await db.Homes.AnyAsync(h => h.HomeId == req.HomeId))
                return Results.Conflict(new { error = "This home is already registered" });

            var home = new Home
            {
                HomeId = req.HomeId,
                Name = req.Name,
                OwnerId = userId
            };

            db.Homes.Add(home);
            await db.SaveChangesAsync();

            return Results.Created($"/api/homes/{home.HomeId}", new { home.HomeId, home.Name, home.CreatedAt });
        });

        homeGroup.MapDelete("/{homeId}", async (
            string homeId,
            ClaimsPrincipal user,
            SmartHouseDbContext db) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            var home = await db.Homes.FirstOrDefaultAsync(h => h.HomeId == homeId && h.OwnerId == userId);

            if (home == null)
                return Results.NotFound();

            db.Homes.Remove(home);
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        // --- Home Data ---

        homeGroup.MapGet("/{homeId}/state", async (
            string homeId,
            ClaimsPrincipal user,
            AuthService auth,
            HomeStateStore stateStore) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            if (!await auth.OwnsHomeAsync(userId, homeId))
                return Results.Forbid();

            var snapshot = stateStore.GetHomeSnapshot(homeId);
            return Results.Ok(snapshot);
        });

        homeGroup.MapGet("/{homeId}/{room}/state", async (
            string homeId,
            string room,
            ClaimsPrincipal user,
            AuthService auth,
            HomeStateStore stateStore) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            if (!await auth.OwnsHomeAsync(userId, homeId))
                return Results.Forbid();

            var state = stateStore.GetRoomState(homeId, room);
            return state is not null ? Results.Ok(state) : Results.NotFound();
        });

        homeGroup.MapGet("/{homeId}/logs", async (
            string homeId,
            ClaimsPrincipal user,
            AuthService auth,
            SmartHouseDbContext db,
            string? room,
            string? type,
            int? limit) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            if (!await auth.OwnsHomeAsync(userId, homeId))
                return Results.Forbid();

            var query = db.SensorLogs
                .Where(l => l.HomeId == homeId)
                .AsQueryable();

            if (!string.IsNullOrEmpty(room))
                query = query.Where(l => l.Room == room);

            if (!string.IsNullOrEmpty(type) && Enum.TryParse<SensorType>(type, ignoreCase: true, out var sensorType))
                query = query.Where(l => l.SensorType == sensorType);

            var logs = await query
                .OrderByDescending(l => l.Timestamp)
                .Take(limit ?? 50)
                .ToListAsync();

            return Results.Ok(logs);
        });

        // --- Device Control ---

        homeGroup.MapPost("/{homeId}/{room}/control", async (
            string homeId,
            string room,
            [FromBody] ControlRequest req,
            ClaimsPrincipal user,
            AuthService auth,
            backend.Mqtt.MqttService mqtt,
            OverrideTracker overrides) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            if (!await auth.OwnsHomeAsync(userId, homeId))
                return Results.Forbid();

            var device = req.Device.ToUpperInvariant();
            var state = req.State.ToUpperInvariant();

            // Validate device + state combos
            var valid = device switch
            {
                "LIGHT" => state is "ON" or "OFF",
                "FAN" => state is "ON" or "OFF",
                "DOOR" => state is "OPEN" or "CLOSED",
                _ => false
            };

            if (!valid)
                return Results.BadRequest(new { error = $"Invalid device '{req.Device}' or state '{req.State}'" });

            // Set manual override to suppress automation
            overrides.Set(homeId, room, device);

            // Publish the command via MQTT
            var topicType = device.ToLowerInvariant();
            var topic = $"home/{homeId}/{room}/{topicType}/state";
            var payload = System.Text.Json.JsonSerializer.Serialize(new { room, state });
            await mqtt.PublishAsync(topic, payload);

            return Results.Ok(new { device, state, overrideMinutes = 10 });
        });

        // --- Override Management ---

        homeGroup.MapGet("/{homeId}/overrides", async (
            string homeId,
            ClaimsPrincipal user,
            AuthService auth,
            OverrideTracker overrides) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            if (!await auth.OwnsHomeAsync(userId, homeId))
                return Results.Forbid();

            return Results.Ok(overrides.GetActiveOverrides(homeId));
        });

        homeGroup.MapDelete("/{homeId}/{room}/override/{device}", async (
            string homeId,
            string room,
            string device,
            ClaimsPrincipal user,
            AuthService auth,
            OverrideTracker overrides) =>
        {
            var userId = AuthEndpoints.GetUserId(user);
            if (!await auth.OwnsHomeAsync(userId, homeId))
                return Results.Forbid();

            var removed = overrides.Remove(homeId, room, device);
            return removed ? Results.Ok(new { message = "Override removed, automation resumed" }) : Results.NotFound();
        });

        return app;
    }
}

// DTOs
public class AddHomeRequest
{
    public string HomeId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
}

public class ControlRequest
{
    public string Device { get; set; } = string.Empty; // "light", "fan", "door"
    public string State { get; set; } = string.Empty;  // "ON"/"OFF" or "OPEN"/"CLOSED"
}
