namespace Masar.Application.Abstractions;

/// <summary>Small key–value settings kept in the database (table <c>settings</c>).</summary>
public interface ISettingsStore
{
    string? Get(string key);
    void Set(string key, string value);
}
