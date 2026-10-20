using Masar.Infrastructure.Persistence;
using Masar.Infrastructure.Persistence.Migrations;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Masar.UnitTests.Infrastructure;

/// <summary>The database: reproducible migrations from a clean database, and adoption of a prototype database without data loss.</summary>
public class DatabaseTests
{
    private static List<string> Schema(string file)
    {
        using var c = new SqliteConnection($"Data Source={file};Pooling=False");
        c.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT type || ' ' || name || ': ' || IFNULL(sql, '') FROM sqlite_master WHERE name NOT LIKE '__EFMigrations%' AND name NOT LIKE 'sqlite_%' ORDER BY type, name";
        using var r = cmd.ExecuteReader();
        var list = new List<string>();
        while (r.Read()) list.Add(r.GetString(0));
        return list;
    }

    private static void Execute(string file, params string[] sql)
    {
        using var c = new SqliteConnection($"Data Source={file};Pooling=False");
        c.Open();
        foreach (var s in sql)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = s;
            cmd.ExecuteNonQuery();
        }
    }

    [Fact]
    public void A_clean_database_is_built_by_the_migrations_and_matches_the_model()
    {
        using var p = new TestPlatform();
        p.Gate.Run(db =>
        {
            var context = (MasarDbContext)db;
            Assert.Empty(context.Database.GetPendingMigrations());
            Assert.False(context.Database.HasPendingModelChanges(), "The EF model has changes that are not in a migration: add a migration (docs/database.md).");
            // every mapped table and column exists: each query reads every column of its table
            Assert.Empty(context.Cases.ToList());
            Assert.Empty(context.PatientDetails.ToList());
            Assert.Empty(context.Observations.ToList());
            Assert.Empty(context.Treatments.ToList());
            Assert.Empty(context.Ecgs.ToList());
            Assert.Empty(context.EcgImages.ToList());
            Assert.Empty(context.AiInterpretations.ToList());
            Assert.Empty(context.CardiologistAlerts.ToList());
            Assert.Empty(context.Decisions.ToList());
            Assert.Empty(context.EcgRoleViews.ToList());
            Assert.Empty(context.EcgViews.ToList());
            Assert.Empty(context.MonitorVitals.ToList());
            Assert.Empty(context.MonitorEvents.ToList());
            Assert.Empty(context.CaseUpdates.ToList());
            Assert.Empty(context.AuditEvents.ToList());
            Assert.Empty(context.Ops.ToList());
            Assert.Empty(context.AlertFollowups.ToList());
            Assert.Empty(context.Destinations.ToList());
            Assert.Empty(context.Etas.ToList());
            Assert.Empty(context.Arrivals.ToList());
            Assert.Empty(context.Handovers.ToList());
            Assert.Empty(context.FinalVitals.ToList());
            Assert.Single(context.Users.ToList());
        });
    }

    [Fact]
    public void A_database_created_by_the_nodejs_prototype_is_adopted_with_its_data_and_the_same_schema()
    {
        using var fresh = new TestPlatform();
        var freshSchema = Schema(Path.Combine(fresh.DataDirectory, "stemi-test.db"));

        // a 0.6.1 database exactly as the Node.js prototype built it on start, with a case in it
        using var adopted = new TestPlatform(initialize: false);
        var file = Path.Combine(adopted.DataDirectory, "stemi-test.db");
        Execute(file, InitialSchemaSql.CreateTables);
        foreach (var (table, column, type) in InitialSchemaSql.LaterColumns) Execute(file, $"ALTER TABLE {table} ADD COLUMN {column} {type}");
        Execute(file, InitialSchemaSql.Indexes, InitialSchemaSql.LaterIndexes,
            "INSERT INTO cases(cad, unit, emirate, crew_name, incident_type, created_at) VALUES('20261001-0001-1', 'Ambulance 214', 'RAK', 'K. Ahmed, Paramedic', 'STEMI pathway', 1)",
            "INSERT INTO audit_events(cad, at, actor, role, action, kind) VALUES('20261001-0001-1', 1, 'K. Ahmed, Paramedic', 'crew', 'STEMI case opened', 'key')");

        adopted.Get<DatabaseInitializer>().Initialize();

        Assert.Equal(freshSchema, Schema(file));
        adopted.Gate.Run(db =>
        {
            Assert.Equal("Ambulance 214", db.Cases.Single().Unit);
            Assert.Single(db.AuditEvents.ToList());
            Assert.Contains(InitialSchema.Id, ((MasarDbContext)db).Database.GetAppliedMigrations());
        });
    }

    [Fact]
    public void An_older_prototype_database_gets_the_columns_added_since_and_keeps_its_rows()
    {
        using var p = new TestPlatform(initialize: false);
        var file = Path.Combine(p.DataDirectory, "stemi-test.db");
        // a 0.4-era database: the original tables only (no ER step, no corpuls feed)
        Execute(file, InitialSchemaSql.CreateTables,
            "INSERT INTO cases(cad, unit, emirate, crew_name, incident_type, created_at, server_received_at) VALUES('20261001-0002-1', 'Ambulance 214', 'RAK', 'K. Ahmed, Paramedic', 'STEMI pathway', 1, 2)",
            "INSERT INTO cardiologist_alerts(cad, cardiologist, hospital, alerted_at) VALUES('20261001-0002-1', 'Dr X', 'PCI Hospital A', 3)");

        p.Get<DatabaseInitializer>().Initialize();

        var record = p.Record("20261001-0002-1");
        Assert.True(record.Legacy); // sent straight to the cardiologist before the ER step existed
        Assert.Equal(3, record.Cardio.Activated);
        Assert.Equal("cardiology_activated", record.State);
    }
}

public class CrewTestUserTests
{
    [Fact]
    public void A_changed_crew_test_email_is_applied_to_the_existing_account_and_no_password_is_in_the_source()
    {
        using var p = new TestPlatform();
        var password = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(8));
        var options = new Masar.Infrastructure.Configuration.PrototypeOptions { CrewTestUser = { Email = "Crew2@Test.Local ", Password = password } };
        var seeder = new Masar.Infrastructure.Identity.CrewTestUserSeeder(p.Gate, options, p.DataDirectory,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<Masar.Infrastructure.Identity.CrewTestUserSeeder>.Instance);
        seeder.Seed();
        var user = p.Gate.Run(db => db.Users.Single());
        Assert.Equal("crew2@test.local", user.Email);
        Assert.True(Masar.Infrastructure.Identity.CrewTestUserSeeder.Verify(user, password));
        Assert.False(Masar.Infrastructure.Identity.CrewTestUserSeeder.Verify(user, "stemi-test"));
    }

    [Fact]
    public void Without_a_configured_password_one_is_generated_in_the_data_folder()
    {
        using var p = new TestPlatform();
        var seeder = new Masar.Infrastructure.Identity.CrewTestUserSeeder(p.Gate, new Masar.Infrastructure.Configuration.PrototypeOptions(), p.DataDirectory,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<Masar.Infrastructure.Identity.CrewTestUserSeeder>.Instance);
        var source = seeder.Seed();
        var file = Path.Combine(p.DataDirectory, Masar.Infrastructure.Identity.CrewTestUserSeeder.GeneratedPasswordFile);
        Assert.Equal(Path.GetFullPath(file), source);
        var generated = File.ReadAllText(file).Trim();
        Assert.True(generated.Length >= 12);
        Assert.True(Masar.Infrastructure.Identity.CrewTestUserSeeder.Verify(p.Gate.Run(db => db.Users.Single()), generated));
    }
}
