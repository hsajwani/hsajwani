using System.Text;
using Masar.Application.Abstractions;
using Masar.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Masar.Infrastructure.Persistence;

/// <summary>
/// The MASAR database (EF Core). PROTOTYPE DATABASE: SQLite, one file (data/stemi-test.db), unless SQLite is approved
/// for production (see docs/database.md). The tables and columns are those of the Node.js prototype (0.6.1), so an
/// existing test database keeps working: table names are explicit and every property maps to its snake_case column.
/// Queries do not track entities: the services write through (see Masar.Application.Common.DbWrites).
/// </summary>
public sealed class MasarDbContext(DbContextOptions<MasarDbContext> options) : DbContext(options), IMasarDbContext
{
    public DbSet<Case> Cases => Set<Case>();
    public DbSet<PatientDetail> PatientDetails => Set<PatientDetail>();
    public DbSet<Observation> Observations => Set<Observation>();
    public DbSet<Treatment> Treatments => Set<Treatment>();
    public DbSet<Ecg> Ecgs => Set<Ecg>();
    public DbSet<EcgImage> EcgImages => Set<EcgImage>();
    public DbSet<AiInterpretation> AiInterpretations => Set<AiInterpretation>();
    public DbSet<CardiologistAlert> CardiologistAlerts => Set<CardiologistAlert>();
    public DbSet<Decision> Decisions => Set<Decision>();
    public DbSet<EcgRoleView> EcgRoleViews => Set<EcgRoleView>();
    public DbSet<EcgView> EcgViews => Set<EcgView>();
    public DbSet<MonitorVital> MonitorVitals => Set<MonitorVital>();
    public DbSet<MonitorEvent> MonitorEvents => Set<MonitorEvent>();
    public DbSet<CaseUpdate> CaseUpdates => Set<CaseUpdate>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<Op> Ops => Set<Op>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<User> Users => Set<User>();

    // Kept only so databases from earlier versions keep opening; nothing in this version writes to them.
    public DbSet<AlertFollowup> AlertFollowups => Set<AlertFollowup>();
    public DbSet<Destination> Destinations => Set<Destination>();
    public DbSet<Eta> Etas => Set<Eta>();
    public DbSet<Arrival> Arrivals => Set<Arrival>();
    public DbSet<Handover> Handovers => Set<Handover>();
    public DbSet<FinalVitals> FinalVitals => Set<FinalVitals>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            // PROTOTYPE ONLY: one crew test account; 0.4.0 and earlier also had a cardiologist test account (kept, cannot log in)
            e.ToTable("users", t => t.HasCheckConstraint("ck_users_role", "role IN ('crew','cardiologist')"));
            e.HasKey(x => x.Id);
            e.HasIndex(x => x.Email).IsUnique();
        });
        b.Entity<Case>(e =>
        {
            e.ToTable("cases");
            e.HasKey(x => x.Cad);
            e.Property(x => x.Active).HasDefaultValue(true);
            e.Property(x => x.DeliveredLate).HasDefaultValue(false);
        });
        b.Entity<PatientDetail>(e => { e.ToTable("patient_details"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<Observation>(e => { e.ToTable("observations"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<Treatment>(e =>
        {
            e.ToTable("treatments");
            e.HasKey(x => x.Id);
            e.Property(x => x.NotObtained).HasDefaultValue(false);
            CaseChild(e);
        });
        b.Entity<Ecg>(e =>
        {
            e.ToTable("ecgs");
            e.HasKey(x => new { x.Cad, x.N });
            e.Property(x => x.PrimaryImage).HasDefaultValue(1);
            e.Property(x => x.SameAsPrevious).HasDefaultValue(false);
            e.HasIndex(x => x.SourceEventId).HasDatabaseName("ix_ecg_event");
            CaseChild(e);
        });
        b.Entity<EcgImage>(e =>
        {
            e.ToTable("ecg_images");
            e.HasKey(x => x.Id);
            e.Property(x => x.AddedAfterSend).HasDefaultValue(false);
            e.HasIndex(x => new { x.Cad, x.EcgN }).HasDatabaseName("ix_img_cad");
            CaseChild(e);
        });
        b.Entity<AiInterpretation>(e => { e.ToTable("ai_interpretations"); e.HasKey(x => new { x.Cad, x.EcgN }); CaseChild(e); });
        b.Entity<CardiologistAlert>(e => { e.ToTable("cardiologist_alerts"); e.HasKey(x => x.Cad); CaseChild(e); });
        b.Entity<AlertFollowup>(e => { e.ToTable("alert_followups"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<EcgView>(e => { e.ToTable("ecg_views"); e.HasKey(x => new { x.Cad, x.EcgN, x.I }); });
        b.Entity<EcgRoleView>(e => { e.ToTable("ecg_role_views"); e.HasKey(x => new { x.Cad, x.Role, x.EcgN, x.I }); });
        b.Entity<Decision>(e =>
        {
            e.ToTable("decisions", t => t.HasCheckConstraint("ck_decisions_kind", "kind IN ('confirm','not','repeat')"));
            e.HasKey(x => x.Id);
            CaseChild(e);
        });
        b.Entity<Destination>(e => { e.ToTable("destinations"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<Eta>(e => { e.ToTable("etas"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<Arrival>(e => { e.ToTable("arrivals"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<Handover>(e => { e.ToTable("handovers"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<FinalVitals>(e => { e.ToTable("final_vitals"); e.HasKey(x => x.Id); CaseChild(e); });
        b.Entity<MonitorVital>(e =>
        {
            e.ToTable("monitor_vitals");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.Cad, x.At }).HasDatabaseName("ix_monv_cad");
            CaseChild(e);
        });
        b.Entity<MonitorEvent>(e =>
        {
            e.ToTable("monitor_events");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.Cad, x.At }).HasDatabaseName("ix_mone_cad");
            CaseChild(e);
        });
        b.Entity<CaseUpdate>(e =>
        {
            e.ToTable("case_updates");
            e.HasKey(x => x.Id);
            e.HasIndex(x => new { x.Cad, x.At }).HasDatabaseName("ix_upd_cad");
            CaseChild(e);
        });
        // The audit trail has no foreign key to cases: an entry is never lost because of a later change to a case.
        b.Entity<AuditEvent>(e =>
        {
            e.ToTable("audit_events");
            e.HasKey(x => x.Id);
            e.Property(x => x.Kind).HasDefaultValue("evt");
            e.HasIndex(x => new { x.Cad, x.At }).HasDatabaseName("ix_audit_cad");
        });
        b.Entity<Op>(e => { e.ToTable("ops"); e.HasKey(x => x.OpId); });
        b.Entity<Setting>(e => { e.ToTable("settings"); e.HasKey(x => x.Key); });

        // every column is the snake_case form of its property (CorpulsLinkedAt → corpuls_linked_at)
        foreach (var entity in b.Model.GetEntityTypes())
            foreach (var property in entity.GetProperties())
                property.SetColumnName(SnakeCase(property.Name));
    }

    private static void CaseChild<T>(Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<T> e) where T : class =>
        e.HasOne<Case>().WithMany().HasForeignKey("Cad").OnDelete(DeleteBehavior.Restrict);

    /// <summary>"ErAlertShownAt" → "er_alert_shown_at"; "Spo2" → "spo2"; "EcgN" → "ecg_n".</summary>
    public static string SnakeCase(string name)
    {
        var sb = new StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var ch = name[i];
            if (char.IsUpper(ch) && i > 0 && (char.IsLower(name[i - 1]) || char.IsDigit(name[i - 1]))) sb.Append('_');
            sb.Append(char.ToLowerInvariant(ch));
        }
        return sb.ToString();
    }
}
