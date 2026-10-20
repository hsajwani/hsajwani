using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Masar.Infrastructure.Persistence;

/// <summary>The key–value settings table (simulation choices, the screens' data epoch, the simulated monitors).</summary>
public sealed class SettingsStore(PlatformGate gate) : ISettingsStore
{
    public string? Get(string key) => gate.Run(db => db.Settings.Where(s => s.Key == key).Select(s => s.Value).FirstOrDefault());

    public void Set(string key, string value) => gate.Run(db =>
    {
        if (db.Settings.Where(s => s.Key == key).ExecuteUpdate(u => u.SetProperty(s => s.Value, value)) == 0)
            db.Insert(new Setting { Key = key, Value = value });
    });
}
