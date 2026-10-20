using System.Text.Json;
using System.Text.Json.Nodes;
using Masar.Application.Abstractions;

namespace Masar.Application.Simulation;

/// <summary>
/// TEST ONLY: the test console's simulation choices (settings key "sim"): the fictional test ECG pattern of the manual
/// fallback (find: border | clear), the quality of the next fictional test photo (q: good | glare | cut) and the mock AI
/// behaviour (ai: ok | down | proc). Also the screens' data epoch (it changes when the test data is reset).
/// </summary>
public sealed class SimulationSettings(ISettingsStore store)
{
    public sealed record Values(string Find, string Q, string Ai, bool Ids);

    private static readonly Values Default = new("border", "good", "ok", false);

    public Values Current()
    {
        var raw = store.Get("sim");
        if (string.IsNullOrEmpty(raw)) return Default;
        try
        {
            var o = JsonNode.Parse(raw) as JsonObject;
            return new Values(
                o?["find"]?.GetValue<string>() ?? Default.Find,
                o?["q"]?.GetValue<string>() ?? Default.Q,
                o?["ai"]?.GetValue<string>() ?? Default.Ai,
                o?["ids"]?.GetValue<bool>() ?? Default.Ids);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or FormatException)
        {
            return Default;
        }
    }

    public Values Update(string? find, string? q, string? ai)
    {
        var c = Current();
        var v = new Values(find ?? c.Find, q ?? c.Q, ai ?? c.Ai, c.Ids);
        store.Set("sim", JsonSerializer.Serialize(new { find = v.Find, q = v.Q, ai = v.Ai, ids = v.Ids }));
        return v;
    }

    /// <summary>The JSON object the screens receive ({ find, q, ai, ids }).</summary>
    public static object ToDto(Values v) => new { find = v.Find, q = v.Q, ai = v.Ai, ids = v.Ids };

    /// <summary>Changes when the test data is reset, so open screens drop what they held and start afresh.</summary>
    public string Epoch() => store.Get("epoch") ?? BumpEpoch();

    public string BumpEpoch()
    {
        var v = ToBase36(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        store.Set("epoch", v);
        return v;
    }

    private static string ToBase36(long n)
    {
        const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
        var s = string.Empty;
        do { s = digits[(int)(n % 36)] + s; n /= 36; } while (n > 0);
        return s;
    }
}
