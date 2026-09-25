from mcp.server import MCPServer

from app.mcp.tools.student import get_student_context
from app.mcp.tools.learner import (
    get_academic_context,
    get_user_goals,
    get_selected_subjects,
)


mcp = MCPServer(
    "SmartLearn MCP Server"
)


@mcp.tool()
def student_context(user_id: str) -> dict:
    """
    Get a student's basic profile and onboarding progress.

    Use this when an AI workflow needs to understand
    the student's identity and onboarding state.
    """
    return get_student_context(user_id)


@mcp.tool()
def academic_context(user_id: str) -> dict:
    """
    Get a student's academic information.
    """
    return get_academic_context(user_id)


@mcp.tool()
def user_goals(user_id: str) -> dict:
    """
    Get a student's learning goals.
    """
    return get_user_goals(user_id)


@mcp.tool()
def selected_subjects(user_id: str) -> dict:
    """
    Get subjects selected by the student.
    """
    return get_selected_subjects(user_id)


if __name__ == "__main__":
    mcp.run(
        transport="streamable-http",
        host="127.0.0.1",
        port=8001,
    )