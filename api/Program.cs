using System.Text;
using api.Endpoints;
using api.Hubs;
using backend.Data;
using backend.Mqtt;
using backend.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<SmartHouseDbContext>(options =>
    options.UseSqlite("Data Source=smarthouse.db"));

builder.Services.AddSingleton<HomeStateStore>();
builder.Services.AddSingleton<ChangeFilter>();
builder.Services.AddSingleton<OverrideTracker>();
builder.Services.AddSingleton<LightAutomation>();
builder.Services.AddSingleton<TemperatureFanAutomation>();
builder.Services.AddSingleton<MqttService>();
builder.Services.AddSingleton<MessageRouter>();
builder.Services.AddScoped<AuthService>();

builder.Services.AddHostedService<MqttHostedService>();
builder.Services.AddSignalR();

// JWT Authentication
var jwtKey = builder.Configuration["Jwt:Key"]!;
var jwtIssuer = builder.Configuration["Jwt:Issuer"]!;

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtIssuer,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };

        // Allow SignalR to receive the JWT via query string
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;

                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hub"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SmartHouseDbContext>();
    db.Database.EnsureCreated();
}

app.UseCors();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

var hubContext = app.Services.GetRequiredService<IHubContext<HomeHub>>();
var store = app.Services.GetRequiredService<HomeStateStore>();

store.OnStateChanged += (homeId, roomState) =>
{
    _ = hubContext.Clients.Group($"home-{homeId}")
        .SendAsync("SensorUpdated", homeId, roomState);
};

store.OnSystemLog += (homeId, message) =>
{
    _ = hubContext.Clients.Group($"home-{homeId}")
        .SendAsync("SystemLog", message);
};

app.MapAuthEndpoints();
app.MapHomeEndpoints();
app.MapHub<HomeHub>("/hub/home");
app.MapFallbackToFile("index.html");

app.Run();
