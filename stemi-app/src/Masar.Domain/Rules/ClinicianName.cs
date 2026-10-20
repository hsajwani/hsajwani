using System.Text.RegularExpressions;

namespace Masar.Domain.Rules;

/// <summary>
/// The name an ER Doctor or Cardiologist types when accepting / acknowledging a case.
/// PROTOTYPE ONLY: a typed name is NOT authentication and gives no identity assurance. Production must take the name
/// from the organisation's identity provider (SSO such as Microsoft Entra ID, staff ID, badge or PIN).
/// Same rules as public/shared/rules.js (cleanName): trimmed, inner spaces collapsed, no control characters,
/// 2 to 80 characters, at least one letter.
/// </summary>
public static partial class ClinicianName
{
    public const int MinLength = 2;
    public const int MaxLength = 80;

    [GeneratedRegex(@"[\u0000-\u001f\u007f]")]
    private static partial Regex ControlCharacters();
    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
    [GeneratedRegex(@"\p{L}")]
    private static partial Regex Letter();

    public static NameCheckResult Clean(string? input)
    {
        var s = Whitespace().Replace(ControlCharacters().Replace(input ?? string.Empty, " "), " ").Trim();
        if (s.Length == 0) return new(false, string.Empty, "Enter your name.");
        if (s.Length < MinLength) return new(false, s, $"Enter your full name (at least {MinLength} characters).");
        if (s.Length > MaxLength) return new(false, s, $"The name is too long (at most {MaxLength} characters).");
        if (!Letter().IsMatch(s)) return new(false, s, "Enter a name that contains letters.");
        return new(true, s, null);
    }
}

public sealed record NameCheckResult(bool Ok, string Name, string? Error);
