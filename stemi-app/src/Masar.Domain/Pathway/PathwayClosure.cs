namespace Masar.Domain.Pathway;

/// <summary>
/// The three ways a STEMI pathway closes. Reason and source are stored on the case exactly as written here
/// (cases.closure_reason / cases.closure_source); the kind is what the screens read. Existing databases contain these
/// exact strings, so they must not be reworded without a data migration.
/// </summary>
public sealed record PathwayClosure(string Reason, string Source, string Kind)
{
    /// <summary>The ER Doctor's NOT SUSPICIOUS FOR STEMI: cardiology is not activated and the screening pathway closes.</summary>
    public static readonly PathwayClosure ErNotActivated = new("ER Doctor assessment: NOT SUSPICIOUS FOR STEMI", "ER Doctor screening decision", "er-not-activated");

    /// <summary>The Cardiologist's NOT STEMI: the decision is stored first, then the pathway closes automatically.</summary>
    public static readonly PathwayClosure NotStemi = new("Cardiologist decision: NOT STEMI", "automatic following Cardiologist decision", "not-stemi");

    /// <summary>The crew's COMPLETE STEMI PATHWAY, allowed only while the current decision is CONFIRMED STEMI.</summary>
    public static readonly PathwayClosure Completed = new("STEMI pathway completed", "crew", "completed");

    /// <summary>The closure kind of a closed case, read from its stored closure reason.</summary>
    public static string KindOf(string? closureReason) =>
        closureReason == ErNotActivated.Reason ? ErNotActivated.Kind
        : closureReason == NotStemi.Reason ? NotStemi.Kind
        : Completed.Kind;
}
