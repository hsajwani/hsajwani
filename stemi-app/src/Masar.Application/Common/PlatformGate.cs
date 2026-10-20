using Masar.Application.Abstractions;
using Microsoft.Extensions.Logging;

namespace Masar.Application.Common;

/// <summary>
/// Serialises every change to the shared case record and is its unit of work.
/// <para>
/// Why: the pathway rules depend on seeing one consistent case. ECG numbers are "the case's highest ECG number + 1", an
/// action is checked against the state it finds, and the screens, the corpuls feed and the AI service all change the
/// same case. The prototype is a single server process, so one lock is enough. It is reentrant: an action may trigger a
/// corpuls event or another change, which then runs inside the same unit of work and sees its uncommitted rows
/// (SQLite allows one writer; a second connection would wait for the first one forever).
/// </para>
/// <para>
/// Every <see cref="Run{T}"/> gets the database context of the change in progress; the outermost call creates it and
/// disposes it at the end. Code inside must be synchronous (no await): the lock belongs to the thread.
/// When the outermost call ends, the completion handlers run while the lock is still held — the live link uses this
/// to push the changed cases to the screens before the HTTP answer leaves, so no screen sees a half-made change.
/// </para>
/// A deployment with several server instances needs a different mechanism (database row locking or a single writer
/// queue) — see docs/architecture.md.
/// </summary>
public sealed class PlatformGate(IMasarDbContextFactory factory, ILogger<PlatformGate> log)
{
    private readonly object _sync = new();
    private readonly List<Action<IMasarDbContext>> _completed = [];
    private IMasarDbContext? _current;
    private int _depth;

    /// <summary>Registers work to run at the end of every unit of work (registered once, at start).</summary>
    public void OnUnitOfWorkCompleted(Action<IMasarDbContext> handler)
    {
        lock (_sync) _completed.Add(handler);
    }

    public T Run<T>(Func<IMasarDbContext, T> work)
    {
        lock (_sync)
        {
            var outermost = _depth == 0;
            if (outermost) _current = factory.Create();
            _depth++;
            try
            {
                return work(_current!);
            }
            finally
            {
                if (outermost) Complete(_current!);
                _depth--;
                if (outermost)
                {
                    _current!.Dispose();
                    _current = null;
                }
            }
        }
    }

    public void Run(Action<IMasarDbContext> work) => Run(db => { work(db); return true; });

    private void Complete(IMasarDbContext db)
    {
        foreach (var handler in _completed)
        {
            try
            {
                handler(db);
            }
            catch (Exception e)
            {
                // a failed push must never undo or block the change itself
                log.LogError(e, "A unit-of-work completion handler failed");
            }
        }
    }
}
