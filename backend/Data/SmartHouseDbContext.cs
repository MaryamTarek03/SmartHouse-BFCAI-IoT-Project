using backend.Core.Models;
using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public class SmartHouseDbContext(DbContextOptions<SmartHouseDbContext> options) : DbContext(options)
{
    public DbSet<SensorLog> SensorLogs => Set<SensorLog>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Home> Homes => Set<Home>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SensorLog>(e =>
        {
            e.HasKey(s => s.Id);
            e.HasIndex(s => new { s.HomeId, s.Room, s.SensorType });
            e.HasIndex(s => s.Timestamp);
        });

        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.Email).IsUnique();
        });

        modelBuilder.Entity<Home>(e =>
        {
            e.HasKey(h => h.Id);
            e.HasIndex(h => h.HomeId).IsUnique();
            e.HasIndex(h => h.OwnerId);
            e.HasOne(h => h.Owner)
             .WithMany(u => u.Homes)
             .HasForeignKey(h => h.OwnerId);
        });
    }
}
