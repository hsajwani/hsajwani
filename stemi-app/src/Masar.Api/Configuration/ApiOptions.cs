namespace Masar.Api.Configuration;

/// <summary>Where the screens (HTML, CSS, JavaScript) are served from (configuration section "Frontend").</summary>
public sealed class FrontendOptions
{
    public const string Section = "Frontend";

    /// <summary>
    /// The folder holding the screens (the repository's public/ folder). Relative to the content root. A published build
    /// carries them in wwwroot (the default); in development appsettings.Development.json points at ../../public.
    /// </summary>
    public string RootPath { get; set; } = "wwwroot";
}

/// <summary>Prototype session lifetimes (configuration section "Sessions"). PROTOTYPE ONLY: see docs/security.md.</summary>
public sealed class PrototypeSessionOptions
{
    public const string Section = "Sessions";

    /// <summary>How long the crew test login lasts.</summary>
    public int CrewSessionHours { get; set; } = 24;

    /// <summary>How long an ER Doctor / Cardiologist / test console device session lasts.</summary>
    public int DeviceSessionDays { get; set; } = 30;

    /// <summary>
    /// true: the session cookies are always marked Secure (sent over HTTPS only). Set it in production, where HTTPS is
    /// required — also behind a reverse proxy that ends TLS, which this application cannot otherwise detect. false (the
    /// prototype on plain HTTP in the local network): Secure only when the request itself is HTTPS.
    /// </summary>
    public bool RequireSecureCookies { get; set; }
}

/// <summary>The live link to the screens (configuration section "Live").</summary>
public sealed class LiveOptions
{
    public const string Section = "Live";

    /// <summary>The heartbeat interval: a screen shows CONNECTION LOST when heartbeats stop arriving.</summary>
    public int HeartbeatMs { get; set; } = 5000;

    /// <summary>A screen that reloads reconnects within a second or two; only a longer gap counts as offline (test console presence).</summary>
    public int OfflineAfterMs { get; set; } = 8000;
}
