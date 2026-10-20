using System.Security.Cryptography;
using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Domain.Entities;
using Masar.Domain.Pathway;
using Masar.Infrastructure.Configuration;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Masar.Infrastructure.Identity;

/// <summary>
/// Creates the single fictional crew test account and keeps its password in step with the configuration.
/// PROTOTYPE ONLY — this is not an identity solution. The ER Doctor and the Cardiologist have no account in this build
/// (they type their name: Free-text ER Doctor / Cardiologist Name — PROTOTYPE ONLY). Production identity must come from
/// the organisation's approved identity provider (e.g. Microsoft Entra ID) — see docs/security.md.
/// Security: no password is in the source code. It comes from configuration (Prototype:CrewTestUser:Password), or is
/// generated at random and kept in the data folder (never logged). Passwords are stored as ASP.NET Core Identity
/// PBKDF2 hashes.
/// </summary>
public sealed class CrewTestUserSeeder(PlatformGate gate, PrototypeOptions options, string dataDirectory, ILogger<CrewTestUserSeeder> log)
{
    public const string GeneratedPasswordFile = "crew-test-password.txt";

    // every name and unit here is fictional
    private static readonly User Template = new()
    {
        Id = "u-crew-1", Role = ActorRoles.Crew, Name = "K. Ahmed", Title = "Paramedic", Unit = "Ambulance 214", Emirate = "Ras Al Khaimah",
    };

    private static readonly PasswordHasher<User> Hasher = new();

    public static bool Verify(User user, string password)
    {
        if (string.IsNullOrEmpty(user.PasswordHash) || string.IsNullOrEmpty(password)) return false;
        try
        {
            return Hasher.VerifyHashedPassword(user, user.PasswordHash, password) != PasswordVerificationResult.Failed;
        }
        catch (FormatException)
        {
            // a hash in another format (the Node.js prototype's scrypt) cannot be verified: the password is set again at start
            return false;
        }
    }

    /// <summary>Where the password comes from: "configuration" or the generated file (its path).</summary>
    public string Seed()
    {
        var (password, source) = Password();
        gate.Run(db =>
        {
            var email = options.CrewTestUser.Email.Trim().ToLowerInvariant();
            // the account is the fixed test account (u-crew-1): a changed e-mail in the configuration is applied to it
            var user = db.Users.FirstOrDefault(u => u.Id == Template.Id) ?? db.Users.FirstOrDefault(u => u.Email == email);
            if (user is not null && user.Email != email)
            {
                db.Users.Where(u => u.Id == user.Id).ExecuteUpdate(s => s.SetProperty(u => u.Email, email));
                log.LogInformation("Crew test user {UserId}: e-mail changed to {Email} (configuration)", user.Id, email);
            }
            if (user is null)
            {
                var created = new User
                {
                    Id = Template.Id, Email = email, Role = Template.Role, Name = Template.Name, Title = Template.Title, Unit = Template.Unit, Emirate = Template.Emirate,
                };
                created.PasswordHash = Hasher.HashPassword(created, password);
                db.Insert(created);
                log.LogInformation("Crew test user {Email} created (PROTOTYPE ONLY)", email);
            }
            else if (!Verify(user, password))
            {
                var hash = Hasher.HashPassword(user, password);
                db.Users.Where(u => u.Id == user.Id).ExecuteUpdate(s => s.SetProperty(u => u.PasswordHash, hash));
                log.LogInformation("Crew test user {Email}: password set from {PasswordSource}", email, source);
            }
        });
        return source;
    }

    private (string Password, string Source) Password()
    {
        if (!string.IsNullOrEmpty(options.CrewTestUser.Password)) return (options.CrewTestUser.Password, "configuration (Prototype:CrewTestUser:Password)");
        var file = Path.Combine(dataDirectory, GeneratedPasswordFile);
        if (!File.Exists(file))
        {
            var generated = Convert.ToBase64String(RandomNumberGenerator.GetBytes(12)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
            File.WriteAllText(file, generated + Environment.NewLine);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        return (File.ReadAllText(file).Trim(), Path.GetFullPath(file));
    }
}
