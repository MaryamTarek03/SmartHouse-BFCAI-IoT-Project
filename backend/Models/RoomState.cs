namespace backend.Models;

public class RoomState
{
    public required string HomeId { get; set; }
    public required string Room { get; set; }
    public double? Temperature { get; set; }
    public double? LightLevel { get; set; } // lux
    public string DoorState { get; set; } = "CLOSED";
    public string LightState { get; set; } = "OFF";
    public string FanState { get; set; } = "OFF";
    public bool SmokeDetected { get; set; }
    public bool MotionDetected { get; set; }
    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;
}
