using System.Threading.Channels;
using Masar.Application.Common;

namespace Masar.Api.Live;

/// <summary>One open screen on the live link (Server-Sent Events).</summary>
public sealed class LiveClient(Actor actor)
{
    public Guid Id { get; } = Guid.NewGuid();
    public Actor Actor { get; } = actor;
    public string Role => Actor.Role;

    /// <summary>The cases this screen holds (it receives their updates). Changed only under the PlatformGate.</summary>
    public HashSet<string> Cads { get; } = [];

    /// <summary>Messages waiting to be written to the screen, in order (written by the stream request, never blocking a sender).</summary>
    public Channel<string> Outbox { get; } = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    /// <summary>Queues one already-formatted event ("event: …\ndata: …\n\n").</summary>
    public void Send(string message) => Outbox.Writer.TryWrite(message);
}
