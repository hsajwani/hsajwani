namespace Masar.Domain.Pathway;

/// <summary>
/// The states of a STEMI pathway case. The values are the strings the API and every screen use, so they are kept as
/// constants rather than an enum (the browser code switches on these exact strings).
/// The STEMI pathway status is NOT the ICCC / CAD incident status: closing the pathway never changes the CAD incident.
/// </summary>
public static class PathwayStates
{
    public const string Draft = "draft";
    public const string SentToEr = "sent_to_er";
    public const string ErReviewing = "er_reviewing";
    public const string ErClosed = "er_closed";
    public const string CardiologyActivated = "cardiology_activated";
    public const string CardiologistReviewing = "cardiologist_reviewing";
    public const string RepeatRequested = "repeat_requested";
    public const string RepeatReceived = "repeat_received";
    public const string Confirmed = "confirmed";
    public const string NotStemiClosed = "not_stemi_closed";
    public const string Completed = "completed";

    /// <summary>The three closed states. A closed case is read-only (enforced on the server, see PathwayStateMachine.Guard).</summary>
    public static readonly IReadOnlySet<string> Closed = new HashSet<string> { ErClosed, NotStemiClosed, Completed };

    public static bool IsClosed(string? state) => state is not null && Closed.Contains(state);
}
