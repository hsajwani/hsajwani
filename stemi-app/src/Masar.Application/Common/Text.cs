namespace Masar.Application.Common;

/// <summary>Small helpers that keep the JavaScript prototype's text semantics ("" and null both mean "nothing").</summary>
public static class Text
{
    /// <summary>The value, or null when it is null or empty (JavaScript's <c>value || null</c>).</summary>
    public static string? OrNull(this string? value) => string.IsNullOrEmpty(value) ? null : value;

    /// <summary>The value, or the fallback when it is null or empty (JavaScript's <c>value || fallback</c>).</summary>
    public static string Or(this string? value, string fallback) => string.IsNullOrEmpty(value) ? fallback : value;

    public static string Plural(int n, string singular, string plural) => n == 1 ? singular : plural;
}
