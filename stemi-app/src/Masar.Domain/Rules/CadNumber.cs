using System.Text.RegularExpressions;

namespace Masar.Domain.Rules;

/// <summary>
/// The CAD number, entered manually by the crew (EMT) from the MDT / dispatch information. It is the case identifier:
/// one STEMI case per CAD number. Canonical stored format YYYYMMDD-NNNN-N (for example 20261004-0123-1), shown as
/// "CAD #20261004-0123-1". Accepted input: "CAD#20261004-0123-1", "cad # 20261004-0123-1", " 20261004-0123-1 ",
/// "2026100401231".
/// The browser has the same rules in public/shared/cad.js for immediate feedback; this server copy is the authority.
/// Keep both in step. The real CAD number format is an open governance decision (Q-51): change Pattern here and in
/// cad.js together.
/// </summary>
public static partial class CadNumber
{
    public const string Example = "20261004-0123-1";
    public const string InvalidMessage = "Enter a valid CAD number before continuing.";

    [GeneratedRegex(@"^([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{4})-([0-9]{1,3})$")]
    private static partial Regex Pattern();
    [GeneratedRegex(@"[\s﻿]+")]
    private static partial Regex Whitespace();
    [GeneratedRegex("[‐-―−]")]
    private static partial Regex Dashes();
    [GeneratedRegex("^cad#?", RegexOptions.IgnoreCase)]
    private static partial Regex CadPrefix();
    [GeneratedRegex("^[0-9]{13}$")]
    private static partial Regex ThirteenDigits();

    /// <summary>Trim, drop every space, drop a leading "CAD" / "CAD#" / "#", unify dashes, upper case.</summary>
    public static string Normalize(string? input)
    {
        var s = Whitespace().Replace(input ?? string.Empty, string.Empty);
        s = Dashes().Replace(s, "-");
        s = CadPrefix().Replace(s, string.Empty);
        if (s.StartsWith('#')) s = s[1..];
        // typed without dashes on a numeric keypad: 8 + 4 + 1 digits
        if (ThirteenDigits().IsMatch(s)) s = $"{s[..8]}-{s.Substring(8, 4)}-{s[12..]}";
        return s.ToUpperInvariant();
    }

    public static CadCheckResult Check(string? input)
    {
        var cad = Normalize(input);
        if (cad.Length == 0) return CadCheckResult.Invalid(cad, "The CAD number is empty.");
        var m = Pattern().Match(cad);
        if (!m.Success) return CadCheckResult.Invalid(cad, $"Incomplete or not a CAD number. Expected format: {Example}");
        var month = int.Parse(m.Groups[2].Value);
        var day = int.Parse(m.Groups[3].Value);
        if (month is < 1 or > 12 || day is < 1 or > 31)
            return CadCheckResult.Invalid(cad, $"The date part {m.Groups[1].Value}{m.Groups[2].Value}{m.Groups[3].Value} is not a valid date. Expected format: {Example}");
        return new CadCheckResult(true, cad, null, null);
    }

    public static string Display(string cad) => "CAD #" + cad;
}

public sealed record CadCheckResult(bool Ok, string Cad, string? Error, string? Detail)
{
    public static CadCheckResult Invalid(string cad, string detail) => new(false, cad, CadNumber.InvalidMessage, detail);
}
