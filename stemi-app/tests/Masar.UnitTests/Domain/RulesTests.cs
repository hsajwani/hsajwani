using Masar.Domain.Rules;

namespace Masar.UnitTests.Domain;

public class CadNumberTests
{
    [Theory]
    [InlineData("20261004-0123-1", "20261004-0123-1")]
    [InlineData("CAD#20261004-0123-1", "20261004-0123-1")]
    [InlineData("cad # 20261004-0123-1", "20261004-0123-1")]
    [InlineData(" 20261004-0123-1 ", "20261004-0123-1")]
    [InlineData("2026100401231", "20261004-0123-1")]
    [InlineData("#20261004–0123–1", "20261004-0123-1")]
    public void Typed_forms_normalise_to_the_canonical_cad_number(string typed, string canonical)
    {
        var r = CadNumber.Check(typed);
        Assert.True(r.Ok);
        Assert.Equal(canonical, r.Cad);
        Assert.Equal("CAD #" + canonical, CadNumber.Display(r.Cad));
    }

    [Theory]
    [InlineData("", "The CAD number is empty.")]
    [InlineData("1234", "Incomplete or not a CAD number. Expected format: 20261004-0123-1")]
    [InlineData("20261304-0123-1", "The date part 20261304 is not a valid date. Expected format: 20261004-0123-1")]
    [InlineData("20261000-0123-1", "The date part 20261000 is not a valid date. Expected format: 20261004-0123-1")]
    public void Invalid_cad_numbers_are_refused_with_the_reason(string typed, string detail)
    {
        var r = CadNumber.Check(typed);
        Assert.False(r.Ok);
        Assert.Equal(CadNumber.InvalidMessage, r.Error);
        Assert.Equal(detail, r.Detail);
    }
}

public class ClinicianNameTests
{
    [Theory]
    [InlineData("  Dr.   Test  ER ", "Dr. Test ER")]
    [InlineData("Dr\tX", "Dr X")]
    public void A_name_is_trimmed_and_collapsed(string typed, string name)
    {
        var r = ClinicianName.Clean(typed);
        Assert.True(r.Ok);
        Assert.Equal(name, r.Name);
    }

    [Theory]
    [InlineData(null, "Enter your name.")]
    [InlineData("   ", "Enter your name.")]
    [InlineData("A", "Enter your full name (at least 2 characters).")]
    [InlineData("12345", "Enter a name that contains letters.")]
    public void An_unusable_name_is_refused(string? typed, string error)
    {
        var r = ClinicianName.Clean(typed);
        Assert.False(r.Ok);
        Assert.Equal(error, r.Error);
    }

    [Fact]
    public void A_name_longer_than_80_characters_is_refused() =>
        Assert.Equal("The name is too long (at most 80 characters).", ClinicianName.Clean(new string('a', 81)).Error);
}

public class ErAssessmentRulesTests
{
    [Fact]
    public void Not_suspicious_needs_a_known_reason()
    {
        Assert.Equal("reason", ErAssessmentRules.CheckNotSuspicious(null, null).Field);
        Assert.Equal("reason", ErAssessmentRules.CheckNotSuspicious("unknown", "x").Field);
        var ok = ErAssessmentRules.CheckNotSuspicious("criteria", "  ");
        Assert.True(ok.Ok);
        Assert.Equal("ECG DOES NOT MEET STEMI CRITERIA", ok.ReasonLabel);
        Assert.Equal(string.Empty, ok.Comment);
    }

    [Fact]
    public void Other_needs_an_explanation()
    {
        var refused = ErAssessmentRules.CheckNotSuspicious("other", "");
        Assert.False(refused.Ok);
        Assert.Equal("comment", refused.Field);
        Assert.Equal("OTHER needs an explanation: describe the reason.", refused.Error);
        Assert.Equal("Test explanation", ErAssessmentRules.CheckNotSuspicious("other", "  Test explanation  ").Comment);
    }
}

public class TextRulesTests
{
    [Fact]
    public void Control_characters_are_removed_and_line_breaks_kept() => Assert.Equal("a\nb", TextRules.Clean(" a\u0007\nb "));

    [Fact]
    public void Text_is_limited_in_length() => Assert.Equal(10, TextRules.Clean(new string('x', 50), 10).Length);
}

public class MinimumDataRulesTests
{
    private static readonly long Now = 1_800_000_000_000;
    private static MinimumDataRules.Answer Unknown => new(true, null, null, null, null);

    [Fact]
    public void Unknown_is_an_answer() => Assert.Null(MinimumDataRules.CheckForSend(Unknown, Unknown, Unknown, Unknown, Now));

    [Theory]
    [InlineData(-1)]
    [InlineData(121)]
    [InlineData(58.5)]
    public void The_age_must_be_a_whole_number_from_0_to_120(double age) =>
        Assert.Equal("Age: a whole number from 0 to 120 years.", MinimumDataRules.CheckForSend(new(false, age, null, null, null), Unknown, Unknown, Unknown, Now));

    [Fact]
    public void Other_complaint_needs_a_description() =>
        Assert.Equal("Describe the presenting complaint.", MinimumDataRules.CheckForSend(Unknown, Unknown, new(false, null, "oth", "  ", null), Unknown, Now));

    [Fact]
    public void The_onset_cannot_be_in_the_future_beyond_the_clock_tolerance()
    {
        Assert.Null(MinimumDataRules.CheckForSend(Unknown, Unknown, Unknown, new(false, null, null, null, Now + 4 * 60_000), Now));
        Assert.Equal("The onset time cannot be in the future.", MinimumDataRules.CheckForSend(Unknown, Unknown, Unknown, new(false, null, null, null, Now + 6 * 60_000), Now));
    }
}
