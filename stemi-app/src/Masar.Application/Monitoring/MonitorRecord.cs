using System.Text.Json.Nodes;

namespace Masar.Application.Monitoring;

/// <summary>
/// The corpuls feed of a case as the screens read it (case record "monitor", and the live "monitor" event): the link,
/// the connection state, the latest vital signs with their times, a light history and the feed's timeline.
/// Every: how often vital signs normally arrive — it drives only the screens' technical freshness indicator, never a
/// clinical rule.
/// </summary>
public sealed record MonitorRecord(
    string Provider, bool Simulated, bool Demo, string? Device, string? Label, long? Linked, string? By, string? Status,
    long? StatusAt, long? Ended, string? EndWhy, long? Last, int Every, JsonNode? V, List<MonitorSample> Hist, List<MonitorLogEntry> Log);

public sealed record MonitorSample(long At, int? Hr, int? Spo2, int? Sys, int? Dia, long? BpAt, int? Rr, string Source, string? Why);

public sealed record MonitorLogEntry(long At, string Kind, string Text);
