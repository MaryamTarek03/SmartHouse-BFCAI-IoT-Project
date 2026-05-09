using System.Text.Json;
using backend.Core.Models;
using backend.Data;
using backend.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace backend.Mqtt;

public class MqttHostedService(
    MqttService mqtt,
    MessageRouter router,
    HomeStateStore store,
    ChangeFilter filter,
    LightAutomation automation,
    TemperatureFanAutomation fanAutomation,
    IServiceScopeFactory scopeFactory,
    ILogger<MqttHostedService> logger)
    : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        mqtt.OnMessageReceived += HandleMessage;
        await mqtt.StartAsync();
        logger.LogInformation("MQTT Hosted Service started — subscribed to home/#");
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        mqtt.OnMessageReceived -= HandleMessage;
        logger.LogInformation("MQTT Hosted Service stopped");
        return Task.CompletedTask;
    }

    private async void HandleMessage(string topic, string payload)
    {
        try
        {
            var evt = router.Parse(topic, payload);
            if (evt == null) return;

            // Always update in-memory state (for real-time SignalR)
            store.Update(evt.HomeId, evt);

            // Run automation rules
            var roomState = store.GetRoomState(evt.HomeId, evt.Room);
            if (roomState != null)
            {
                switch (evt.Type)
                {
                    case SensorType.LightLevel:
                    case SensorType.Motion:
                        await automation.HandleLightAsync(evt, roomState);
                        break;
                    case SensorType.Temperature:
                        await fanAutomation.HandleTemperatureAsync(evt, roomState);
                        break;
                }
            }

            // Only persist to DB if the change is significant
            if (filter.IsSignificant(evt))
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<SmartHouseDbContext>();

                db.SensorLogs.Add(new SensorLog
                {
                    HomeId = evt.HomeId,
                    Room = evt.Room,
                    SensorType = evt.Type,
                    Payload = payload,
                    Timestamp = DateTime.UtcNow
                });

                await db.SaveChangesAsync();
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error handling MQTT message on topic {Topic}", topic);
        }
    }
}
