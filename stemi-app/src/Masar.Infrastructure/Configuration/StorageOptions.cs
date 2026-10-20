namespace Masar.Infrastructure.Configuration;

/// <summary>Where the prototype keeps its data (configuration section "Storage").</summary>
public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary>
    /// The data folder: the SQLite database, the ECG image files, the Data Protection keys and the generated crew test
    /// password. Relative paths are relative to the application's content root. Never commit it (fictional test data).
    /// </summary>
    public string DataDirectory { get; set; } = "data";

    /// <summary>The SQLite file name (the Node.js prototype's name, so an existing test database keeps working).</summary>
    public string DatabaseFileName { get; set; } = "stemi-test.db";

    /// <summary>The largest ECG image the crew may upload (bytes).</summary>
    public long MaxImageBytes { get; set; } = 8 * 1024 * 1024;
}
