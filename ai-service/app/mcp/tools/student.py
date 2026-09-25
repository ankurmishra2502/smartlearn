from uuid import UUID

from app.mcp.db import db_pool


def get_student_context(user_id: str) -> dict:
    """
    Get the core student profile and onboarding state.

    This is a read-only MCP tool.
    """

    try:
        UUID(user_id)
    except ValueError:
        raise ValueError("Invalid user_id. Expected a UUID.")

    query = """
        SELECT
            u.id,
            u.email,
            u.first_name,
            u.last_name,
            u.mobile_number,
            u.role,
            u.is_onboarded,
            u.auth_provider,
            u.is_premium,

            uo.current_step,
            uo.personal_info_completed,
            uo.academic_info_completed,
            uo.goals_completed,
            uo.subjects_completed,
            uo.completed_at

        FROM users u
        LEFT JOIN user_onboarding uo
            ON uo.user_id = u.id
        WHERE u.id = %s
        LIMIT 1;
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(query, (user_id,))
            row = cursor.fetchone()

            if not row:
                return {
                    "found": False,
                    "user_id": user_id,
                }

            columns = [description.name for description in cursor.description]
            data = dict(zip(columns, row))

    return {
        "found": True,
        "student": data,
    }
