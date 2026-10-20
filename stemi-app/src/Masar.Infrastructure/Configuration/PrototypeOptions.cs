namespace Masar.Infrastructure.Configuration;

/// <summary>PROTOTYPE ONLY settings (configuration section "Prototype").</summary>
public sealed class PrototypeOptions
{
    public const string Section = "Prototype";

    public CrewTestUserOptions CrewTestUser { get; set; } = new();
}

/// <summary>
/// The single fictional crew test account (PROTOTYPE ONLY — not an identity solution; production uses the organisation's
/// identity provider, see docs/security.md). The password is never in source code: set Prototype:CrewTestUser:Password
/// (environment variable Prototype__CrewTestUser__Password, or dotnet user-secrets in development). When it is not set,
/// a random password is generated once and kept in the data folder (crew-test-password.txt).
/// </summary>
public sealed class CrewTestUserOptions
{
    public string Email { get; set; } = "crew@test.local";
    public string? Password { get; set; }
}
