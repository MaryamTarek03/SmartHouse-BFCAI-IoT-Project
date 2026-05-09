using backend.Core.Models;

namespace backend.Models;

public class SensorEvent
{
    public required string HomeId { get; set; }
    public required string Room { get; set; }
    public required SensorType Type { get; set; }
    public double? Value { get; set; }
    public bool? Detected { get; set; }
    public string? State { get; set; } // for light/door: "ON"/"OFF"/"OPEN"/"CLOSED"

    public DeviceState ToDeviceState()
        => this.State == "ON"  ? DeviceState.On : DeviceState.Off;
}