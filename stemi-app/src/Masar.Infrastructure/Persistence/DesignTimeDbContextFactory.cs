using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Masar.Infrastructure.Persistence;

/// <summary>
/// Used only by the EF Core tools (dotnet ef migrations add …) to build the model without starting the application.
/// It never opens a real database. See docs/database.md, "Adding a migration".
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<MasarDbContext>
{
    public MasarDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<MasarDbContext>().UseSqlite("Data Source=design-time.db").Options);
}
