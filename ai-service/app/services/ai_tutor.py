import hashlib
import json
import logging
import uuid
from typing import Any, Dict, Optional

from app.mcp.db import db_pool
from app.graphs.ai_tutor_graph import run_ai_tutor_graph

logger = logging.getLogger(__name__)

SUPPORTED_ACTIONS = {
    "why_is_my_answer_wrong",
    "show_steps",
    "explain_simpler",
    "similar_question",
}


def _validate_uuid(value: str, field_name: str) -> str:
    """Validate UUID input."""
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f"Invalid {field_name}.")




def get_authoritative_question_context(
    user_id: str,
    question_id: str,
    quiz_attempt_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Retrieve the question and the user's submitted answer from the database.

    The authenticated user's attempt is used to determine the selected answer.
    The frontend must not be trusted to provide the correct answer.
    """
    user_id = _validate_uuid(user_id, "user_id")
    question_id = _validate_uuid(question_id, "question_id")

    if quiz_attempt_id:
        quiz_attempt_id = _validate_uuid(
            quiz_attempt_id,
            "quiz_attempt_id",
        )

    with db_pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    q.id,
                    q.question_text,
                    q.explanation,
                    q.topic_id,
                    qa.selected_option_id,
                    qa.is_correct,
                    qa.quiz_attempt_id
                FROM v2_quiz_questions q
                JOIN v2_question_attempts qa
                    ON qa.question_id = q.id
                WHERE q.id = %s
                  AND qa.user_id = %s
                  AND (
                      %s IS NULL
                      OR qa.quiz_attempt_id = %s
                  )
                ORDER BY qa.created_at DESC
                LIMIT 1
                """,
                (
                    question_id,
                    user_id,
                    quiz_attempt_id,
                    quiz_attempt_id,
                ),
            )

            row = cur.fetchone()

            if not row:
                raise ValueError(
                    "Question attempt was not found for this user."
                )

            (
                db_question_id,
                question_text,
                explanation,
                topic_id,
                selected_option_id,
                is_correct,
                resolved_attempt_id,
            ) = row

            cur.execute(
                """
                SELECT
                    id,
                    option_key,
                    option_text,
                    is_correct
                FROM v2_quiz_options
                WHERE question_id = %s
                ORDER BY option_key
                """,
                (db_question_id,),
            )

            option_rows = cur.fetchall()

    options = []
    selected_option_key = None
    correct_option_key = None

    for option_row in option_rows:
        option_id, option_key, option_text, is_correct_option = option_row

        options.append(
            {
                "id": str(option_id),
                "option_key": option_key,
                "option_text": option_text,
            }
        )

        if selected_option_id and str(option_id) == str(selected_option_id):
            selected_option_key = option_key

        if is_correct_option:
            correct_option_key = option_key

    return {
        "question_id": str(db_question_id),
        "question_text": question_text,
        "explanation": explanation,
        "topic_id": str(topic_id) if topic_id else None,
        "options": options,
        "selected_option_key": selected_option_key,
        "correct_option_key": correct_option_key,
        "is_correct": is_correct,
        "quiz_attempt_id": (
            str(resolved_attempt_id)
            if resolved_attempt_id
            else None
        ),
    }


def get_conversation(
    user_id: str,
    question_id: str,
    quiz_attempt_id: Optional[str] = None,
    limit: int = 40,
) -> list:
    """
    Retrieve the persisted conversation for a question.

    History is scoped to the user, question, and quiz attempt.
    """
    with db_pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT role, content, action, created_at
                FROM v2_ai_tutor_messages
                WHERE user_id = %s
                  AND question_id = %s
                  AND quiz_attempt_id IS NOT DISTINCT FROM %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (
                    user_id,
                    question_id,
                    quiz_attempt_id,
                    limit,
                ),
            )

            rows = cur.fetchall()

    # Database query is newest-first; return messages chronologically.
    rows.reverse()

    return [
        {
            "role": role,
            "content": content,
            "action": action,
            "created_at": created_at.isoformat()
            if created_at
            else None,
        }
        for role, content, action, created_at in rows
    ]


def _save_message(
    user_id: str,
    question_id: str,
    quiz_attempt_id: Optional[str],
    role: str,
    content: str,
    action: Optional[str],
) -> None:
    """Persist a user or assistant message."""
    with db_pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO v2_ai_tutor_messages (
                    user_id,
                    question_id,
                    quiz_attempt_id,
                    role,
                    content,
                    action
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    user_id,
                    question_id,
                    quiz_attempt_id,
                    role,
                    content,
                    action,
                ),
            )




def _generate_similar_question(
    user_id: str,
    question: Dict[str, Any],
    conversation: list,
    user_message: str,
) -> Dict[str, Any]:
    """
    Generate a temporary practice question.

    Redis caching and duplicate prevention are handled by Node.js.
    This Python function only generates the question.
    Generated questions are not inserted into official quiz tables.
    """
    result = run_ai_tutor_graph(
        {
            "action": "similar_question",
            "question": question,
            "conversation": conversation,
            "user_message": user_message,
        }
    )

    if result.get("error"):
        raise RuntimeError(result["error"])

    generated_question = result.get("result")

    if not generated_question:
        raise RuntimeError(
            "AI Tutor did not return a generated question."
        )

    generated_question["temporary"] = True
    generated_question["source_question_id"] = question["question_id"]

    return generated_question

def ask_ai_tutor(
    user_id: str,
    question_id: str,
    action: str,
    user_message: str = "",
    quiz_attempt_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute an AI Tutor action.

    Supported actions:
    - why_is_my_answer_wrong
    - show_steps
    - explain_simpler
    - similar_question
    """
    user_id = _validate_uuid(user_id, "user_id")
    question_id = _validate_uuid(question_id, "question_id")

    if quiz_attempt_id:
        quiz_attempt_id = _validate_uuid(
            quiz_attempt_id,
            "quiz_attempt_id",
        )

    if action not in SUPPORTED_ACTIONS:
        raise ValueError(
            f"Unsupported action. Allowed actions: "
            f"{', '.join(sorted(SUPPORTED_ACTIONS))}"
        )

    question = get_authoritative_question_context(
        user_id=user_id,
        question_id=question_id,
        quiz_attempt_id=quiz_attempt_id,
    )

    # Use the attempt ID resolved from the authoritative database row.
    resolved_attempt_id = question.get("quiz_attempt_id")

    conversation = get_conversation(
        user_id=user_id,
        question_id=question_id,
        quiz_attempt_id=resolved_attempt_id,
    )

    if user_message.strip():
        _save_message(
            user_id=user_id,
            question_id=question_id,
            quiz_attempt_id=resolved_attempt_id,
            role="user",
            content=user_message.strip(),
            action=action,
        )

        conversation.append(
            {
                "role": "user",
                "content": user_message.strip(),
            }
        )

    if action == "similar_question":
        answer = _generate_similar_question(
            user_id=user_id,
            question=question,
            conversation=conversation,
            user_message=user_message,
        )

        return {
            "success": True,
            "action": action,
            "question_id": question_id,
            "answer": answer,
            "conversation": conversation,
        }

    result = run_ai_tutor_graph(
        {
            "action": action,
            "question": question,
            "conversation": conversation,
            "user_message": user_message,
        }
    )

    if result.get("error"):
        raise RuntimeError(result["error"])

    answer = result.get("result", {})

    answer_text = answer.get("answer", "")

    if not answer_text:
        raise RuntimeError(
            "AI Tutor returned an empty answer."
        )

    _save_message(
        user_id=user_id,
        question_id=question_id,
        quiz_attempt_id=resolved_attempt_id,
        role="assistant",
        content=answer_text,
        action=action,
    )

    updated_conversation = get_conversation(
        user_id=user_id,
        question_id=question_id,
        quiz_attempt_id=resolved_attempt_id,
    )

    return {
        "success": True,
        "action": action,
        "question_id": question_id,
        "answer": answer,
        "conversation": updated_conversation,
    }