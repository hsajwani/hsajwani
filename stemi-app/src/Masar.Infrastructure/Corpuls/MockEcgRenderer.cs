using System.Globalization;
using System.Text;

namespace Masar.Infrastructure.Corpuls;

/// <summary>An internal test sample of the simulated feed (ECG Sample A / B / C) and the waveform variant it draws.</summary>
public sealed record EcgSample(string Key, string Label, string Variant);

/// <summary>
/// The image of one simulated 12-lead acquisition. Rate: the heart rate it is drawn at. Nominal: the rate the sample was
/// scripted at (used only when no heart rate is known).
/// </summary>
public sealed record RenderedEcg(string Sample, string Label, string Variant, int Rate, int Nominal, string Mime, byte[] Data);

/// <summary>
/// Synthetic 12-lead ECGs for the simulated corpuls feed (MockCorpulsProvider). FICTIONAL, NOT A PATIENT ECG —
/// PROTOTYPE ONLY (simulated test data). Drawn as an SVG (a digital transmission, not a photo of a printout): 3 × 4 leads
/// and a lead II rhythm strip at 25 mm/s and 10 mm/mV, on ECG paper, marked as simulated test data. The waveform model is
/// the one of the crew's fictional test ECG generator (public/shared/ecg.js), so every test ECG in the build looks alike.
/// The samples are labelled internally (ECG Sample A / B / C) and are not a validated diagnosis of anything: they only
/// give the scripted mock AI something to describe.
/// Same drawing as the Node.js prototype (server/integrations/corpuls/mock-ecg.js): JavaScript's rounding and number
/// text are reproduced, so both produce the same SVG for the same input.
/// </summary>
public static class MockEcgRenderer
{
    public const string Mime = "image/svg+xml";

    /// <summary>The internal test samples and the waveform variant each draws (the mock AI's scripted findings follow the variant).</summary>
    public static readonly IReadOnlyDictionary<string, EcgSample> Samples = new Dictionary<string, EcgSample>
    {
        ["A"] = new("A", "ECG Sample A", "border"),
        ["B"] = new("B", "ECG Sample B", "evolved"),
        ["C"] = new("C", "ECG Sample C", "clear"),
    };

    private const int W = 2160, H = 1180, Px = 8, X0 = 110, Sps = 25 * Px, Mv = 10 * Px, GridTop = 100, GridBottom = 1128;
    private const double Step = 0.004;
    private static readonly int[] Rows = [292, 542, 792, 1042];
    private static readonly string[][] Layout = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];
    private static readonly string[] Months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

    /// <summary>The amplitude (mV) of each wave of a normal beat, per lead.</summary>
    private sealed record LeadShape(double P, double Q, double R, double S, double T);

    /// <summary>A variant: its own heart rate, the ST shift per lead and the T waves it changes.</summary>
    private sealed record WaveVariant(int Hr, IReadOnlyDictionary<string, double> St, IReadOnlyDictionary<string, double>? T);

    private sealed record LeadParams(double P, double Q, double R, double S, double T, double St);

    private static readonly IReadOnlyDictionary<string, LeadShape> Base = new Dictionary<string, LeadShape>
    {
        ["I"] = new(.10, -.04, .70, -.10, .26), ["II"] = new(.15, -.05, 1.05, -.18, .16), ["III"] = new(.06, -.03, .45, -.24, .02),
        ["aVR"] = new(-.12, .03, -.78, .10, -.22), ["aVL"] = new(.03, -.05, .46, -.26, .20), ["aVF"] = new(.10, -.04, .74, -.21, .06),
        ["V1"] = new(.07, 0, .20, -.95, .14), ["V2"] = new(.08, 0, .38, -1.12, .52), ["V3"] = new(.08, 0, .60, -.78, .60),
        ["V4"] = new(.08, -.03, .95, -.48, .56), ["V5"] = new(.08, -.05, 1.12, -.27, .42), ["V6"] = new(.08, -.06, .94, -.14, .28),
    };

    private static readonly IReadOnlyDictionary<string, WaveVariant> Variants = new Dictionary<string, WaveVariant>
    {
        ["clear"] = new(84, Leads(.10, -.11, -.17, 0, .12, -.15, .12, .30, .40, .34, .21, .06), null),
        ["border"] = new(84, Leads(.03, -.02, -.03, 0, .04, -.02, .04, .10, .12, .12, .04, .01), TWaves(.64, .74, .68)),
        ["evolved"] = new(92, Leads(.06, -.05, -.12, 0, .07, -.10, .05, .14, .32, .30, .12, .03), TWaves(.60, .70, .64)),
        ["clear2"] = new(88, Leads(.11, -.12, -.18, 0, .13, -.16, .12, .32, .42, .36, .22, .07), null),
    };

    private static Dictionary<string, double> Leads(params double[] st)
    {
        string[] names = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
        return names.Select((n, i) => (n, v: st[i])).ToDictionary(x => x.n, x => x.v);
    }

    private static Dictionary<string, double> TWaves(double v2, double v3, double v4) => new() { ["V2"] = v2, ["V3"] = v3, ["V4"] = v4 };

    /// <summary>Sample C after an earlier ECG in the same case uses the variant scripted for a later ECG.</summary>
    public static string VariantOf(string? sample, int n) =>
        sample == "C" && n > 1 ? "clear2" : (sample is not null && Samples.TryGetValue(sample, out var s) ? s : Samples["A"]).Variant;

    /// <summary>
    /// The image of one simulated acquisition. hr: the simulated monitor's heart rate at that moment, so the 12-lead and
    /// the live HR agree (the sample's own rate when not known). An unknown sample draws Sample A.
    /// </summary>
    public static RenderedEcg SampleEcg(string? sample, int n, long acquiredAt, int? hr)
    {
        var key = sample is not null && Samples.ContainsKey(sample) ? sample : "A";
        var variant = VariantOf(key, n);
        var nominal = ShapeOf(variant).Hr;
        var rate = RateOf(hr, nominal);
        return new RenderedEcg(key, Samples[key].Label, variant, rate, nominal, Mime, Encoding.UTF8.GetBytes(Render(variant, acquiredAt, rate)));
    }

    /// <summary>
    /// The SVG text. hr: the heart rate the monitor measured at acquisition (the variant's own rate when not given); the
    /// variant decides the morphology only. An unknown variant draws "border".
    /// </summary>
    public static string Render(string? variant, long acquiredAt, int? hr)
    {
        var shape = ShapeOf(variant);
        var rate = RateOf(hr, shape.Hr);
        var rr = 60.0 / rate;
        // the beat-to-beat spacing varies slightly in a fixed pattern set by the acquisition time (never random)
        var onsets = new List<double>();
        var k = 0;
        for (var t = 0.16; t < 10.8; k++)
        {
            onsets.Add(t);
            t += rr + Math.Sin(k * 1.7 + acquiredAt % 7) * 0.012;
        }

        LeadParams Lead(string ld)
        {
            var b = Base[ld];
            var t = shape.T is not null && shape.T.TryGetValue(ld, out var tv) ? tv : b.T;
            return new LeadParams(b.P, b.Q, b.R, b.S, t, shape.St.TryGetValue(ld, out var st) ? st : 0);
        }

        // a monitor's digital ECG: little baseline wander or noise
        double Volt(string ld, double t, LeadParams p)
        {
            var s = 0.0;
            foreach (var o in onsets)
            {
                var d = t - o;
                if (d > -0.1 && d < 0.8) s += Beat(d, p);
            }
            return s + 0.012 * Math.Sin(2 * Math.PI * 0.23 * t + ld.Length) + 0.003 * Math.Sin(t * 913.7 + ld.Length * 7.1) * Math.Sin(t * 377.3);
        }

        // a trace as an SVG path: the first point absolute, then relative steps in tenths of a pixel
        string Trace(string ld, double t1, double t2, int y)
        {
            var p = Lead(ld);
            var n = (long)JsRound((t2 - t1) / Step);
            var d = new StringBuilder("<path d=\"");
            long px = 0, py = 0;
            for (var i = 0; i <= n; i++)
            {
                var t = t1 + i * Step;
                var x = (long)JsRound((X0 + t * Sps) * 10);
                var yy = (long)JsRound((y - Volt(ld, t, p) * Mv) * 10);
                if (i == 0)
                {
                    d.Append('M').Append(Num(x / 10.0)).Append(' ').Append(Num(yy / 10.0));
                }
                else
                {
                    var dy = Tenth(yy - py);
                    d.Append('l').Append(Tenth(x - px)).Append(dy.StartsWith('-') ? string.Empty : " ").Append(dy);
                }
                px = x;
                py = yy;
            }
            return d.Append("\"/>").ToString();
        }

        static string Cal(int y) => Inv($"<path d=\"M34 {y}H50V{y - Mv}H90V{y}H{X0}\"/>");
        static string Label(string ld, double t1, int y) => Inv($"<text x=\"{Num(X0 + t1 * Sps + 12)}\" y=\"{y - 92}\">{ld}</text>");

        var traces = new StringBuilder();
        var labels = new StringBuilder();
        for (var r = 0; r < 3; r++)
        {
            traces.Append(Cal(Rows[r]));
            for (var c = 0; c < 4; c++)
            {
                var ld = Layout[r][c];
                var t1 = c * 2.5;
                traces.Append(Trace(ld, t1, t1 + 2.5, Rows[r]));
                labels.Append(Label(ld, t1, Rows[r]));
                if (c > 0) traces.Append(Inv($"<path d=\"M{Num(X0 + t1 * Sps)} {Rows[r] - 20}V{Rows[r] + 20}\"/>"));
            }
        }
        traces.Append(Cal(Rows[3])).Append(Trace("II", 0, 10, Rows[3]));
        labels.Append(Label("II", 0, Rows[3]));

        // explicit "\n" line breaks: the same bytes on every platform, whatever line endings this file is checked out with
        return string.Join('\n',
            Inv($"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{W}\" height=\"{H}\" viewBox=\"0 0 {W} {H}\" role=\"img\" aria-label=\"Fictional simulated 12-lead ECG\">"),
            "<defs><pattern id=\"s\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\"><path d=\"M8 0H0V8\" fill=\"none\" stroke=\"#efb2aa\" stroke-width=\"1\"/></pattern>",
            "<pattern id=\"b\" width=\"40\" height=\"40\" patternUnits=\"userSpaceOnUse\"><rect width=\"40\" height=\"40\" fill=\"url(#s)\"/><path d=\"M40 0H0V40\" fill=\"none\" stroke=\"#dc7d74\" stroke-width=\"1.6\"/></pattern></defs>",
            Inv($"<rect width=\"{W}\" height=\"{H}\" fill=\"#ffffff\"/><rect y=\"{GridTop}\" width=\"{W}\" height=\"{GridBottom - GridTop}\" fill=\"#fff7f5\"/><rect y=\"{GridTop}\" width=\"{W}\" height=\"{GridBottom - GridTop}\" fill=\"url(#b)\"/>"),
            "<g font-family=\"'Courier New',Courier,monospace\" fill=\"#1b1b1b\">",
            Inv($"<text x=\"40\" y=\"42\" font-size=\"26\" font-weight=\"700\">12-LEAD ECG · SIMULATED MONITOR TRANSMISSION</text><text x=\"{W - 40}\" y=\"42\" font-size=\"24\" font-weight=\"700\" text-anchor=\"end\" fill=\"#9a2a1f\">FICTIONAL TEST DATA · NOT A PATIENT</text>"),
            Inv($"<text x=\"40\" y=\"82\" font-size=\"28\" font-weight=\"700\">{Stamp(acquiredAt)}</text><text x=\"640\" y=\"82\" font-size=\"28\" font-weight=\"700\">HR {rate} /min</text><text x=\"{W - 40}\" y=\"82\" font-size=\"24\" font-weight=\"600\" text-anchor=\"end\">25 mm/s   10 mm/mV   0.05-150 Hz</text>"),
            $"<g font-size=\"32\" font-weight=\"700\">{labels}</g>",
            Inv($"<text x=\"40\" y=\"{H - 18}\" font-size=\"22\" fill=\"#5d6b7e\">Simulated corpuls feed · STEMI Coordination Platform test build · synthetic waveform, not a diagnosis</text></g>"),
            $"<g fill=\"none\" stroke=\"#151515\" stroke-width=\"2.6\" stroke-linejoin=\"round\" stroke-linecap=\"round\">{traces}</g>",
            "</svg>");
    }

    private static WaveVariant ShapeOf(string? variant) =>
        variant is not null && Variants.TryGetValue(variant, out var v) ? v : Variants["border"];

    /// <summary>The drawing stays readable from 40 to 150 /min.</summary>
    private static int RateOf(int? hr, int fallback) => hr is { } h ? Math.Clamp(h, 40, 150) : fallback;

    private static double Sig(double x) => 1 / (1 + Math.Exp(-x));

    /// <summary>One beat (P, QRS, ST, T) at time d seconds after its onset, in mV.</summary>
    private static double Beat(double d, LeadParams p)
    {
        double G(double m, double s, double a)
        {
            var q = (d - m) / s;
            return a * Math.Exp(-0.5 * (q * q));
        }
        var v = G(0.085, 0.024, p.P) + G(0.178, 0.0085, p.Q) + G(0.2, 0.0115, p.R) + G(0.226, 0.0105, p.S);
        var w = (d - 0.45) / (d < 0.45 ? 0.062 : 0.042);
        v += p.T * Math.Exp(-0.5 * (w * w));
        v += p.St * Sig((d - 0.242) / 0.006) * Sig((0.47 - d) / 0.028);
        return v;
    }

    /// <summary>JavaScript's Math.round: halves round up (towards +∞), unlike .NET's default banker's rounding.</summary>
    private static double JsRound(double v)
    {
        var f = Math.Floor(v);
        return v - f >= 0.5 ? f + 1 : f;
    }

    /// <summary>A number as JavaScript writes it (shortest round-trip text; the values here never need an exponent).</summary>
    private static string Num(double v) => v.ToString("R", CultureInfo.InvariantCulture);

    /// <summary>A coordinate step in tenths of a pixel, written as short as SVG allows ("0.5" → ".5", "-0.3" → "-.3").</summary>
    private static string Tenth(long n)
    {
        var s = Num(n / 10.0);
        if (s.StartsWith("0.", StringComparison.Ordinal)) return s[1..];
        if (s.StartsWith("-0.", StringComparison.Ordinal)) return "-" + s[2..];
        return s;
    }

    /// <summary>The acquisition time printed on the ECG, in the server's local time (as the monitor prints it).</summary>
    private static string Stamp(long ms)
    {
        var d = DateTimeOffset.FromUnixTimeMilliseconds(ms).ToLocalTime();
        return Inv($"{d.Day:00}-{Months[d.Month - 1]}-{d.Year}  {d.Hour:00}:{d.Minute:00}:{d.Second:00}");
    }

    private static string Inv(FormattableString s) => s.ToString(CultureInfo.InvariantCulture);
}
