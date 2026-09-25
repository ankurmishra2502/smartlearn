from app.mcp.client import call_mcp_tool


async def load_learner_context(user_id: str) -> dict:
    """
    Load the learner context required by the AI workflow.
    """

    student = await call_mcp_tool(
        "student_context",
        {
            "user_id": user_id,
        },
    )

    academic = await call_mcp_tool(
        "academic_context",
        {
            "user_id": user_id,
        },
    )

    goals = await call_mcp_tool(
        "user_goals",
        {
            "user_id": user_id,
        },
    )

    subjects = await call_mcp_tool(
        "selected_subjects",
        {
            "user_id": user_id,
        },
    )

    return {
        "student": student,
        "academic": academic,
        "goals": goals,
        "subjects": subjects,
    }