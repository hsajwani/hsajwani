using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace Masar.Api.Hosting;

/// <summary>The application's identity and where it can be reached (health endpoint, startup banner, /api/info).</summary>
public sealed class AppInfo(IServer server)
{
    /// <summary>The name the health endpoint reports (kept from the prototype: the development runner checks it).</summary>
    public const string AppName = "stemi-unified-platform";

    public static string Version { get; } = (typeof(AppInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0").Split('+')[0];

    public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;

    /// <summary>The port the server listens on (the first HTTP address).</summary>
    public int Port
    {
        get
        {
            var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault();
            return address is not null && Uri.TryCreate(address.Replace("://+", "://localhost").Replace("://*", "://localhost").Replace("://0.0.0.0", "://localhost"), UriKind.Absolute, out var uri) ? uri.Port : 0;
        }
    }

    public sealed record LanAddress(string Name, string Address);

    /// <summary>This computer's IPv4 addresses on the local network (Wi-Fi on a Mac is usually en0: listed first).</summary>
    public static List<LanAddress> LanAddresses()
    {
        var list = new List<LanAddress>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (var a in nic.GetIPProperties().UnicastAddresses)
                    if (a.Address.AddressFamily == AddressFamily.InterNetwork && !System.Net.IPAddress.IsLoopback(a.Address))
                        list.Add(new LanAddress(nic.Name, a.Address.ToString()));
            }
        }
        catch (NetworkInformationException)
        {
            // no network information on this host: the banner says so
        }
        return list.OrderBy(a => a.Name == "en0" ? 0 : 1).ToList();
    }
}
