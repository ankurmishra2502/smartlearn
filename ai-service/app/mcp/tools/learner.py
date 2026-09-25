from uuid import UUID

from app.mcp.db import db_pool


def validate_user_id(user_id: str) -> None:
    try:
        UUID(user_id)
    except ValueError:
        raise ValueError("Invalid user_id. Expected a UUID.")


def get_academic_context(user_id: str) -> dict:
    """
    Get the student's academic information.
    """

    validate_user_id(user_id)

    query = """
        SELECT
            user_id,
            school_name,
            district,
            state,
            country,
            pincode,
            class,
            course_or_standard,
            created_at,
            updated_at
        FROM user_academic_details
        WHERE user_id = %s
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
                    "academic": None,
                }

            columns = [description.name for description in cursor.description]
            academic = dict(zip(columns, row))

    return {
        "found": True,
        "user_id": user_id,
        "academic": academic,
    }


def get_user_goals(user_id: str) -> dict:
    """
    Get the student's goals and their goal descriptions.
    """

    validate_user_id(user_id)

    query = """
        SELECT
            ug.id,
            ug.goal_id,
            ug.goal_description,
            ug.is_primary,
            g.name AS goal_name,
            g.description AS goal_description_from_catalog,
            g.metadata AS goal_metadata
        FROM user_goals ug
        LEFT JOIN goals g
            ON g.id = ug.goal_id
        WHERE ug.user_id = %s
        ORDER BY ug.is_primary DESC, ug.created_at ASC;
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(query, (user_id,))
            rows = cursor.fetchall()

            columns = [description.name for description in cursor.description]
            goals = [
                dict(zip(columns, row))
                for row in rows
            ]

    return {
        "found": bool(goals),
        "user_id": user_id,
        "goals": goals,
    }


def get_selected_subjects(user_id: str) -> dict:
    """
    Get the subjects selected by the student during onboarding.
    """

    validate_user_id(user_id)

    query = """
        SELECT
            uais.id,
            uais.ai_subject_id,
            ais.name,
            ais.normalized_name,
            ais.description,
            uais.source,
            uais.generation_context_hash,
            uais.display_order,
            uais.is_active,
            uais.is_selected
        FROM user_ai_subjects uais
        INNER JOIN ai_subjects ais
            ON ais.id = uais.ai_subject_id
        WHERE uais.user_id = %s
          AND uais.is_active = TRUE
          AND uais.is_selected = TRUE
        ORDER BY uais.display_order ASC, ais.name ASC;
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(query, (user_id,))
            rows = cursor.fetchall()

            columns = [description.name for description in cursor.description]
            subjects = [
                dict(zip(columns, row))
                for row in rows
            ]

    return {
        "found": bool(subjects),
        "user_id": user_id,
        "subjects": subjects,
    }