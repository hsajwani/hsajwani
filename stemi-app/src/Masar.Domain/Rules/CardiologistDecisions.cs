namespace Masar.Domain.Rules;

/// <summary>The Cardiologist's decisions (decisions.kind) and how they are worded on every screen and in the audit.</summary>
public static class CardiologistDecisions
{
    public const string Confirm = "confirm";
    public const string NotStemi = "not";
    public const string Repeat = "repeat";

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        [Confirm] = "CONFIRMED STEMI",
        [NotStemi] = "NOT STEMI",
        [Repeat] = "UNCLEAR — REPEAT ECG REQUESTED",
    };

    /// <summary>The Cardiologist's optional feedback on the AI report.</summary>
    public static readonly IReadOnlySet<string> AiFeedback = new HashSet<string> { "Agree", "Disagree", "Did not use" };
}
