from uuid import UUID

from app.mcp.db import db_pool
from psycopg.types.json import Jsonb


def _validate_uuid(value: str, field_name: str) -> None:
    try:
        UUID(value)
    except (ValueError, TypeError):
        raise ValueError(
            f"Invalid {field_name}. Expected a UUID."
        )


def get_quiz_context(
    quiz_id: str,
    user_id: str | None = None,
) -> dict:
    """
    Load the authoritative quiz configuration.

    PostgreSQL is the source of truth for:
    - topic
    - description
    - source type
    - time per question
    - quiz status
    """

    _validate_uuid(quiz_id, "quiz_id")

    query = """
        SELECT
            id,
            user_id,
            topic_name,
            description,
            source_type,
            status,
            time_per_question_seconds,
            generation_metadata,
            created_at,
            updated_at
        FROM v2_quizzes
        WHERE id = %s
    """

    params = [quiz_id]

    if user_id:
        _validate_uuid(user_id, "user_id")

        query += """
            AND user_id = %s
        """

        params.append(user_id)

    query += """
        LIMIT 1
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()

            if not row:
                raise ValueError("Quiz not found.")

            columns = [
                description.name
                for description in cursor.description
            ]

            return dict(zip(columns, row))


def get_stage_context(
    quiz_id: str,
    stage_id: str,
) -> dict:
    """
    Load the authoritative stage configuration.

    PostgreSQL is the source of truth for:
    - difficulty
    - question count
    - stage status
    - display order
    """

    _validate_uuid(quiz_id, "quiz_id")
    _validate_uuid(stage_id, "stage_id")

    query = """
        SELECT
            id,
            quiz_id,
            difficulty,
            display_order,
            question_count,
            status,
            created_at,
            updated_at
        FROM v2_quiz_stages
        WHERE id = %s
          AND quiz_id = %s
        LIMIT 1
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                query,
                (stage_id, quiz_id),
            )

            row = cursor.fetchone()

            if not row:
                raise ValueError(
                    "Quiz stage not found."
                )

            columns = [
                description.name
                for description in cursor.description
            ]

            return dict(zip(columns, row))


def get_quiz_sources(
    quiz_id: str,
) -> list[dict]:
    """
    Load all sources attached to the quiz.

    These records will later feed the RAG ingestion/
    retrieval pipeline.
    """

    _validate_uuid(quiz_id, "quiz_id")

    query = """
        SELECT
            id,
            quiz_id,
            source_type,
            original_file_name,
            mime_type,
            file_size_bytes,
            s3_bucket,
            s3_key,
            processing_status,
            extracted_text,
            processing_metadata,
            created_at,
            updated_at
        FROM v2_quiz_sources
        WHERE quiz_id = %s
        ORDER BY created_at ASC
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                query,
                (quiz_id,),
            )

            rows = cursor.fetchall()

            columns = [
                description.name
                for description in cursor.description
            ]

            return [
                dict(zip(columns, row))
                for row in rows
            ]


def get_previous_stage_performance(
    quiz_id: str,
    stage_display_order: int,
) -> list[dict]:
    """
    Load previous completed stage performance.

    This is intentionally separated from the first
    generation implementation. It will be used when
    Medium/Hard generation becomes adaptive.
    """

    _validate_uuid(quiz_id, "quiz_id")

    query = """
        SELECT
            s.id AS stage_id,
            s.difficulty,
            s.display_order,
            s.question_count,
            sa.id AS stage_attempt_id,
            sa.status AS stage_attempt_status,
            COUNT(qa.id)::INTEGER AS answered_questions,
            COUNT(
                qa.id
            ) FILTER (
                WHERE qa.is_correct = TRUE
            )::INTEGER AS correct_questions,
            COALESCE(
                SUM(qa.time_taken_ms),
                0
            )::BIGINT AS total_time_taken_ms
        FROM v2_quiz_stages s
        LEFT JOIN v2_stage_attempts sa
            ON sa.stage_id = s.id
        LEFT JOIN v2_question_attempts qa
            ON qa.stage_attempt_id = sa.id
        WHERE s.quiz_id = %s
          AND s.display_order < %s
          AND sa.status = 'passed'
        GROUP BY
            s.id,
            s.difficulty,
            s.display_order,
            s.question_count,
            sa.id,
            sa.status
        ORDER BY s.display_order ASC
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                query,
                (
                    quiz_id,
                    stage_display_order,
                ),
            )

            rows = cursor.fetchall()

            columns = [
                description.name
                for description in cursor.description
            ]

            return [
                dict(zip(columns, row))
                for row in rows
            ]


def save_generated_questions(
    quiz_id: str,
    stage_id: str,
    stage_attempt_id: str,
    questions: list[dict],
) -> list[dict]:
    """
    Persist validated AI-generated questions and options.

    This function assumes the questions have already
    passed AI/schema/business validation.
    """

    _validate_uuid(quiz_id, "quiz_id")
    _validate_uuid(stage_id, "stage_id")
    _validate_uuid(stage_attempt_id, "stage_attempt_id")

    if not questions:
        raise ValueError(
            "Cannot save an empty question set."
        )

    saved_questions = []

    with db_pool.connection() as conn:
        try:
            with conn.cursor() as cursor:

                for index, question in enumerate(
                    questions,
                    start=1,
                ):
                    question_result = cursor.execute(
                        """
                        INSERT INTO v2_quiz_questions (
                            stage_id,
                            stage_attempt_id,
                            question_text,
                            question_type,
                            topic_name,
                            topic_key,
                            subtopic_name,
                            subtopic_key,
                            correct_option_key,
                            explanation,
                            source_reference,
                            generation_metadata,
                            display_order
                        )
                        VALUES (
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s
                        )
                        RETURNING *
                        """,
                        (
                            stage_id,
                            stage_attempt_id,
                            question["questionText"],
                            question.get(
                                "questionType",
                                "single_choice",
                            ),
                            question["topicName"],
                            question["topicKey"],
                            question.get(
                                "subtopicName"
                            ),
                            question.get(
                                "subtopicKey"
                            ),
                            question[
                                "correctOptionKey"
                            ],
                            question["explanation"],
                            question.get(
                                "sourceReference"
                            ),
                            question.get(
                                "generationMetadata"
                            ),
                            index,
                        ),
                    )

                    saved_question = (
                        question_result.fetchone()
                    )

                    question_columns = [
                        description.name
                        for description in (
                            cursor.description
                        )
                    ]

                    saved_question = dict(
                        zip(
                            question_columns,
                            saved_question,
                        )
                    )

                    for option in question["options"]:
                        cursor.execute(
                            """
                            INSERT INTO v2_quiz_options (
                                question_id,
                                option_key,
                                option_text,
                                display_order
                            )
                            VALUES (
                                %s,
                                %s,
                                %s,
                                %s
                            )
                            """,
                            (
                                saved_question["id"],
                                option["optionKey"],
                                option["optionText"],
                                option["displayOrder"],
                            ),
                        )

                    saved_questions.append(
                        saved_question
                    )

            conn.commit()

        except Exception:
            conn.rollback()
            raise

    return saved_questions


def update_generation_run(
    generation_run_id: str,
    status: str,
    model_provider: str | None = None,
    model_name: str | None = None,
    prompt_version: str | None = None,
    error_message: str | None = None,
    generation_metadata: dict | None = None,
) -> dict:

    _validate_uuid(
        generation_run_id,
        "generation_run_id",
    )

    query = """
        UPDATE v2_quiz_generation_runs
        SET
            status = %s,
            model_provider = COALESCE(
                %s,
                model_provider
            ),
            model_name = COALESCE(
                %s,
                model_name
            ),
            prompt_version = COALESCE(
                %s,
                prompt_version
            ),
            error_message = %s,
            generation_metadata = COALESCE(
                %s,
                generation_metadata
            ),
            completed_at = CASE
                WHEN %s IN (
                    'completed',
                    'failed'
                )
                THEN CURRENT_TIMESTAMP
                ELSE completed_at
            END
        WHERE id = %s
        RETURNING *
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                query,
                (
                    status,
                    model_provider,
                    model_name,
                    prompt_version,
                    error_message,
                    Jsonb(generation_metadata)
                    if generation_metadata is not None
                    else None,
                    status,
                    generation_run_id,
),
            )

            row = cursor.fetchone()

            if not row:
                raise ValueError(
                    "Generation run not found."
                )

            columns = [
                description.name
                for description in cursor.description
            ]

            result = dict(zip(columns, row))

        conn.commit()

    return result


def update_stage_status(
    stage_id: str,
    status: str,
) -> dict:

    _validate_uuid(stage_id, "stage_id")

    query = """
        UPDATE v2_quiz_stages
        SET
            status = %s,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        RETURNING *
    """

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                query,
                (
                    status,
                    stage_id,
                ),
            )

            row = cursor.fetchone()

            if not row:
                raise ValueError(
                    "Quiz stage not found."
                )

            columns = [
                description.name
                for description in cursor.description
            ]

            result = dict(zip(columns, row))

        conn.commit()

    return result

def update_stage_attempt_status(
    stage_attempt_id: str,
    status: str,
) -> None:
    _validate_uuid(stage_attempt_id, "stage_attempt_id")

    with db_pool.connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE v2_stage_attempts
                SET
                    status = %s,
                    completed_at = CASE
                        WHEN %s IN ('completed', 'failed')
                        THEN CURRENT_TIMESTAMP
                        ELSE completed_at
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (status, status, stage_attempt_id),
            )

            if cursor.rowcount == 0:
                raise ValueError(
                    f"Stage attempt not found: {stage_attempt_id}"
                )

        conn.commit()