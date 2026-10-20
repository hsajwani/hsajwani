namespace Masar.Application.Common;

/// <summary>A refused action: the message is shown to the user, the status is the HTTP status the API answers with.</summary>
public sealed class ActionException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}
