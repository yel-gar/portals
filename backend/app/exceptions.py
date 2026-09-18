class BadAction(Exception):
    """Raised by portal action methods when an action cannot be committed.

    Message is a human-readable Russian description of the problem; the route
    layer maps it to HTTP 409 Conflict.
    """
