namespace Masar.Domain.Rules;

/// <summary>
/// The crew's minimum data at SEND: age, sex, presenting complaint and symptom onset each need an answer, and Unknown is
/// an answer. The server applies the same rule as the crew screen (public/crew/crew.js, mdErrors), so a case can never
/// reach the ER without them, whatever sent it. These are completeness and plausibility checks only — not clinical
/// criteria: the age range and the onset check only reject impossible input.
/// </summary>
public static class MinimumDataRules
{
    public const int MaxAgeYears = 120;
    /// <summary>The tablet's clock may run a little ahead: an onset up to 5 minutes "in the future" is accepted.</summary>
    public const long OnsetFutureToleranceMs = 5 * 60_000;

    /// <summary>
    /// One answer as the crew tablet sends it. Unknown: the crew chose Unknown. Number: the age in years. Key / Other:
    /// the complaint chosen and the description of "other". Time: the onset time (Unix epoch milliseconds).
    /// </summary>
    public sealed record Answer(bool Unknown, double? Number, string? Key, string? Other, double? Time);

    /// <summary>Null when the four items are complete, otherwise the message the crew screen shows for the first missing one.</summary>
    public static string? CheckForSend(Answer? age, Answer? sex, Answer? complaint, Answer? onset, long now)
    {
        if (age is null) return "Enter the age (or an estimate), or choose Unknown.";
        if (!age.Unknown && !(age.Number is { } years && years == Math.Floor(years) && years is >= 0 and <= MaxAgeYears))
            return $"Age: a whole number from 0 to {MaxAgeYears} years.";
        if (sex is null) return "Choose the sex, or Unknown.";
        if (complaint is null) return "Choose the presenting complaint (or the reason for the ECG).";
        if (complaint.Key == "oth" && string.IsNullOrWhiteSpace(complaint.Other)) return "Describe the presenting complaint.";
        if (onset is null) return "Enter the symptom onset time, or choose Unknown.";
        if (!onset.Unknown && !(onset.Time is { } t && t <= now + OnsetFutureToleranceMs)) return "The onset time cannot be in the future.";
        return null;
    }
}
