using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Masar.IntegrationTests;

/// <summary>The HTTP API and the screens' contract, through the real ASP.NET Core pipeline.</summary>
public class ApiTests(MasarApiFactory factory) : IClassFixture<MasarApiFactory>
{
    private static readonly string Today = DateTime.Now.ToString("yyyyMMdd");
    private static string Cad(int n) => $"{Today}-{n:0000}-1";

    private async Task<HttpClient> CrewAsync()
    {
        var crew = factory.Screen("crew");
        var r = await crew.PostAsJsonAsync("/api/login", new { email = "crew@test.local", password = MasarApiFactory.CrewPassword });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return crew;
    }

    private async Task<HttpClient> DeviceAsync(string role)
    {
        var client = factory.Screen(role);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/" + role)).StatusCode); // the page gives the device session
        return client;
    }

    private static async Task<JsonNode> Json(HttpResponseMessage r) => JsonNode.Parse(await r.Content.ReadAsStringAsync())!;

    [Fact]
    public async Task Health_answers_without_a_login_and_reveals_nothing()
    {
        var r = await factory.CreateClient().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var body = await r.Content.ReadAsStringAsync();
        var h = JsonNode.Parse(body)!;
        Assert.Equal("ok", h["status"]!.GetValue<string>());
        Assert.Equal("stemi-unified-platform", h["app"]!.GetValue<string>());
        Assert.Equal(Masar.Api.Hosting.AppInfo.Version, h["version"]!.GetValue<string>());
        Assert.DoesNotMatch("(?i)cad|crew@|secret|password", body);
    }

    [Fact]
    public async Task The_data_folder_is_the_configured_one()
    {
        await factory.CreateClient().GetAsync("/health");
        Assert.True(File.Exists(Path.Combine(factory.DataDirectory, "stemi-test.db")));
    }

    [Fact]
    public async Task Pages_carry_their_role_and_device_screens_get_a_prototype_session()
    {
        var er = factory.Screen("er");
        var r = await er.GetAsync("/er");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Contains("window.APP={\"role\":\"er\"", await r.Content.ReadAsStringAsync());
        Assert.Contains(r.Headers.GetValues("Set-Cookie"), c => c.StartsWith("stemi_dev_er=") && c.Contains("httponly", StringComparison.OrdinalIgnoreCase));

        var crewPage = await factory.Screen("crew").GetAsync("/crew");
        Assert.Equal(HttpStatusCode.Redirect, crewPage.StatusCode);
        Assert.Equal("/login?next=%2Fcrew", crewPage.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task The_crew_login_accepts_only_the_configured_password()
    {
        var crew = factory.Screen("crew");
        var refused = await crew.PostAsJsonAsync("/api/login", new { email = "crew@test.local", password = "wrong" });
        Assert.Equal(HttpStatusCode.Unauthorized, refused.StatusCode);
        Assert.Equal("Email or password not recognised", (await Json(refused))["error"]!.GetValue<string>());

        var client = await CrewAsync();
        var me = await Json(await client.GetAsync("/api/me"));
        Assert.Equal("crew", me["role"]!.GetValue<string>());
        Assert.Equal("Ambulance 214", me["user"]!["unit"]!.GetValue<string>());
    }

    [Fact]
    public async Task Without_a_session_the_api_refuses_with_the_screens_message()
    {
        var crew = await factory.Screen("crew").GetAsync("/api/cases");
        Assert.Equal(HttpStatusCode.Unauthorized, crew.StatusCode);
        Assert.Equal("Not logged in", (await Json(crew))["error"]!.GetValue<string>());
        var er = await factory.Screen("er").GetAsync("/api/cases");
        Assert.Equal("No session for this screen: reload the page", (await Json(er))["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task Each_screen_may_do_only_its_own_actions()
    {
        var er = await DeviceAsync("er");
        var create = await er.PostAsJsonAsync("/api/cases", new { cad = Cad(901) });
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
        Assert.Equal("Only the crew opens cases", (await Json(create))["error"]!.GetValue<string>());

        var console = await DeviceAsync("control");
        var ops = await console.PostAsJsonAsync("/api/ops", new { ops = new[] { new { id = "x", cad = Cad(901), k = "note", t = 1 } } });
        Assert.Equal(HttpStatusCode.Forbidden, ops.StatusCode);

        var crew = await CrewAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await crew.PostAsync("/api/control/reset", null)).StatusCode);
    }

    [Fact]
    public async Task A_case_is_created_once_and_the_er_sees_it_only_after_send()
    {
        var crew = await CrewAsync();
        var cad = Cad(902);
        var created = await crew.PostAsJsonAsync("/api/cases", new { cad = $"cad # {cad}", cid = "it-1" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var body = await Json(created);
        Assert.True(body["ok"]!.GetValue<bool>());
        Assert.Equal("draft", body["rec"]!["state"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict, (await crew.PostAsJsonAsync("/api/cases", new { cad, cid = "other" })).StatusCode);

        var er = await DeviceAsync("er");
        Assert.Equal(HttpStatusCode.NotFound, (await er.GetAsync("/api/cases/view?cad=" + cad)).StatusCode);

        // the manual ECG fallback: a fictional image uploaded, then SEND
        using var image = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xD9]);
        image.Headers.ContentType = new("image/jpeg");
        var upload = await Json(await crew.PostAsync($"/api/images?src=file&cad={cad}", image));
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var submit = await crew.PostAsJsonAsync("/api/ops", new
        {
            ops = new[]
            {
                new
                {
                    id = "it-submit", cad, k = "submit", t = now,
                    data = new
                    {
                        sendAt = now,
                        md = new
                        {
                            age = new { v = "58 y", raw = new { v = 58 }, t = now }, sex = new { v = "Male", raw = new { v = "Male" }, t = now },
                            complaint = new { v = "Chest pain", raw = new { k = "cp" }, t = now }, onset = new { v = "Unknown", raw = new { nv = "Unknown" }, t = now },
                        },
                        ecg = new { n = 1, acq = now - 1000, pri = 1, imgs = new[] { new { i = 1, kind = "full", q = "file", at = now - 1000, imageId = upload["id"]!.GetValue<string>() } } },
                    },
                },
            },
        });
        Assert.True((await Json(submit))["results"]![0]!["ok"]!.GetValue<bool>());
        var view = await Json(await er.GetAsync("/api/cases/view?cad=" + cad));
        Assert.Equal("sent_to_er", view["rec"]!["state"]!.GetValue<string>());
        Assert.Equal("manual_fallback", view["rec"]!["ecgs"]![0]!["src"]!.GetValue<string>());
    }

    [Fact]
    public async Task Only_jpeg_or_png_images_are_accepted()
    {
        var crew = await CrewAsync();
        using var text = new StringContent("not an image");
        var r = await crew.PostAsync($"/api/images?cad={Cad(903)}", text);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, r.StatusCode);
    }

    [Fact]
    public async Task The_live_stream_starts_with_init_cfg_and_cases()
    {
        var er = await DeviceAsync("er");
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var response = await er.GetAsync("/api/stream?role=er", HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType!.MediaType);
        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cts.Token));
        var events = new List<string>();
        while (events.Count < 3)
        {
            var line = await reader.ReadLineAsync(cts.Token);
            if (line is null) break;
            if (line.StartsWith("event: ")) events.Add(line[7..]);
        }
        Assert.Equal(["init", "cfg", "cases"], events);
    }

    [Fact]
    public async Task Bad_json_is_refused()
    {
        var crew = await CrewAsync();
        using var bad = new StringContent("{not json", System.Text.Encoding.UTF8, "application/json");
        var r = await crew.PostAsync("/api/cases/complete", bad);
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Bad JSON", (await Json(r))["error"]!.GetValue<string>());
    }
}
