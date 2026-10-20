using Masar.Application.Abstractions;
using Masar.Infrastructure.Ai;
using Masar.Infrastructure.Corpuls;
using Masar.Infrastructure.Persistence;

namespace Masar.UnitTests.Infrastructure;

/// <summary>The PROTOTYPE ONLY providers: scripted mock AI and the fictional ECG drawing.</summary>
public class MockProvidersTests
{
    private static readonly MockEcgAiProvider Ai = new(TimeSpan.Zero);

    private static AiAnalysisRequest Request(string quality = "good", string source = "file", string variant = "border", AiPreviousEcg? previous = null, bool unavailable = false) =>
        new("20261020-0001-1", new AiEcgInput(previous is null ? 1 : previous.N + 1, 1000, variant, false, 1, null, quality, source), previous, unavailable);

    [Theory]
    [InlineData("good", "ok")]
    [InlineData("glare", "lim")]
    [InlineData("cut", "wh")]
    public void The_status_follows_the_fictional_image_quality(string quality, string status) => Assert.Equal(status, Ai.Analyse(Request(quality)).Status);

    [Fact]
    public void An_unavailable_service_is_reported_as_down_never_as_a_finding()
    {
        var r = Ai.Analyse(Request(unavailable: true));
        Assert.Equal("down", r.Status);
        Assert.Null(r.Result["imp"]);
        Assert.Equal(MockEcgAiProvider.Version, r.Result["ver"]!.GetValue<string>());
    }

    [Fact]
    public void Every_result_says_it_is_simulated()
    {
        var r = Ai.Analyse(Request(source: "corpuls"));
        Assert.Contains("SIMULATED", r.Result["ver"]!.GetValue<string>());
        Assert.Contains("simulated corpuls", r.Result["q"]!.GetValue<string>());
    }

    [Fact]
    public void A_serial_comparison_needs_an_analysis_of_the_previous_ecg()
    {
        var none = Ai.Analyse(Request(variant: "evolved", previous: new AiPreviousEcg(1, 500, null)));
        Assert.Equal("Cannot compare", none.Result["ser"]!["h"]!.GetValue<string>());
        var evolved = Ai.Analyse(Request(variant: "evolved", previous: new AiPreviousEcg(1, 500, "ok")));
        Assert.Equal("Dynamic change detected", evolved.Result["ser"]!["h"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("A", 1, "border")]
    [InlineData("B", 2, "evolved")]
    [InlineData("C", 1, "clear")]
    [InlineData("C", 3, "clear2")]
    [InlineData("?", 1, "border")]
    public void Ecg_samples_map_to_their_test_patterns(string sample, int n, string variant) => Assert.Equal(variant, MockEcgRenderer.SampleEcg(sample, n, 1_000_000, null).Variant);

    [Fact]
    public void The_drawn_ecg_is_marked_fictional_and_drawn_at_the_monitor_heart_rate()
    {
        var ecg = MockEcgRenderer.SampleEcg("A", 1, 1_792_000_000_000, 300);
        Assert.Equal(150, ecg.Rate); // the drawing stays readable from 40 to 150 /min
        Assert.Equal("image/svg+xml", ecg.Mime);
        var svg = System.Text.Encoding.UTF8.GetString(ecg.Data);
        Assert.Contains("FICTIONAL TEST DATA · NOT A PATIENT", svg);
        Assert.Contains("HR 150 /min", svg);
        Assert.Equal(svg, MockEcgRenderer.Render("border", 1_792_000_000_000, 150)); // deterministic: never random
    }

    [Theory]
    [InlineData("ErAlertShownAt", "er_alert_shown_at")]
    [InlineData("Spo2", "spo2")]
    [InlineData("EcgN", "ecg_n")]
    [InlineData("Sha256", "sha256")]
    [InlineData("I", "i")]
    public void Properties_map_to_the_prototype_snake_case_columns(string property, string column) => Assert.Equal(column, MasarDbContext.SnakeCase(property));
}
