namespace backend.Core.Models;

public class Home
{
    public int Id { get; set; }
    public required string HomeId { get; set; } // matches MQTT topic home/{homeId}
    public required string Name { get; set; }
    public int OwnerId { get; set; }
    public User Owner { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
