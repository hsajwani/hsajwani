using Masar.Application.Abstractions;
using Masar.Domain.Entities;
using Masar.Domain.Rules;
using Microsoft.EntityFrameworkCore;

namespace Masar.Application.Cases;

/// <summary>Reads the crew's minimum data. Entries are never overwritten, so "the current value" is the latest entry.</summary>
public static class MinimumDataReader
{
    /// <summary>The latest entry of a field (rowid keeps the insertion order of entries received in the same millisecond).</summary>
    public static MinimumDataEntry? Latest(IMasarDbContext db, string cad, string field) =>
        MinimumDataFields.IsPatientField(field)
            ? db.PatientDetails.FromSql($"SELECT * FROM patient_details WHERE cad = {cad} AND field = {field} ORDER BY received_at DESC, rowid DESC LIMIT 1").AsEnumerable().FirstOrDefault()
            : db.Observations.FromSql($"SELECT * FROM observations WHERE cad = {cad} AND field = {field} ORDER BY received_at DESC, rowid DESC LIMIT 1").AsEnumerable().FirstOrDefault();

    /// <summary>Every entry of the case, oldest first: patient details, then observations.</summary>
    public static IEnumerable<MinimumDataEntry> All(IMasarDbContext db, string cad) =>
        db.PatientDetails.FromSql($"SELECT * FROM patient_details WHERE cad = {cad} ORDER BY received_at, rowid").AsEnumerable().Cast<MinimumDataEntry>()
            .Concat(db.Observations.FromSql($"SELECT * FROM observations WHERE cad = {cad} ORDER BY received_at, rowid").AsEnumerable());
}
