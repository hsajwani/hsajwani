using Masar.Application.Abstractions;
using Masar.Domain.Pathway;
using Microsoft.EntityFrameworkCore;

namespace Masar.Application.Cases;

/// <summary>Reads everything the pathway rules need about one case (the facts its state is derived from).</summary>
public static class CaseFactsLoader
{
    public static CaseFacts? Load(IMasarDbContext db, string? cad)
    {
        if (string.IsNullOrEmpty(cad)) return null;
        var c = db.Cases.FirstOrDefault(x => x.Cad == cad);
        if (c is null) return null;
        var alert = db.CardiologistAlerts.FirstOrDefault(a => a.Cad == cad);
        // the latest decision; rowid breaks ties between decisions made in the same millisecond (insertion order)
        var lastDecision = db.Decisions
            .FromSql($"SELECT * FROM decisions WHERE cad = {cad} ORDER BY decided_at DESC, rowid DESC LIMIT 1")
            .AsEnumerable().FirstOrDefault();
        var ecgCount = db.Ecgs.Where(e => e.Cad == cad).Max(e => (int?)e.N) ?? 0;
        return CaseFacts.From(c, alert, lastDecision, ecgCount);
    }
}
