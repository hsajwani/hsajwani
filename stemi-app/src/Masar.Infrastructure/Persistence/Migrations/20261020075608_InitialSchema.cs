using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Masar.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Baseline migration: the database schema of the Node.js prototype 0.6.1, created with the prototype's own SQL
    /// (<see cref="InitialSchemaSql"/>) so that a new database and a database created by the prototype are identical.
    /// A prototype database is adopted without running this migration (see DatabaseInitializer). NEVER CHANGE: later
    /// schema changes are new migrations.
    /// </summary>
    public partial class InitialSchema : Migration
    {
        /// <summary>The migration id recorded in __EFMigrationsHistory (also when a prototype database is adopted).</summary>
        public const string Id = "20261020075608_InitialSchema";
        /// <summary>The EF Core version recorded with the baseline.</summary>
        public const string ProductVersion = "10.0.13";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(InitialSchemaSql.CreateTables);
            foreach (var (table, column, type) in InitialSchemaSql.LaterColumns)
                migrationBuilder.Sql($"ALTER TABLE {table} ADD COLUMN {column} {type};");
            migrationBuilder.Sql(InitialSchemaSql.Indexes);
            migrationBuilder.Sql(InitialSchemaSql.LaterIndexes);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "audit_events");
            migrationBuilder.DropTable(name: "ecg_role_views");
            migrationBuilder.DropTable(name: "ecg_views");
            migrationBuilder.DropTable(name: "ops");
            migrationBuilder.DropTable(name: "settings");
            migrationBuilder.DropTable(name: "users");
            migrationBuilder.DropTable(name: "ai_interpretations");
            migrationBuilder.DropTable(name: "alert_followups");
            migrationBuilder.DropTable(name: "arrivals");
            migrationBuilder.DropTable(name: "cardiologist_alerts");
            migrationBuilder.DropTable(name: "case_updates");
            migrationBuilder.DropTable(name: "decisions");
            migrationBuilder.DropTable(name: "destinations");
            migrationBuilder.DropTable(name: "ecg_images");
            migrationBuilder.DropTable(name: "ecgs");
            migrationBuilder.DropTable(name: "etas");
            migrationBuilder.DropTable(name: "final_vitals");
            migrationBuilder.DropTable(name: "handovers");
            migrationBuilder.DropTable(name: "monitor_events");
            migrationBuilder.DropTable(name: "monitor_vitals");
            migrationBuilder.DropTable(name: "observations");
            migrationBuilder.DropTable(name: "patient_details");
            migrationBuilder.DropTable(name: "treatments");
            migrationBuilder.DropTable(name: "cases");
        }
    }
}
