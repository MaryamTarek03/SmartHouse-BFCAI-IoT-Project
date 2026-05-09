using System.Text;
using MQTTnet;

namespace backend.Mqtt;

public class MqttService
{
    private readonly IMqttClient _client;

    public event Action<string, string>? OnMessageReceived;

    public MqttService()
    {
        var factory = new MqttClientFactory();
        _client = factory.CreateMqttClient();

        _client.ApplicationMessageReceivedAsync += e =>
        {
            var topic = e.ApplicationMessage.Topic;
            var payload = Encoding.UTF8.GetString(e.ApplicationMessage.Payload);

            OnMessageReceived?.Invoke(topic, payload);
            return Task.CompletedTask;
        };
    }

    public async Task StartAsync()
    {
        var options = new MqttClientOptionsBuilder()
            .WithTcpServer("localhost", 1883)
            .Build();

        await _client.ConnectAsync(options);
        await _client.SubscribeAsync("home/#");
    }

    public async Task PublishAsync(string topic, string payload)
    {
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(payload)
            .Build();

        await _client.PublishAsync(message);
    }
}