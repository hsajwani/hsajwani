using Masar.Application.Cases;
using Masar.Application.Monitoring;
using Masar.Domain.Pathway;

namespace Masar.UnitTests.Application;

/// <summary>The STEMI pathway end to end through the application services, enforced on the server.</summary>
public class PathwayServiceTests
{
    [Fact]
    public void The_complete_pathway_crew_to_er_to_cardiologist_to_completed()
    {
        using var p = new TestPlatform();
        const string cad = "20261020-0101-1";
        p.SendWithFallbackEcg(cad);
        Assert.Equal(PathwayStates.SentToEr, p.Record(cad).State);

        Assert.True(p.Op(TestPlatform.Er, cad, "er_accept", new { name = "  Dr. Test ER " }).Ok);
        Assert.Equal("Dr. Test ER", p.Record(cad).Er.Name);
        p.See(TestPlatform.Er, cad, 1);
        Assert.True(p.Op(TestPlatform.Er, cad, "er_assess", new { kind = "activate", on = 1, name = "Dr. Test ER" }).Ok);
        Assert.Equal(PathwayStates.CardiologyActivated, p.Record(cad).State);

        Assert.True(p.Op(TestPlatform.Cardiologist, cad, "ack", new { name = "Dr. Test Cardiology" }).Ok);
        p.See(TestPlatform.Cardiologist, cad, 1);
        Assert.True(p.Op(TestPlatform.Cardiologist, cad, "decision", new { k = "confirm", on = 1, name = "Dr. Test Cardiology" }).Ok);
        Assert.Equal(PathwayStates.Confirmed, p.Record(cad).State);

        var crew = p.Crew;
        Assert.Equal("completed", p.Gate.Run(db => p.Get<CaseService>().Complete(db, crew, cad)).Status);
        var closed = p.Record(cad);
        Assert.Equal(PathwayStates.Completed, closed.State);
        Assert.Equal("STEMI pathway completed", closed.Closed!.Reason);

        var audit = p.Audit(cad);
        Assert.Contains(audit, a => a.StartsWith("Case sent to the ER by Ambulance 214"));
        Assert.Contains("ER Doctor assessment: ACTIVATE CARDIOLOGIST — Dr. Test ER · on ECG 1", audit);
        Assert.Contains(audit, a => a.StartsWith("Cardiologist decision: CONFIRMED STEMI — Dr. Test Cardiology · on ECG 1"));
        Assert.Contains(audit, a => a.StartsWith("STEMI pathway completed and closed by K. Ahmed, Paramedic (Ambulance 214)"));
    }

    [Fact]
    public void A_closed_case_refuses_every_change_on_the_server()
    {
        using var p = new TestPlatform();
        const string cad = "20261020-0102-1";
        p.SendWithFallbackEcg(cad);
        p.Op(TestPlatform.Er, cad, "er_accept", new { name = "Dr. Test ER" });
        p.See(TestPlatform.Er, cad, 1);
        Assert.True(p.Op(TestPlatform.Er, cad, "er_assess", new { kind = "not_suspicious", reason = "criteria", on = 1 }).Ok);
        Assert.Equal(PathwayStates.ErClosed, p.Record(cad).State);
        var before = p.Audit(cad).Count;

        foreach (var (actor, kind, data) in new (Masar.Application.Common.Actor, string, object)[]
        {
            (p.Crew, "md", new { k = "age", v = "61 y" }),
            (p.Crew, "rec", new { k = "asp", label = "Aspirin", v = "Given" }),
            (TestPlatform.Er, "er_assess", new { kind = "activate", on = 1, name = "Dr. Test ER" }),
            (TestPlatform.Cardiologist, "ack", new { name = "Dr. X" }),
        })
        {
            var r = p.Op(actor, cad, kind, data);
            Assert.False(r.Ok);
            Assert.Equal(409, r.Status);
        }
        Assert.Equal(before, p.Audit(cad).Count);
        var crew = p.Crew;
        Assert.Equal("closed", p.Gate.Run(db => p.Get<CaseService>().Complete(db, crew, cad)).Status);
    }

    [Fact]
    public void Not_suspicious_needs_a_reason_and_closes_without_activating_cardiology()
    {
        using var p = new TestPlatform();
        const string cad = "20261020-0103-1";
        p.SendWithFallbackEcg(cad);
        p.Op(TestPlatform.Er, cad, "er_accept", new { name = "Dr. Test ER" });
        p.See(TestPlatform.Er, cad, 1);
        var refused = p.Op(TestPlatform.Er, cad, "er_assess", new { kind = "not_suspicious", on = 1 });
        Assert.Equal(400, refused.Status);
        Assert.Equal("Select the reason why cardiology is not activated.", refused.Error);
        Assert.True(p.Op(TestPlatform.Er, cad, "er_assess", new { kind = "not_suspicious", reason = "other", comment = " Test explanation ", on = 1 }).Ok);
        var r = p.Record(cad);
        Assert.Equal("OTHER", r.Er.Reason);
        Assert.Equal("Test explanation", r.Er.Comment);
        Assert.Null(r.Cardio.Activated);
        Assert.Equal("ER Doctor screening decision", r.Closed!.Source);
    }

    [Fact]
    public void A_decision_must_cover_the_latest_ecg_and_not_stemi_closes_the_pathway()
    {
        using var p = new TestPlatform();
        const string cad = "20261020-0104-1";
        p.SendWithFallbackEcg(cad);
        p.Op(TestPlatform.Er, cad, "er_accept", new { name = "Dr. Test ER" });
        p.See(TestPlatform.Er, cad, 1);
        p.Op(TestPlatform.Er, cad, "er_assess", new { kind = "uncertain", on = 1 });
        p.Op(TestPlatform.Cardiologist, cad, "ack", new { name = "Dr. Test Cardiology" });
        p.See(TestPlatform.Cardiologist, cad, 1);

        var older = p.Op(TestPlatform.Cardiologist, cad, "decision", new { k = "confirm", on = 2 });
        Assert.Equal(409, older.Status);
        Assert.Equal("NOT STEMI needs a reason.", p.Op(TestPlatform.Cardiologist, cad, "decision", new { k = "not", on = 1 }).Error);
        Assert.True(p.Op(TestPlatform.Cardiologist, cad, "decision", new { k = "not", on = 1, reason = "Old changes" }).Ok);
        var r = p.Record(cad);
        Assert.Equal(PathwayStates.NotStemiClosed, r.State);
        Assert.Equal("automatic following Cardiologist decision", r.Closed!.Source);
    }

    [Fact]
    public void A_resent_action_is_stored_once()
    {
        using var p = new TestPlatform();
        const string cad = "20261020-0105-1";
        p.SendWithFallbackEcg(cad);
        Assert.True(p.Op(TestPlatform.Er, cad, "er_accept", new { name = "Dr. Test ER" }, id: "same-id").Ok);
        var again = p.Op(TestPlatform.Er, cad, "er_accept", new { name = "Dr. Someone Else" }, id: "same-id");
        Assert.True(again.Ok);
        Assert.True(again.Dup);
        Assert.Equal("Dr. Test ER", p.Record(cad).Er.Name);
    }

    [Fact]
    public void One_case_per_cad_number()
    {
        using var p = new TestPlatform();
        var crew = p.Crew;
        var cases = p.Get<CaseService>();
        Assert.Equal("created", p.Gate.Run(db => cases.Create(db, crew, TestPlatform.Json(new { cad = "cad # 20261020-0106-1", cid = "a" }))).Status);
        Assert.Equal("same", p.Gate.Run(db => cases.Create(db, crew, TestPlatform.Json(new { cad = "20261020-0106-1", cid = "a" }))).Status);
        Assert.Equal("exists", p.Gate.Run(db => cases.Create(db, crew, TestPlatform.Json(new { cad = "20261020-0106-1", cid = "b" }))).Status);
        Assert.Equal("invalid", p.Gate.Run(db => cases.Create(db, crew, TestPlatform.Json(new { cad = "123" }))).Status);
    }

    [Fact]
    public void The_cad_number_of_an_unsent_case_can_be_corrected_and_is_locked_once_sent()
    {
        using var p = new TestPlatform();
        var crew = p.Crew;
        var cases = p.Get<CaseService>();
        p.Gate.Run(db => cases.Create(db, crew, TestPlatform.Json(new { cad = "20261020-0107-1", cid = "a" })));
        var corrected = p.Gate.Run(db => cases.Correct(db, crew, TestPlatform.Json(new { cad = "20261020-0107-1", to = "20261020-0108-1" })));
        Assert.Equal("corrected", corrected.Status);
        Assert.Equal("20261020-0108-1", corrected.Rec!.Cad);
        Assert.Contains(p.Audit("20261020-0108-1"), a => a.StartsWith("CAD number corrected by crew before sending: CAD #20261020-0107-1 → CAD #20261020-0108-1"));

        p.SendWithFallbackEcg("20261020-0109-1");
        var locked = p.Gate.Run(db => cases.Correct(db, crew, TestPlatform.Json(new { cad = "20261020-0109-1", to = "20261020-0110-1" })));
        Assert.Equal("sent", locked.Status);
    }

    [Fact]
    public void Ecgs_from_the_simulated_corpuls_feed_are_numbered_and_stored_once()
    {
        using var p = new TestPlatform();
        var crew = p.Crew;
        const string cad = "20261020-0111-1";
        p.Gate.Run(db => p.Get<CaseService>().Create(db, crew, TestPlatform.Json(new { cad, cid = "a", link = true })));
        var monitor = p.Get<MonitorService>();
        var none = new Dictionary<string, string?>();
        Assert.True(p.Gate.Run(db => monitor.Simulate(db, cad, "connect", new SimParams(null, null, none))).Ok);
        var first = p.Gate.Run(db => monitor.Simulate(db, cad, "trigger-ecg", new SimParams("A", null, none)));
        Assert.True(first.Ok);
        Assert.Equal(1, first.N);
        var r = p.Record(cad);
        Assert.Equal("corpuls", r.Ecgs.Single().Src);
        Assert.Equal("connected", r.Monitor!.Status);
        Assert.True(r.Monitor.Simulated);
        Assert.NotNull(r.Monitor.V);
        Assert.Contains(p.Audit(cad), a => a.StartsWith("ECG 1 received from corpuls"));

        // a discarded (unsent) case ends its feed: data that arrives later is refused
        p.Gate.Run(db => p.Get<CaseService>().Discard(db, crew, cad));
        var late = p.Gate.Run(db => monitor.Simulate(db, cad, "trigger-ecg", new SimParams("B", null, none)));
        Assert.False(late.Ok);
        Assert.Single(p.Record(cad).Ecgs);
    }

    [Fact]
    public void An_assessment_or_decision_needs_the_latest_ecg_opened_by_that_role()
    {
        using var p = new TestPlatform();
        const string cad = "20261020-0112-1";
        p.SendWithFallbackEcg(cad);
        p.Op(TestPlatform.Er, cad, "er_accept", new { name = "Dr. Test ER" });
        var unseen = p.Op(TestPlatform.Er, cad, "er_assess", new { kind = "activate", on = 1 });
        Assert.False(unseen.Ok);
        Assert.Equal(409, unseen.Status);
        Assert.Equal("View ECG 1 before recording the assessment.", unseen.Error);
        Assert.Equal(PathwayStates.ErReviewing, p.Record(cad).State);

        p.See(TestPlatform.Er, cad, 1);
        Assert.True(p.Op(TestPlatform.Er, cad, "er_assess", new { kind = "activate", on = 1 }).Ok);
        p.Op(TestPlatform.Cardiologist, cad, "ack", new { name = "Dr. Test Cardiology" });

        // the ER Doctor's view does not count for the Cardiologist
        var undecided = p.Op(TestPlatform.Cardiologist, cad, "decision", new { k = "confirm", on = 1 });
        Assert.Equal(409, undecided.Status);
        Assert.Equal("View ECG 1 before deciding.", undecided.Error);
        p.See(TestPlatform.Cardiologist, cad, 1);
        Assert.True(p.Op(TestPlatform.Cardiologist, cad, "decision", new { k = "confirm", on = 1 }).Ok);
    }

    [Theory]
    [InlineData("age", "Enter the age (or an estimate), or choose Unknown.")]
    [InlineData("sex", "Choose the sex, or Unknown.")]
    [InlineData("complaint", "Choose the presenting complaint (or the reason for the ECG).")]
    [InlineData("onset", "Enter the symptom onset time, or choose Unknown.")]
    public void Send_is_refused_by_the_server_without_the_four_items(string missing, string message)
    {
        using var p = new TestPlatform();
        const string cad = "20261020-0113-1";
        var crew = p.Crew;
        p.Gate.Run(db => p.Get<CaseService>().Create(db, crew, TestPlatform.Json(new { cad, cid = "a" })));
        var image = p.Gate.Run(db => p.Get<EcgImageService>().Store(db, cad, EcgImageService.Jpeg, [0xFF, 0xD8, 0xFF, 0xD9], crew.CrewTitle, "file"));
        var now = TestPlatform.Now;
        var md = System.Text.Json.Nodes.JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(TestPlatform.MinimumData(now)))!.AsObject();
        md[missing] = new System.Text.Json.Nodes.JsonObject { ["v"] = "", ["t"] = now }; // what the tablet sends for an unanswered item
        var r = p.Op(crew, cad, "submit", new
        {
            sendAt = now, md,
            ecg = new { n = 1, acq = now - 1000, pri = 1, imgs = new[] { new { i = 1, kind = "full", q = "file", at = now - 1000, imageId = image.Id } } },
        });
        Assert.False(r.Ok);
        Assert.Equal(400, r.Status);
        Assert.Equal(message, r.Error);
        Assert.Equal(PathwayStates.Draft, p.Record(cad).State);
        Assert.Empty(p.Record(cad).Ecgs); // nothing of the refused SEND was kept
    }
}
