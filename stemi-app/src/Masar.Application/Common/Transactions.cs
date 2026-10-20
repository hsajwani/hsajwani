using Masar.Application.Abstractions;

namespace Masar.Application.Common;

/// <summary>Runs a group of writes as one database transaction: all of them are stored, or none.</summary>
public static class Transactions
{
    /// <summary>Joins the transaction already open on this unit of work, or opens (and commits) one.</summary>
    public static void InTransaction(this IMasarDbContext db, Action work)
    {
        if (db.Database.CurrentTransaction is not null)
        {
            work();
            return;
        }
        using var tx = db.Database.BeginTransaction();
        try
        {
            work();
            tx.Commit();
        }
        catch
        {
            // the rows inserted before the failure are gone: forget them in the context as well
            db.ChangeTracker.Clear();
            throw;
        }
    }
}
