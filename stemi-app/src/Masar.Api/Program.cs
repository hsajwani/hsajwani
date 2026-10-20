// MASAR — STEMI Coordination Platform (prototype). ASP.NET Core host.
// TEST DATA ONLY: fictional patients, fictional CAD numbers, simulated corpuls monitors, simulated AI, test users.
// One process serves every role's screen (/crew, /er, /cardiologist, /control), the HTTP API, the live event stream and
// the stored ECG images. Architecture: docs/architecture.md · configuration: docs/configuration.md.
using Masar.Api.Configuration;
using Masar.Api.Hosting;
using Masar.Api.Live;
using Masar.Api.Security;
using Masar.Application;
using Masar.Application.Abstractions;
using Masar.Application.Common;
using Masar.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<FrontendOptions>(builder.Configuration.GetSection(FrontendOptions.Section));
builder.Services.Configure<PrototypeSessionOptions>(builder.Configuration.GetSection(PrototypeSessionOptions.Section));
builder.Services.Configure<LiveOptions>(builder.Configuration.GetSection(LiveOptions.Section));

builder.Services.AddMasarApplication();
builder.Services.AddMasarInfrastructure(builder.Configuration, builder.Environment.ContentRootPath);

// JSON as the screens read it: camelCase names (the same options for the API and the live stream)
var json = JsonDefaults.Create();
builder.Services.AddSingleton(json);
builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = json.PropertyNamingPolicy;
        o.JsonSerializerOptions.Encoder = json.Encoder;
    })
    .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(new { error = "Bad JSON" }));

// PROTOTYPE ONLY sessions (see Security/ScreenSessions.cs and docs/security.md). The cookie keys are kept in the data
// folder so sessions survive a restart; production must protect them (e.g. a certificate or a key vault).
var sessions = builder.Configuration.GetSection(PrototypeSessionOptions.Section).Get<PrototypeSessionOptions>() ?? new PrototypeSessionOptions();
var paths = StoragePaths.Resolve(
    builder.Configuration.GetSection(Masar.Infrastructure.Configuration.StorageOptions.Section).Get<Masar.Infrastructure.Configuration.StorageOptions>() ?? new(),
    builder.Environment.ContentRootPath);
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(paths.KeysDirectory)).SetApplicationName("MASAR-STEMI");
builder.Services.AddAuthentication().AddScreenSessions(sessions.CrewSessionHours, sessions.DeviceSessionDays, sessions.RequireSecureCookies);
builder.Services.AddSingleton<ActorResolver>();

builder.Services.AddSingleton<AppInfo>();
builder.Services.AddSingleton<FrontendFiles>();
builder.Services.AddSingleton<LiveHub>();
builder.Services.AddSingleton<ILiveNotifier>(sp => sp.GetRequiredService<LiveHub>());
builder.Services.AddSingleton<LiveUpdates>();
builder.Services.AddHostedService<HeartbeatService>();

var app = builder.Build();

// every response that does not say otherwise must not be cached (API answers, pages)
app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var headers = context.Response.Headers;
        if (!headers.ContainsKey("Cache-Control")) headers.CacheControl = "no-store";
        headers.XContentTypeOptions = "nosniff";
        headers["Referrer-Policy"] = "no-referrer";
        headers.XFrameOptions = "DENY";
        return Task.CompletedTask;
    });
    await next();
});

// the screens' files: /assets/… → the Frontend:RootPath folder, revalidated on every load (a refresh shows a change)
var frontend = app.Services.GetRequiredService<FrontendFiles>();
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = frontend.Provider,
    RequestPath = "/assets",
    OnPrepareResponse = c =>
    {
        c.Context.Response.Headers.CacheControl = "no-cache";
        var type = c.Context.Response.ContentType;
        if (type is not null && (type.StartsWith("text/") || type.StartsWith("application/javascript")) && !type.Contains("charset")) c.Context.Response.ContentType = type + "; charset=utf-8";
    },
});

app.UseAuthentication();
app.MapControllers();
// anything else: 404 (the screens and the API answer for themselves above)
app.MapFallback(context =>
{
    context.Response.StatusCode = StatusCodes.Status404NotFound;
    return context.Request.Path.StartsWithSegments("/api")
        ? context.Response.WriteAsJsonAsync(new { error = "Not found" })
        : context.Response.WriteAsync("Not found");
});

var passwordSource = StartupTasks.Run(app.Services);
app.Lifetime.ApplicationStarted.Register(() =>
{
    app.Logger.LogInformation("MASAR {Version} started ({Environment}); data folder {DataDirectory}", AppInfo.Version, app.Environment.EnvironmentName, paths.DataDirectory);
    StartupBanner.Print(app.Services, passwordSource);
});
app.Run();

/// <summary>The entry point type, visible to the integration tests (WebApplicationFactory).</summary>
public partial class Program;
