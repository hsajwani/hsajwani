using System.Collections.Concurrent;
using System.Text.Json;
using Masar.Api.Configuration;
using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Domain.Pathway;
using Microsoft.Extensions.Options;

namespace Masar.Api.Live;

/// <summary>
/// The live link to every open screen (Server-Sent Events). Screens send actions as ordinary HTTP requests; after each
/// change the changed case is pushed to every screen allowed to see it (crew: its own unit's cases · ER: cases sent to the
/// ER · Cardiologist: cases where cardiology was activated · test console: all). The decisions about who may see a case
/// are made by Masar.Application (CaseVisibility); this class only keeps the connections and delivers. The pushes are
/// made at the end of each change (see LiveUpdates.Flush and PlatformGate), before the HTTP answer of that change.
/// A heartbeat every few seconds (HeartbeatService) lets a screen prove it is current: when it stops arriving the screen
/// says CONNECTION LOST. The hub also tracks which roles have a screen open (the test console shows it).
/// </summary>
public sealed class LiveHub : ILiveNotifier, IDisposable
{
    private readonly ConcurrentDictionary<Guid, LiveClient> _clients = new();
    private readonly JsonSerializerOptions _json;
    private readonly TimeProvider _time;
    private readonly ILogger<LiveHub> _log;
    private readonly TimeSpan _offlineAfter;

    // what the screens must be told, collected while a change is in progress and delivered when it ends (LiveUpdates.Flush)
    private readonly object _workLock = new();
    private readonly HashSet<string> _dirtyCases = [];
    private bool _simulatorChanged;
    private bool _restartAll;

    private sealed class RolePresence
    {
        public bool Up;
        public long? At;
        public ITimer? Timer;
    }

    private readonly object _presenceLock = new();
    private readonly Dictionary<string, RolePresence> _presence = ActorRoles.PresenceRoles.ToDictionary(r => r, _ => new RolePresence());

    public LiveHub(JsonSerializerOptions json, TimeProvider time, IOptions<LiveOptions> options, ILogger<LiveHub> log)
    {
        _json = json;
        _time = time;
        _log = log;
        _offlineAfter = TimeSpan.FromMilliseconds(Math.Max(0, options.Value.OfflineAfterMs));
    }

    public IEnumerable<LiveClient> Clients => _clients.Values;
    public int ClientCount => _clients.Count;

    public string Format(string eventName, object data) => $"event: {eventName}\ndata: {JsonSerializer.Serialize(data, _json)}\n\n";

    public void Add(LiveClient client)
    {
        _clients[client.Id] = client;
        _log.LogDebug("Live link: {Role} screen connected ({Open} open)", client.Role, _clients.Count);
    }

    public void Remove(LiveClient client)
    {
        _clients.TryRemove(client.Id, out _);
        client.Outbox.Writer.TryComplete();
        if (!_clients.Values.Any(c => c.Role == client.Role)) SetPresence(client.Role, false);
        _log.LogDebug("Live link: {Role} screen disconnected ({Open} open)", client.Role, _clients.Count);
    }

    // ---------- ILiveNotifier (called by the application services) ----------

    public void CaseChanged(string cad)
    {
        lock (_workLock) _dirtyCases.Add(cad);
    }

    public void MonitorChanged(string cad, object monitor, long at)
    {
        string? message = null;
        foreach (var c in _clients.Values)
            if (c.Cads.Contains(cad)) c.Send(message ??= Format("monitor", new { cad, mon = monitor, at }));
    }

    public void Broadcast(string eventName, object data, string? onlyRole = null)
    {
        string? message = null;
        foreach (var c in _clients.Values)
            if (onlyRole is null || c.Role == onlyRole) c.Send(message ??= Format(eventName, data));
    }

    public void RestartAllScreens()
    {
        lock (_workLock) _restartAll = true;
    }

    public void SimulatorChanged()
    {
        lock (_workLock) _simulatorChanged = true;
    }

    /// <summary>Takes what the screens must be told (LiveUpdates.Flush, at the end of each change).</summary>
    public (List<string> Cases, bool SimulatorChanged, bool RestartAll) TakeWork()
    {
        lock (_workLock)
        {
            var work = (_dirtyCases.ToList(), _simulatorChanged, _restartAll);
            _dirtyCases.Clear();
            _simulatorChanged = false;
            _restartAll = false;
            return work;
        }
    }

    // ---------- presence: which roles have a screen open ----------

    public void SetPresence(string role, bool up)
    {
        lock (_presenceLock)
        {
            if (!_presence.TryGetValue(role, out var p)) return;
            p.Timer?.Dispose();
            p.Timer = null;
            if (up)
            {
                if (p.Up) return;
                p.Up = true;
                p.At = _time.NowMs();
            }
            else
            {
                if (!p.Up) return;
                // a screen that reloads reconnects within a second or two: only a longer gap counts as offline
                p.Timer = _time.CreateTimer(_ => GoneOffline(role), null, _offlineAfter, Timeout.InfiniteTimeSpan);
                return;
            }
        }
        BroadcastPresence();
    }

    private void GoneOffline(string role)
    {
        lock (_presenceLock)
        {
            var p = _presence[role];
            if (_clients.Values.Any(c => c.Role == role) || !p.Up) return;
            p.Up = false;
            p.At = _time.NowMs();
        }
        BroadcastPresence();
    }

    private void BroadcastPresence() => Broadcast("presence", Presence(), ActorRoles.Control);

    /// <summary>Up is null until a screen of that role has connected once since the server started (unknown, not offline).</summary>
    public Dictionary<string, object> Presence()
    {
        lock (_presenceLock)
            return _presence.ToDictionary(kv => kv.Key, kv => (object)new { up = kv.Value.At is null ? (bool?)null : kv.Value.Up, at = kv.Value.At });
    }

    public void Dispose()
    {
        lock (_presenceLock)
            foreach (var p in _presence.Values) p.Timer?.Dispose();
    }
}
