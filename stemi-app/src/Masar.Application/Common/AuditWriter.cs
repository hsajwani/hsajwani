using Masar.Application.Abstractions;
using Masar.Domain.Entities;
using Masar.Domain.Pathway;

namespace Masar.Application.Common;

/// <summary>
/// Collects the audit entries of one change and writes them in order (<see cref="Flush"/>). Every significant event of
/// the pathway is audited with time, CAD number, person, role and action; routine monitor samples and heartbeats never
/// are (they would bury the clinical events). Also writes the screens' "NEW" update list (<see cref="Update"/>).
/// </summary>
public sealed class AuditWriter(IMasarDbContext db, string cad, Actor actor)
{
    public sealed class Entry(long at, string text, string who, string role, string kind, string? userId)
    {
        public long At { get; } = at;
        public string Text { get; set; } = text;
        public string Who { get; } = who;
        public string Role { get; } = role;
        public string Kind { get; } = kind;
        public string? UserId { get; } = userId;
    }

    private readonly List<Entry> _entries = [];

    /// <summary>A person acting from this screen: the crew user, or the ER Doctor / Cardiologist under the name they entered.</summary>
    public void By(long at, string text, string? who, string kind = "evt") =>
        _entries.Add(new Entry(at, text, who ?? string.Empty, actor.Role == ActorRoles.Control ? ActorRoles.TestConsoleAudit : actor.Role, kind, actor.Id));

    /// <summary>The platform itself, the AI service or the corpuls feed.</summary>
    public void Sys(long at, string text, string kind = "evt", string? who = null) =>
        _entries.Add(new Entry(at, text, who ?? "Platform", ActorRoles.System, kind, null));

    /// <summary>An entry of the screens' silent "NEW" updates list (written at once).</summary>
    public void Update(long at, string kind, string text, object? reference)
    {
        db.Insert(new CaseUpdate { Id = Ids.New("u"), Cad = cad, Kind = kind, Text = text, RefJson = JsonDefaults.Serialize(reference ?? new { }), At = at });
    }

    /// <summary>Writes the collected entries in the order they were made. fix: a last change to each entry (offline notes).</summary>
    public void Flush(Action<Entry>? fix = null)
    {
        foreach (var e in _entries)
        {
            fix?.Invoke(e);
            // one row at a time keeps the audit order exactly as written (ids are the tie-breaker for equal times)
            db.Insert(new AuditEvent { Cad = cad, At = e.At, Actor = e.Who, UserId = e.UserId, Role = e.Role, Action = e.Text, Kind = e.Kind, Device = actor.Device });
        }
        _entries.Clear();
    }
}
