namespace Masar.Application.Common;

/// <summary>Every stored time is Unix epoch milliseconds (UTC). The clock is .NET's <see cref="TimeProvider"/>, replaceable in tests.</summary>
public static class Clock
{
    public static long NowMs(this TimeProvider time) => time.GetUtcNow().ToUnixTimeMilliseconds();
}
