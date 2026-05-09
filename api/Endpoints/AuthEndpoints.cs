using System.Security.Claims;
using backend.Core.Models;
using backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace api.Endpoints;

public static class AuthEndpoints
{
    public static WebApplication MapAuthEndpoints(this WebApplication app)
    {
        var authGroup = app.MapGroup("/api/auth");
        
        authGroup.MapPost("/register", async (
            [FromBody] AuthRequest req,
            AuthService auth) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                return Results.BadRequest(new { error = "Email and password are required" });

            if (req.Password.Length < 4)
                return Results.BadRequest(new { error = "Password must be at least 4 characters" });

            var user = await auth.RegisterAsync(req.Email, req.Password);
            if (user == null)
                return Results.Conflict(new { error = "Email already registered" });

            var token = auth.GenerateJwt(user);
            return Results.Ok(new AuthResponse(token, user.Email));
        });

        authGroup.MapPost("/login", async (
            [FromBody] AuthRequest req,
            AuthService auth) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                return Results.BadRequest(new { error = "Email and password are required" });

            var user = await auth.LoginAsync(req.Email, req.Password);
            if (user == null)
                return Results.Unauthorized();

            var token = auth.GenerateJwt(user);
            return Results.Ok(new AuthResponse(token, user.Email));
        });

        return app;
    }

    public static int GetUserId(ClaimsPrincipal user)
    {
        var sub = user.FindFirstValue("sub") 
               ?? user.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
               ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
               
        return int.Parse(sub!);
    }
}

// DTOs
public record AuthRequest(string Email, string Password);
public record AuthResponse(string Token, string Email);
