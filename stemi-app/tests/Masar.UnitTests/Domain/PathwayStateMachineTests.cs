using Masar.Domain.Entities;
using Masar.Domain.Pathway;

namespace Masar.UnitTests.Domain;

/// <summary>The STEMI pathway state machine: derived states and the server-side rules for every role.</summary>
public class PathwayStateMachineTests
{
    private static CaseFacts Facts(Action<Case>? change = null, CardiologistAlert? alert = null, Decision? decision = null, int ecgs = 1)
    {
        var c = new Case { Cad = "20261020-0001-1", Unit = "Ambulance 214", Emirate = "RAK", CrewName = "K. Ahmed, Paramedic", IncidentType = "STEMI pathway", CreatedAt = 1 };
        change?.Invoke(c);
        return CaseFacts.From(c, alert, decision, ecgs);
    }

    private static readonly Action<Case> Sent = c => c.ServerReceivedAt = 10;
    private static readonly Action<Case> Accepted = c => { c.ServerReceivedAt = 10; c.ErAcceptedAt = 20; };
    private static readonly Action<Case> Activated = c => { Accepted(c); c.CardiologyActivatedAt = 30; };
    private static readonly Action<Case> Acknowledged = c => { Activated(c); c.CardiologistAcknowledgedAt = 40; };

    private static Decision Decided(string kind, int on) => new() { Id = "x1", Cad = "c", Kind = kind, OnEcg = on, DecidedAt = 50, ReceivedAt = 50, DecidedBy = "Dr. Test" };

    [Fact]
    public void States_follow_the_pathway()
    {
        Assert.Equal(PathwayStates.Draft, Facts().State);
        Assert.Equal(PathwayStates.SentToEr, Facts(Sent).State);
        Assert.Equal(PathwayStates.ErReviewing, Facts(Accepted).State);
        Assert.Equal(PathwayStates.CardiologyActivated, Facts(Activated).State);
        Assert.Equal(PathwayStates.CardiologistReviewing, Facts(Acknowledged).State);
        Assert.Equal(PathwayStates.Confirmed, Facts(Acknowledged, decision: Decided("confirm", 1)).State);
        Assert.Equal(PathwayStates.CardiologistReviewing, Facts(Acknowledged, decision: Decided("not", 1)).State);
    }

    [Fact]
    public void A_repeat_request_stays_open_until_a_newer_ecg_arrives()
    {
        Assert.Equal(PathwayStates.RepeatRequested, Facts(Acknowledged, decision: Decided("repeat", 1), ecgs: 1).State);
        Assert.Equal(PathwayStates.RepeatReceived, Facts(Acknowledged, decision: Decided("repeat", 1), ecgs: 2).State);
    }

    [Theory]
    [InlineData("ER Doctor assessment: NOT SUSPICIOUS FOR STEMI", PathwayStates.ErClosed)]
    [InlineData("Cardiologist decision: NOT STEMI", PathwayStates.NotStemiClosed)]
    [InlineData("STEMI pathway completed", PathwayStates.Completed)]
    [InlineData(null, PathwayStates.Completed)]
    public void A_closed_case_is_closed_by_its_stored_reason(string? reason, string expected)
    {
        var f = Facts(c => { Acknowledged(c); c.ClosedAt = 60; c.ClosureReason = reason; });
        Assert.Equal(expected, f.State);
        Assert.True(PathwayStates.IsClosed(f.State));
    }

    [Fact]
    public void A_case_made_before_the_er_step_reads_as_already_activated()
    {
        var alert = new CardiologistAlert { Cad = "c", AlertedAt = 15, AcknowledgedAt = 25, Cardiologist = "x", Hospital = "y" };
        var f = Facts(Sent, alert);
        Assert.True(f.Legacy);
        Assert.Equal(15, f.Activated);
        Assert.Equal(25, f.Acknowledged);
        Assert.Equal(PathwayStates.CardiologistReviewing, f.State);
    }

    public static TheoryData<string, string> EveryRoleAndChangingAction => new()
    {
        { ActorRoles.Crew, "md" }, { ActorRoles.Crew, "ecg" }, { ActorRoles.Crew, "img" }, { ActorRoles.Crew, "rec" }, { ActorRoles.Crew, "note" },
        { ActorRoles.Crew, "submit" }, { ActorRoles.Er, "er_accept" }, { ActorRoles.Er, "er_assess" }, { ActorRoles.Er, "note" },
        { ActorRoles.Cardiologist, "ack" }, { ActorRoles.Cardiologist, "decision" }, { ActorRoles.Cardiologist, "note" },
    };

    [Theory]
    [MemberData(nameof(EveryRoleAndChangingAction))]
    public void A_closed_pathway_is_read_only_for_every_role(string role, string action)
    {
        var closed = Facts(c => { Acknowledged(c); c.ClosedAt = 60; c.ClosureReason = "STEMI pathway completed"; });
        Assert.Equal("This STEMI pathway is closed: it is read-only.", PathwayStateMachine.Guard(role, action, closed));
    }

    [Theory]
    [InlineData(ActorRoles.Crew, "decack")]
    [InlineData(ActorRoles.Crew, "hopen")]
    [InlineData(ActorRoles.Crew, "erack")]
    [InlineData(ActorRoles.Er, "viewed")]
    [InlineData(ActorRoles.Cardiologist, "viewed")]
    [InlineData(ActorRoles.Cardiologist, "compare")]
    public void Viewing_and_acknowledgements_are_still_recorded_on_a_closed_case(string role, string action)
    {
        var closed = Facts(c => { Acknowledged(c); c.ClosedAt = 60; });
        Assert.Null(PathwayStateMachine.Guard(role, action, closed));
    }

    [Fact]
    public void The_crew_cannot_add_to_an_unsent_draft()
    {
        Assert.Equal("Send the case before adding to it.", PathwayStateMachine.Guard(ActorRoles.Crew, "ecg", Facts()));
        Assert.Null(PathwayStateMachine.Guard(ActorRoles.Crew, "submit", Facts()));
    }

    [Fact]
    public void The_er_doctor_accepts_first_and_assesses_once()
    {
        Assert.Equal("This case has not been sent to the ER.", PathwayStateMachine.Guard(ActorRoles.Er, "er_accept", Facts()));
        Assert.Equal("Accept the case before recording the ER assessment.", PathwayStateMachine.Guard(ActorRoles.Er, "er_assess", Facts(Sent)));
        Assert.Null(PathwayStateMachine.Guard(ActorRoles.Er, "er_assess", Facts(Accepted)));
        Assert.Equal("The ER assessment for this case is already recorded.", PathwayStateMachine.Guard(ActorRoles.Er, "er_assess", Facts(Activated)));
    }

    [Fact]
    public void Nothing_reaches_the_cardiologist_before_the_er_doctor_activates_cardiology()
    {
        Assert.StartsWith("Cardiology has not been activated", PathwayStateMachine.Guard(ActorRoles.Cardiologist, "ack", Facts(Accepted)));
        Assert.Equal("Acknowledge the case before recording a decision.", PathwayStateMachine.Guard(ActorRoles.Cardiologist, "decision", Facts(Activated)));
        Assert.Null(PathwayStateMachine.Guard(ActorRoles.Cardiologist, "decision", Facts(Acknowledged)));
    }

    [Fact]
    public void The_test_console_records_no_clinical_action()
    {
        Assert.Equal("This is not an action for this screen.", PathwayStateMachine.Guard(ActorRoles.Control, "decision", Facts(Acknowledged)));
    }
}
