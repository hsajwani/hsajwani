using Masar.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Masar.Application.Abstractions;

/// <summary>
/// The database as the application services see it (implemented by MasarDbContext in Masar.Infrastructure).
/// One short-lived context per unit of work: the services receive it from <see cref="Common.PlatformGate"/>.
/// </summary>
public interface IMasarDbContext : IDisposable
{
    DbSet<Case> Cases { get; }
    DbSet<PatientDetail> PatientDetails { get; }
    DbSet<Observation> Observations { get; }
    DbSet<Treatment> Treatments { get; }
    DbSet<Ecg> Ecgs { get; }
    DbSet<EcgImage> EcgImages { get; }
    DbSet<AiInterpretation> AiInterpretations { get; }
    DbSet<CardiologistAlert> CardiologistAlerts { get; }
    DbSet<Decision> Decisions { get; }
    DbSet<EcgRoleView> EcgRoleViews { get; }
    DbSet<EcgView> EcgViews { get; }
    DbSet<MonitorVital> MonitorVitals { get; }
    DbSet<MonitorEvent> MonitorEvents { get; }
    DbSet<CaseUpdate> CaseUpdates { get; }
    DbSet<AuditEvent> AuditEvents { get; }
    DbSet<Op> Ops { get; }
    DbSet<Setting> Settings { get; }
    DbSet<User> Users { get; }
    DatabaseFacade Database { get; }
    ChangeTracker ChangeTracker { get; }
    EntityEntry Add(object entity);
    int SaveChanges();
}

public interface IMasarDbContextFactory
{
    IMasarDbContext Create();
}
