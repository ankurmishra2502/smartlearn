import json
import re
from typing import TypedDict, Any

from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END

from app.core.config import settings


class PracticeGenerationState(TypedDict):
    question_context: dict[str, Any]
    generated_question: dict[str, Any]
    error: str | None


def get_llm():
    return ChatOpenAI(
        model=settings.openai_model,
        api_key=settings.openai_api_key,
        temperature=0.7,
    )


def extract_json(content: str) -> dict:
    content = content.strip()

    # Handle JSON wrapped inside markdown code blocks.
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)

    return json.loads(content)


def validate_practice_question(data: dict, topic_name: str) -> None:
    required_fields = [
        "questionText",
        "options",
        "correctOptionKey",
        "explanation",
        "topicName",
    ]

    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field: {field}")

    if not isinstance(data["questionText"], str) or not data["questionText"].strip():
        raise ValueError("Invalid questionText")

    options = data["options"]

    if not isinstance(options, list) or len(options) != 4:
        raise ValueError("Exactly four options are required")

    option_keys = set()

    for option in options:
        if not isinstance(option, dict):
            raise ValueError("Each option must be an object")

        key = option.get("optionKey")
        text = option.get("optionText")

        if not isinstance(key, str) or not key.strip():
            raise ValueError("Invalid optionKey")

        if not isinstance(text, str) or not text.strip():
            raise ValueError("Invalid optionText")

        if key in option_keys:
            raise ValueError("Duplicate option keys")

        option_keys.add(key)

    if data["correctOptionKey"] not in option_keys:
        raise ValueError("Correct option key does not exist")

    if not isinstance(data["explanation"], str) or not data["explanation"].strip():
        raise ValueError("Invalid explanation")

    if not isinstance(data["topicName"], str) or not data["topicName"].strip():
        raise ValueError("Invalid topicName")


def generate_practice_question(state: PracticeGenerationState):
    try:
        context = state["question_context"]

        question_text = context.get("questionText", "")
        topic_name = context.get("topicName", "General")

        options = context.get("options", [])
        explanation = context.get("explanation", "")
        mistake_category = context.get("mistakeCategory", "")

        prompt = f"""
You are an expert educational question generator for SmartLearn.

Your task is to generate ONE new practice question based on the student's
original incorrectly answered question.

ORIGINAL QUESTION:
{question_text}

ORIGINAL OPTIONS:
{json.dumps(options, ensure_ascii=False)}

ORIGINAL EXPLANATION:
{explanation}

TOPIC:
{topic_name}

MISTAKE CATEGORY:
{mistake_category}

STRICT REQUIREMENTS:

1. Generate a new question testing the same underlying concept.
2. Do not copy or merely rephrase the original question.
3. Keep the difficulty approximately similar to the original.
4. Generate exactly four answer options.
5. Each option must have a unique key: A, B, C, D.
6. Exactly one option must be correct.
7. The explanation must clearly explain why the correct answer is correct.
8. Do not reveal multiple correct answers.
9. Keep the question relevant to the supplied topic.
10. Do not invent information that is not needed to solve the question.

Return ONLY valid JSON in this exact structure:

{{
    "questionText": "New question",
    "options": [
        {{"optionKey": "A", "optionText": "Option A"}},
        {{"optionKey": "B", "optionText": "Option B"}},
        {{"optionKey": "C", "optionText": "Option C"}},
        {{"optionKey": "D", "optionText": "Option D"}}
    ],
    "correctOptionKey": "A",
    "explanation": "Explanation",
    "topicName": "{topic_name}"
}}
"""

        llm = get_llm()
        response = llm.invoke(prompt)

        content = response.content

        if not isinstance(content, str):
            raise ValueError("Unexpected LLM response format")

        generated_question = extract_json(content)

        validate_practice_question(
            generated_question,
            topic_name,
        )

        return {
            "generated_question": generated_question,
            "error": None,
        }

    except Exception as exc:
        return {
            "generated_question": {},
            "error": str(exc),
        }


def build_practice_generation_graph():
    workflow = StateGraph(PracticeGenerationState)

    workflow.add_node(
        "generate_practice_question",
        generate_practice_question,
    )

    workflow.set_entry_point("generate_practice_question")
    workflow.add_edge("generate_practice_question", END)

    return workflow.compile()


practice_generation_graph = build_practice_generation_graph()


def run_practice_generation_graph(question_context: dict):
    result = practice_generation_graph.invoke({
        "question_context": question_context,
        "generated_question": {},
        "error": None,
    })

    return {
        "question": result.get("generated_question", {}),
        "error": result.get("error"),
    }