namespace Masar.Application.Common;

/// <summary>Times as written in the audit trail (the server's local time, like every screen shows).</summary>
public static class TimeText
{
    private static DateTime Local(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime;
    public static string Hm(long ms) => Local(ms).ToString("HH:mm");
    public static string Hms(long ms) => Local(ms).ToString("HH:mm:ss");
}
