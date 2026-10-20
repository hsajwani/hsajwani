using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Domain.Pathway;
using Masar.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Masar.Application.Cases;

/// <summary>Read-only views of cases: completed cases by CAD number, one case opened read-only, the test console's list.</summary>
public sealed partial class CaseQueryService(CaseRecordBuilder records)
{
    public CaseSummary Summary(IMasarDbContext db, CaseFacts f)
    {
        var c = f.Case;
        string? Current(string field) => MinimumDataReader.Latest(db, c.Cad, field)?.ValueText;
        var ecg1 = db.Ecgs.FirstOrDefault(e => e.Cad == c.Cad && e.N == 1);
        return new CaseSummary(
            c.Cad, c.Unit, f.State, f.Legacy, c.Active, c.CreatedAt, c.ClosedAt, c.ClosedBy.OrNull(),
            c.ClosedAt is not null ? PathwayClosure.KindOf(c.ClosureReason) : null,
            new CaseSummaryPatient(Current("age"), Current("sex"), Current("complaint")),
            ecg1?.AcquiredAt,
            new CaseSummaryEr(c.ErDoctorName.OrNull(), c.ErAssessment.OrNull(), c.ErNonActivationReason.OrNull()),
            new CaseSummaryCardio(f.Activated, c.CardiologistName.OrNull() ?? (f.Legacy ? f.Alert?.AcknowledgedBy.OrNull() : null), f.LastDecision?.Kind));
    }

    /// <summary>
    /// Completed cases found by CAD number (part of it is enough), newest first, at most 50. A Cardiologist finds a case
    /// closed by the ER Doctor only by typing at least 4 characters of its CAD number.
    /// </summary>
    public List<CaseSummary> ListClosed(IMasarDbContext db, Actor actor, string? query)
    {
        var n = NotCadCharacters().Replace(CadNumber.Normalize(query), string.Empty);
        var output = new List<CaseSummary>();
        var cads = db.Cases.Where(c => c.ClosedAt != null && EF.Functions.Like(c.Cad, $"%{n}%")).OrderByDescending(c => c.ClosedAt).Take(200).Select(c => c.Cad).ToList();
        foreach (var cad in cads)
        {
            var f = CaseFactsLoader.Load(db, cad);
            if (f is not null && CaseVisibility.CanView(actor.Role, actor.Unit, f, n.Length >= 4)) output.Add(Summary(db, f));
            if (output.Count >= 50) break;
        }
        return output;
    }

    /// <summary>One case by CAD number, read-only, for a screen allowed to open it (null otherwise).</summary>
    public CaseRecord? View(IMasarDbContext db, Actor actor, string? raw)
    {
        var f = CaseFactsLoader.Load(db, CadNumber.Normalize(raw));
        return f is not null && CaseVisibility.CanView(actor.Role, actor.Unit, f, searching: true) ? records.Build(db, f.Case.Cad, f) : null;
    }

    /// <summary>Every case for the test console, newest first (at most 100).</summary>
    public List<CaseSummary> ConsoleCases(IMasarDbContext db) =>
        db.Cases.OrderByDescending(c => c.CreatedAt).Take(100).Select(c => c.Cad).ToList()
            .Select(cad => Summary(db, CaseFactsLoader.Load(db, cad)!)).ToList();

    [System.Text.RegularExpressions.GeneratedRegex("[^0-9A-Z-]")]
    private static partial System.Text.RegularExpressions.Regex NotCadCharacters();
}
