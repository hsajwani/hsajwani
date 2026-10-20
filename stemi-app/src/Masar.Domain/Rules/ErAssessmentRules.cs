namespace Masar.Domain.Rules;

/// <summary>
/// The ER Doctor's screening assessment. NOT SUSPICIOUS FOR STEMI closes the screening pathway without activating
/// cardiology, so a reason is mandatory (and OTHER needs an explanation): the closure must be explainable afterwards.
/// The reason list is the one specified for this build and still needs clinical-governance approval (open decision ER-2).
/// </summary>
public static class ErAssessmentRules
{
    public sealed record Reason(string Key, string Label);

    public static readonly IReadOnlyList<Reason> NotSuspiciousReasons =
    [
        new("criteria", "ECG DOES NOT MEET STEMI CRITERIA"),
        new("alternative", "ALTERNATIVE DIAGNOSIS SUSPECTED"),
        new("not-acute", "ECG CHANGES NOT CONSISTENT WITH ACUTE STEMI"),
        new("clinical", "CLINICAL PRESENTATION NOT CONSISTENT WITH STEMI"),
        new("quality", "POOR ECG QUALITY — NOT DIAGNOSTIC"),
        new("other", "OTHER"),
    ];

    /// <summary>The assessments and how they are worded in the audit trail.</summary>
    public static readonly IReadOnlyDictionary<string, string> AssessmentLabels = new Dictionary<string, string>
    {
        ["activate"] = "ACTIVATE CARDIOLOGIST",
        ["uncertain"] = "UNCERTAIN — ACTIVATE CARDIOLOGIST",
        ["not_suspicious"] = "NOT SUSPICIOUS FOR STEMI",
    };

    public static NotSuspiciousCheck CheckNotSuspicious(string? reasonKey, string? comment)
    {
        var r = NotSuspiciousReasons.FirstOrDefault(x => x.Key == reasonKey);
        if (r is null) return new(false, null, null, "reason", "Select the reason why cardiology is not activated.");
        var c = TextRules.Clean(comment);
        if (r.Key == "other" && c.Length == 0) return new(false, null, null, "comment", "OTHER needs an explanation: describe the reason.");
        return new(true, r.Label, c, null, null);
    }
}

public sealed record NotSuspiciousCheck(bool Ok, string? ReasonLabel, string? Comment, string? Field, string? Error);
