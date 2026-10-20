using System.Security.Cryptography;

namespace Masar.Application.Common;

/// <summary>Row identifiers: a short prefix and 12 random hex characters (the format the prototype has always used).</summary>
public static class Ids
{
    public static string New(string prefix) => prefix + Convert.ToHexString(RandomNumberGenerator.GetBytes(6)).ToLowerInvariant();
}
