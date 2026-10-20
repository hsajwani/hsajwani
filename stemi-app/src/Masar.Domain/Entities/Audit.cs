namespace Masar.Domain.Entities;

/// <summary>
/// The audit trail: every significant event with time, CAD number, person (the name they entered, PROTOTYPE ONLY),
/// role and action. Audit rows are only ever inserted, never deleted (except by the TEST ONLY "delete all test data" of
/// the test console) and never reworded. One exception changes a column: when the crew corrects the CAD number of a case
/// that was never sent, every row of that case — its audit rows included — moves to the corrected number, and the
/// correction itself is audited (CaseService.Correct).
/// role: crew | er | cardiologist (a person) · system (the platform, the AI service, the corpuls feed) · test-console.
/// kind: key (pathway events) | evt (technical events) | view (viewing).
/// </summary>
public class AuditEvent
{
    public long Id { get; set; }
    public string Cad { get; set; } = string.Empty;
    public long At { get; set; }
    public string? Actor { get; set; }
    public string? UserId { get; set; }
    public string? Role { get; set; }
    public string Action { get; set; } = string.Empty;
    public string Kind { get; set; } = "evt";
    /// <summary>The prototype device session that sent the action.</summary>
    public string? Device { get; set; }
}

/// <summary>What the screens list as NEW (silent updates after SEND).</summary>
public class CaseUpdate
{
    public string Id { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public string? RefJson { get; set; }
    public long At { get; set; }
    public long? SeenAt { get; set; }
}

/// <summary>Every action a screen sent, stored once: the id makes a resend after a reconnection harmless (idempotency).</summary>
public class Op
{
    public string OpId { get; set; } = string.Empty;
    public string Cad { get; set; } = string.Empty;
    public string? UserId { get; set; }
    public string? Role { get; set; }
    public string Kind { get; set; } = string.Empty;
    public long? DeviceTime { get; set; }
    public long ReceivedAt { get; set; }
    public string? PayloadJson { get; set; }
}

/// <summary>Key–value settings: the test console's simulation choices, the screens' data epoch, the simulated monitors.</summary>
public class Setting
{
    public string Key { get; set; } = string.Empty;
    public string? Value { get; set; }
}

/// <summary>
/// A login account. PROTOTYPE ONLY: the single crew test user. The ER Doctor and Cardiologist have no account in this
/// build (they type their name). Production identity must come from the organisation's identity provider.
/// </summary>
public class User
{
    public string Id { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Org { get; set; }
    public string? Unit { get; set; }
    public string? Emirate { get; set; }
}
