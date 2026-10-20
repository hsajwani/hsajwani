using System.Data.Common;
using Masar.Infrastructure.Persistence.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging;

namespace Masar.Infrastructure.Persistence;

/// <summary>
/// Brings the database to the current schema at start, with EF Core migrations (reproducible: see docs/database.md).
/// <list type="bullet">
/// <item>A new database: every migration runs, starting with the baseline <see cref="InitialSchema"/> (the 0.6.1 schema).</item>
/// <item>A test database created by the Node.js prototype (0.1 – 0.6.1; it has no migration history): it is brought to
/// the 0.6.1 schema with the same idempotent steps the prototype ran on every start, the baseline is recorded as applied,
/// then the later migrations run. Nothing is deleted: every existing case, ECG and audit entry is kept.</item>
/// </list>
/// </summary>
public sealed class DatabaseInitializer(IDbContextFactory<MasarDbContext> factory, ILogger<DatabaseInitializer> log)
{
    public void Initialize()
    {
        using var db = factory.CreateDbContext();
        var connection = db.Database.GetDbConnection();
        db.Database.OpenConnection();
        try
        {
            // write-ahead logging: readers (the screens, a test reading the file) never block the writer
            Execute(connection, "PRAGMA journal_mode = WAL");
            if (!TableExists(connection, "__EFMigrationsHistory") && TableExists(connection, "cases")) AdoptPrototypeDatabase(db, connection);
        }
        finally
        {
            db.Database.CloseConnection();
        }
        var pending = db.Database.GetPendingMigrations().ToList();
        if (pending.Count > 0) log.LogInformation("Applying database migrations: {Migrations}", string.Join(", ", pending));
        db.Database.Migrate();
    }

    private void AdoptPrototypeDatabase(MasarDbContext db, DbConnection connection)
    {
        log.LogInformation("Database created by the Node.js prototype found: bringing it to the baseline schema and recording the baseline migration (no data is changed)");
        using var tx = connection.BeginTransaction();
        Execute(connection, InitialSchemaSql.CreateTables, tx);
        foreach (var (table, column, type) in InitialSchemaSql.ColumnsAddedOnStartByThePrototype)
            if (!ColumnExists(connection, table, column, tx)) Execute(connection, $"ALTER TABLE {table} ADD COLUMN {column} {type}", tx);
        Execute(connection, InitialSchemaSql.Indexes, tx);
        Execute(connection, InitialSchemaSql.LaterIndexes, tx);
        var history = db.GetService<IHistoryRepository>();
        Execute(connection, history.GetCreateIfNotExistsScript(), tx);
        Execute(connection, history.GetInsertScript(new HistoryRow(InitialSchema.Id, InitialSchema.ProductVersion)), tx);
        tx.Commit();
    }

    private static void Execute(DbConnection connection, string sql, DbTransaction? tx = null)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = tx;
        command.ExecuteNonQuery();
    }

    private static bool TableExists(DbConnection connection, string table)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name";
        var p = command.CreateParameter();
        p.ParameterName = "$name";
        p.Value = table;
        command.Parameters.Add(p);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }

    private static bool ColumnExists(DbConnection connection, string table, string column, DbTransaction tx)
    {
        using var command = connection.CreateCommand();
        command.Transaction = tx;
        command.CommandText = "SELECT COUNT(*) FROM pragma_table_info($table) WHERE name = $column";
        var t = command.CreateParameter();
        t.ParameterName = "$table";
        t.Value = table;
        command.Parameters.Add(t);
        var c = command.CreateParameter();
        c.ParameterName = "$column";
        c.Value = column;
        command.Parameters.Add(c);
        return Convert.ToInt64(command.ExecuteScalar()) > 0;
    }
}
