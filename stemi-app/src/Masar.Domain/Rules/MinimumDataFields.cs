namespace Masar.Domain.Rules;

/// <summary>
/// The crew's minimum data. Age, sex, presenting complaint and symptom onset are the crew's own (table
/// <c>patient_details</c>). BP, HR, SpO₂ and RR normally come from the corpuls monitor; the crew enters them only as a
/// manual fallback (table <c>observations</c>). GCS is kept so that cases of 0.5.0 and earlier still display.
/// </summary>
public static class MinimumDataFields
{
    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        ["age"] = "Age",
        ["sex"] = "Sex",
        ["complaint"] = "Presenting complaint",
        ["onset"] = "Symptom onset",
        ["bp"] = "BP",
        ["hr"] = "HR",
        ["spo2"] = "SpO₂",
        ["rr"] = "RR",
        ["gcs"] = "GCS",
    };

    /// <summary>The fields stored in patient_details; every other field is an observation.</summary>
    public static readonly IReadOnlySet<string> PatientFields = new HashSet<string> { "age", "sex", "complaint", "onset" };

    /// <summary>Vital signs: entered by the crew only when corpuls could not deliver them (entry kind "fallback").</summary>
    public static readonly IReadOnlySet<string> VitalSigns = new HashSet<string> { "bp", "hr", "spo2", "rr" };

    public static bool IsPatientField(string field) => PatientFields.Contains(field);
}
