using System.Text.RegularExpressions;

namespace Masar.Domain.Rules;

/// <summary>Free text from a screen: control characters removed (line breaks kept), trimmed, length-limited.</summary>
public static partial class TextRules
{
    public const int DefaultMaxLength = 500;

    [GeneratedRegex(@"[\u0000-\u0009\u000b-\u001f\u007f]")]
    private static partial Regex ControlCharactersExceptNewLine();

    public static string Clean(string? input, int maxLength = DefaultMaxLength)
    {
        var s = ControlCharactersExceptNewLine().Replace(input ?? string.Empty, string.Empty).Trim();
        return s.Length > maxLength ? s[..maxLength] : s;
    }
}
