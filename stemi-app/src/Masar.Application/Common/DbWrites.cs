using Masar.Application.Abstractions;

namespace Masar.Application.Common;

/// <summary>
/// How the services write: every insert is saved at once (write-through), and updates use ExecuteUpdate, so each write
/// is executed immediately inside the current transaction, in the order the code makes it (as the SQL of the Node.js
/// prototype did). Queries do not track entities (MasarDbContext uses NoTracking), so a read always returns what is in
/// the database. Nothing relies on the change tracker.
/// </summary>
public static class DbWrites
{
    public static T Insert<T>(this IMasarDbContext db, T entity) where T : class
    {
        db.Add(entity);
        try
        {
            db.SaveChanges();
        }
        finally
        {
            db.ChangeTracker.Clear();
        }
        return entity;
    }
}
