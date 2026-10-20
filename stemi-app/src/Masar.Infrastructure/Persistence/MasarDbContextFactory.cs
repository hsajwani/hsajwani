using Masar.Application.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace Masar.Infrastructure.Persistence;

/// <summary>Creates the short-lived database context of one unit of work (see Masar.Application.Common.PlatformGate).</summary>
public sealed class MasarDbContextFactory(IDbContextFactory<MasarDbContext> factory) : IMasarDbContextFactory
{
    public IMasarDbContext Create() => factory.CreateDbContext();
}
