using System.Text.Json.Serialization;
using Masar.Application.Cases;
using Masar.Application.Monitoring;

namespace Masar.Api.Contracts;

// Request and response bodies of the HTTP API. The browser code depends on these exact (camelCase) names: every field is
// documented in docs/api.md. Optional fields are left out of the JSON when they do not apply.

/// <summary>POST /api/login.</summary>
public sealed record LoginRequest(string? Email, string? Password);

public sealed record LoginResponse(string Role, string Name);

/// <summary>A request naming one case by its CAD number (complete, open, discard, link, demo-acquire, demo-case).</summary>
public sealed record CadRequest(string? Cad);

/// <summary>POST /api/control/screens: take a case off the live screens (On false) or return it (On true).</summary>
public sealed record ScreensRequest(string? Cad, bool? On);

/// <summary>POST /api/control/sim: the test console's simulation choices (TEST ONLY). Unknown values are ignored.</summary>
public sealed record SimulationRequest(string? Find, string? Q, string? Ai);

/// <summary>The crew user as the screens know it (GET /api/me, window.APP.user).</summary>
public sealed record CrewUserDto(string Id, string Email, string Role, string Name, string Title, string? Org, string? Unit, string? Emirate)
{
    /// <summary>Always null for the crew login (kept for the screens of 0.5/0.6, which read it).</summary>
    public string? Device => null;
}

/// <summary>
/// The answer to a case command: Ok on success, otherwise Code (the outcome) and Error; plus the outcome fields of
/// <see cref="CaseCommandResult"/> and, where useful, the case record.
/// </summary>
public sealed record CaseCommandResponse(string Status, string? Cad)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Ok { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Code { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Detail { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public CasePublicInfo? Existing { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? State { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Kind { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool Already { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public CaseRecord? Rec { get; init; }

    public static CaseCommandResponse From(CaseCommandResult r) =>
        new(r.Status, r.Cad) { Error = r.Error, Detail = r.Detail, Existing = r.Existing, State = r.State, Kind = r.Kind, Rec = r.Rec };
}

/// <summary>POST /api/corpuls/demo-acquire (PROTOTYPE ONLY: demo mode).</summary>
public sealed record DemoAcquireResponse(bool Ok, string Code, string Status, string? Cad)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? N { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? Held { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
}

/// <summary>The answer of the test console's corpuls simulator (TEST ONLY): the outcome and the simulators' new state.</summary>
public sealed record SimulatorActionResponse(bool Ok, SimulatorInfo Sim)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Note { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool Dup { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? N { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool Closed { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool Held { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Monitors { get; init; }

    public static SimulatorActionResponse From(CorpulsVerdict v, SimulatorInfo sim) =>
        new(v.Ok, sim) { Error = v.Error, Note = v.Note, Dup = v.Dup, N = v.N, Closed = v.Closed, Held = v.Held };
}

/// <summary>GET /health: is the server alive? No login, and nothing about cases, users, settings or secrets.</summary>
public sealed record HealthResponse(string Status, string App, string Environment, string Version, int Port, int Pid, string StartedAt, long UptimeSeconds);
