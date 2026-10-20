using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Masar.Application.Common;

/// <summary>
/// Reads the fields of an action's data object (POST /api/ops) the way the browser sends them. Values of the wrong type
/// read as missing, so each rule can refuse the action with its own message (documented in docs/api.md).
/// </summary>
public readonly struct JsonData
{
    private readonly JsonElement _e;
    public JsonData(JsonElement e) => _e = e;
    public static JsonData From(JsonElement? e) => new(e ?? default);

    public bool IsObject => _e.ValueKind == JsonValueKind.Object;
    public JsonElement Raw => _e;

    public JsonElement? Get(string name) =>
        _e.ValueKind == JsonValueKind.Object && _e.TryGetProperty(name, out var v) && v.ValueKind is not JsonValueKind.Undefined ? v : null;

    public JsonData Obj(string name) => new(Get(name) is { ValueKind: JsonValueKind.Object } v ? v : default);

    /// <summary>A string (null when missing or not a string).</summary>
    public string? Str(string name) => Get(name) is { ValueKind: JsonValueKind.String } v ? v.GetString() : null;

    /// <summary>Like JavaScript's String(x) for the values the screens send: strings, numbers and booleans.</summary>
    public string? Text(string name) => Get(name) switch
    {
        { ValueKind: JsonValueKind.String } v => v.GetString(),
        { ValueKind: JsonValueKind.Number } v => v.GetRawText(),
        { ValueKind: JsonValueKind.True } => "true",
        { ValueKind: JsonValueKind.False } => "false",
        _ => null,
    };

    /// <summary>An integer number (like Number.isInteger: 3 and 3.0 count, "3" does not).</summary>
    public int? Int(string name) => AsInt(Get(name));

    public static int? AsInt(JsonElement? v)
    {
        if (v is not { ValueKind: JsonValueKind.Number } n) return null;
        if (n.TryGetInt32(out var i)) return i;
        return n.TryGetDouble(out var d) && d == Math.Floor(d) && d is >= int.MinValue and <= int.MaxValue ? (int)d : null;
    }

    /// <summary>A number, or a string holding a number (like JavaScript's +x), for device times.</summary>
    public double? Number(string name) => AsNumber(Get(name));

    public static double? AsNumber(JsonElement? v) => v switch
    {
        { ValueKind: JsonValueKind.Number } n => n.GetDouble(),
        { ValueKind: JsonValueKind.String } s when double.TryParse(s.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
        _ => null,
    };

    /// <summary>JavaScript truthiness of the field.</summary>
    public bool Truthy(string name) => Get(name) switch
    {
        null => false,
        { ValueKind: JsonValueKind.False or JsonValueKind.Null } => false,
        { ValueKind: JsonValueKind.String } s => (s.GetString() ?? string.Empty).Length > 0,
        { ValueKind: JsonValueKind.Number } n => n.GetDouble() != 0,
        _ => true,
    };

    /// <summary>JavaScript truthiness of a value.</summary>
    public static bool IsTruthy(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Undefined or JsonValueKind.Null or JsonValueKind.False => false,
        JsonValueKind.String => (e.GetString() ?? string.Empty).Length > 0,
        JsonValueKind.Number => e.GetDouble() != 0,
        _ => true,
    };

    public IEnumerable<JsonElement> Array(string name) =>
        Get(name) is { ValueKind: JsonValueKind.Array } a ? a.EnumerateArray() : [];

    public bool IsArray(string name) => Get(name) is { ValueKind: JsonValueKind.Array };

    /// <summary>The field's JSON text (for storing it unchanged), or null.</summary>
    public string? RawText(string name) => Get(name) is { } v && v.ValueKind != JsonValueKind.Null ? v.GetRawText() : null;

    /// <summary>A number in a parsed JSON value (stored JSON columns), or null.</summary>
    public static long? NodeLong(JsonNode? node) =>
        node is JsonValue v ? (v.TryGetValue<long>(out var l) ? l : v.TryGetValue<double>(out var d) && double.IsFinite(d) ? (long)d : null) : null;

    /// <summary>A string in a parsed JSON value, or null.</summary>
    public static string? NodeString(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>
    /// A value as JavaScript's String(x) writes it, for the values the screens send in lists (ECG numbers to compare,
    /// reasons): strings as they are, numbers without a trailing ".0", true / false, null.
    /// </summary>
    public static string JsString(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString() ?? string.Empty,
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l.ToString(CultureInfo.InvariantCulture) : e.GetDouble().ToString("R", CultureInfo.InvariantCulture),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null => "null",
        _ => e.GetRawText(),
    };

    public static JsonNode? Parse(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try { return JsonNode.Parse(json); } catch (JsonException) { return null; }
    }
}
