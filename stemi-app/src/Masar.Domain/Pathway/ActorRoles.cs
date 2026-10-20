namespace Masar.Domain.Pathway;

/// <summary>Who acts on a case. Screens: crew, er, cardiologist, control (the TEST ONLY console). Audit-only: system.</summary>
public static class ActorRoles
{
    public const string Crew = "crew";
    public const string Er = "er";
    public const string Cardiologist = "cardiologist";
    public const string Control = "control";
    public const string System = "system";
    /// <summary>The role written in the audit trail for an action from the test console.</summary>
    public const string TestConsoleAudit = "test-console";

    /// <summary>The screens that sign in with a prototype device session instead of a login (PROTOTYPE ONLY).</summary>
    public static readonly IReadOnlyList<string> DeviceRoles = [Er, Cardiologist, Control];
    /// <summary>The roles whose presence (screen connected or not) the test console shows.</summary>
    public static readonly IReadOnlyList<string> PresenceRoles = [Crew, Er, Cardiologist];
    public static readonly IReadOnlyList<string> ScreenRoles = [Crew, Er, Cardiologist, Control];
}
