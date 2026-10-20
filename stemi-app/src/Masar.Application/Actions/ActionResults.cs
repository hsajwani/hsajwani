using System.Text.Json.Serialization;

namespace Masar.Application.Actions;

/// <summary>
/// The result of one action of a batch (POST /api/ops). Ok with Rcv (the server's receive time); Dup when the action
/// had already been stored (a resend after a reconnection changes nothing); otherwise Error and the HTTP-like Status
/// (400 unreadable / invalid, 403 not this screen's action, 404 no such case, 409 refused by the pathway rules).
/// </summary>
public sealed record OpResult(
    [property: JsonPropertyName("id")] object? Id,
    [property: JsonPropertyName("ok")] bool Ok)
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool Dup { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public long? Rcv { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Error { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? Status { get; init; }
}
