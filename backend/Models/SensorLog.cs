namespace backend.Core.Models;

public class SensorLog
{
    public int Id { get; set; }
    public required string HomeId { get; set; }
    public required string Room { get; set; }
    public required SensorType SensorType { get; set; }
    public required string Payload { get; set; }     // raw JSON payload
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}
