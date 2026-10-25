from typing import TypedDict, Any
import random
import asyncio

from click import prompt
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from psycopg.types.json import Jsonb

from app.core.config import settings
from app.services.quiz_generation import (
    get_quiz_context,
    get_stage_context,
    get_quiz_sources,
    get_previous_stage_performance,
    save_generated_questions,
    update_generation_run,
    update_stage_status,
    update_stage_attempt_status,
)
from app.services.learner_context import load_learner_context
from app.models.quiz import GeneratedQuizQuestions


# ============================================================
# GRAPH STATE
# ============================================================

class QuizGenerationState(TypedDict, total=False):
    quiz_id: str
    stage_id: str
    stage_attempt_id: str | None
    generation_run_id: str

    quiz: dict
    stage: dict
    sources: list[dict]

    learner_context: dict
    previous_stage_performance: list[dict]

    retrieved_knowledge: list[dict]

    generation_context: dict
    generated_questions: list[dict]

    saved_questions: list[dict]

    error: str


# ============================================================
# LLM
# ============================================================

llm = ChatOpenAI(
    model=settings.openai_model,
    api_key=settings.openai_api_key,
    temperature=0,
)


# ============================================================
# STEP 1 - LOAD QUIZ
# ============================================================

def load_quiz(state: QuizGenerationState):

    quiz = get_quiz_context(
        quiz_id=state["quiz_id"]
    )

    return {
        "quiz": quiz
    }


# ============================================================
# STEP 2 - LOAD STAGE
# ============================================================

def load_stage(state: QuizGenerationState):

    stage = get_stage_context(
        quiz_id=state["quiz_id"],
        stage_id=state["stage_id"],
    )

    return {
        "stage": stage
    }


# ============================================================
# STEP 3 - LOAD SOURCES
# ============================================================

def load_sources(state: QuizGenerationState):

    sources = get_quiz_sources(
        quiz_id=state["quiz_id"]
    )

    return {
        "sources": sources
    }


# ============================================================
# STEP 4 - LOAD LEARNER CONTEXT
# ============================================================

async def load_learner(state: QuizGenerationState):

    learner_context = await load_learner_context(
        state["quiz"]["user_id"]
    )

    return {
        "learner_context": learner_context
    }


# ============================================================
# STEP 5 - LOAD PREVIOUS PERFORMANCE
# ============================================================

def load_previous_performance(
    state: QuizGenerationState
):

    stage = state["stage"]

    performance = get_previous_stage_performance(
        quiz_id=state["quiz_id"],
        stage_display_order=stage["display_order"],
    )

    return {
        "previous_stage_performance": performance
    }


# ============================================================
# STEP 6 - RAG RETRIEVAL
# ============================================================

async def retrieve_knowledge(
    state: QuizGenerationState
):
    """
    RAG retrieval boundary.

    This is intentionally kept separate from quiz
    generation so that pgvector retrieval can be
    plugged in without changing the generation graph.

    The actual retrieval implementation will be added
    in the RAG layer.
    """

    # --------------------------------------------------------
    # TEMPORARY
    # --------------------------------------------------------
    #
    # Do NOT use arbitrary model knowledge as a substitute
    # for the future RAG layer when source-grounded
    # generation is required.
    #
    # We return an empty context until the retrieval
    # implementation is connected.
    #

    return {
        "retrieved_knowledge": []
    }


# ============================================================
# STEP 7 - PREPARE GENERATION CONTEXT
# ============================================================

def prepare_generation_context(
    state: QuizGenerationState
):

    quiz = state["quiz"]
    stage = state["stage"]

    context = {
        "quiz": {
            "topic_name": quiz["topic_name"],
            "description": quiz["description"],
            "source_type": quiz["source_type"],
            "time_per_question_seconds":
                quiz["time_per_question_seconds"],
        },

        "stage": {
            "difficulty": stage["difficulty"],
            "question_count": stage["question_count"],
            "display_order": stage["display_order"],
        },

        "sources": state.get(
            "sources",
            []
        ),

        "learner_context": state.get(
            "learner_context",
            {}
        ),

        "previous_stage_performance":
            state.get(
                "previous_stage_performance",
                []
            ),

        "retrieved_knowledge":
            state.get(
                "retrieved_knowledge",
                []
            ),
    }

    return {
        "generation_context": context
    }

def shuffle_question_options(question):
    options = question.options.copy()

    correct_option_key = question.correctOptionKey

    random.shuffle(options)

    option_keys = [
        "option1",
        "option2",
        "option3",
        "option4",
    ]

    new_correct_option_key = None

    for index, option in enumerate(options):

        old_key = option.optionKey
        new_key = option_keys[index]

        if old_key == correct_option_key:
            new_correct_option_key = new_key

        option.optionKey = new_key
        option.displayOrder = index + 1

    question.correctOptionKey = new_correct_option_key

    return question


# ============================================================
# STEP 8 - GENERATE QUESTIONS
# ============================================================

async def generate_questions(
    state: QuizGenerationState
):
    context = state["generation_context"]
    stage = context["stage"]

    question_count = int(stage["question_count"])
    difficulty = stage["difficulty"]

    structured_llm = llm.with_structured_output(
        GeneratedQuizQuestions
    )

    base_prompt = f"""
You are the SmartLearn educational quiz generation engine.

Generate EXACTLY the requested number of NEW questions.

QUIZ TOPIC:
{context["quiz"]["topic_name"]}

QUIZ DESCRIPTION:
{context["quiz"]["description"] or "Not provided"}

DIFFICULTY:
{difficulty}

SOURCE TYPE:
{context["quiz"]["source_type"]}

LEARNER CONTEXT:
{context["learner_context"]}

PREVIOUS STAGE PERFORMANCE:
{context["previous_stage_performance"]}

RETRIEVED KNOWLEDGE:
{context["retrieved_knowledge"]}

ATTACHED SOURCES:
{context["sources"]}

QUESTION RULES:

- Generate exactly the requested number of questions.
- Every question must be relevant to the quiz topic.
- Every question must match the requested difficulty.
- questionType must be "single_choice".
- Every question MUST contain exactly 4 options.
- Option keys MUST be option1, option2, option3, option4.
- Exactly ONE option must be correct.
- correctOptionKey MUST identify the correct option.
- All four options must be plausible and related.
- Do not duplicate questions.
- Do not put the correct answer in the question text.
- Include an explanation for every question.
- Return structured data only.
"""

    generated_questions = []
    seen_questions = set()

    # First attempt generates the complete question set.
    # Subsequent attempts generate only missing questions.
    for attempt in range(3):
        missing_count = question_count - len(
            generated_questions
        )

        if missing_count <= 0:
            break

        existing_questions = [
            question.questionText
            for question in generated_questions
        ]

        prompt = f"""
{base_prompt}

NUMBER OF QUESTIONS REQUIRED IN THIS RESPONSE:
{missing_count}

QUESTIONS ALREADY GENERATED:
{existing_questions}

IMPORTANT:
- Generate exactly {missing_count} questions in this response.
- Do not repeat or rephrase any existing question.
- Generate only new questions.
"""

        result = await structured_llm.ainvoke(prompt)

        if not result or not result.questions:
            print(
                f"⚠️ Generation attempt {attempt + 1}: "
                "no questions returned."
            )
            continue

        added_count = 0

        for question in result.questions:
            normalized_text = (
                question.questionText.strip().lower()
            )

            if not normalized_text:
                continue

            if normalized_text in seen_questions:
                continue

            if len(generated_questions) >= question_count:
                break

            # Keep the existing option and answer validation.
            if len(question.options) != 4:
                continue

            option_keys = {
                option.optionKey
                for option in question.options
            }

            expected_keys = {
                "option1",
                "option2",
                "option3",
                "option4",
            }

            if option_keys != expected_keys:
                continue

            if question.correctOptionKey not in option_keys:
                continue

            seen_questions.add(normalized_text)
            generated_questions.append(question)
            added_count += 1

        print(
            f"Generation attempt {attempt + 1}: "
            f"added {added_count}, "
            f"total {len(generated_questions)}/{question_count}"
        )

        if len(generated_questions) < question_count:
            await asyncio.sleep(1)

    if len(generated_questions) != question_count:
        raise ValueError(
            f"Expected {question_count} unique valid questions, "
            f"but generated {len(generated_questions)} "
            "after 3 attempts."
        )

    # Shuffle options only after validating the correct answer.
    shuffled_questions = [
        shuffle_question_options(question)
        for question in generated_questions
    ]

    questions = [
        question.model_dump()
        for question in shuffled_questions
    ]

    return {
        "generated_questions": questions
    }

#============================================================
# STEP 9 - VALIDATE QUESTIONS
# ============================================================

def validate_questions(
    state: QuizGenerationState
):

    questions = state["generated_questions"]

    expected_count = state["stage"]["question_count"]

    # --------------------------------------------------------
    # Exact count
    # --------------------------------------------------------

    if len(questions) != expected_count:
        raise ValueError(
            f"Expected {expected_count} questions "
            f"but received {len(questions)}."
        )

    seen_questions = set()

    for index, question in enumerate(
        questions,
        start=1
    ):

        question_text = (
            question["questionText"]
            .strip()
        )

        if not question_text:
            raise ValueError(
                f"Question {index} has empty text."
            )

        normalized_question = (
            question_text.lower()
        )

        if normalized_question in seen_questions:
            raise ValueError(
                f"Duplicate question detected at "
                f"position {index}."
            )

        seen_questions.add(
            normalized_question
        )

        options = question.get(
            "options",
            []
        )

        if len(options) < 2:
            raise ValueError(
                f"Question {index} must have "
                f"at least two options."
            )

        option_keys = {
            option["optionKey"]
            for option in options
        }

        correct_key = question[
            "correctOptionKey"
        ]

        if correct_key not in option_keys:
            raise ValueError(
                f"Question {index} has an invalid "
                f"correctOptionKey."
            )

        if not question.get(
            "topicName"
        ):
            raise ValueError(
                f"Question {index} has no topicName."
            )

        if not question.get(
            "topicKey"
        ):
            raise ValueError(
                f"Question {index} has no topicKey."
            )

        if not question.get(
            "explanation"
        ):
            raise ValueError(
                f"Question {index} has no explanation."
            )

    return {
        "generated_questions": questions
    }


# ============================================================
# STEP 10 - PERSIST QUESTIONS
# ============================================================

def persist_questions(state: QuizGenerationState):
    saved_questions = save_generated_questions(
        quiz_id=state["quiz_id"],
        stage_id=state["stage_id"],
        stage_attempt_id=state["stage_attempt_id"],
        questions=state["generated_questions"],
    )

    return {
        "saved_questions": saved_questions
    }

# ============================================================
# STEP 11 - COMPLETE GENERATION
# ============================================================

def complete_generation(
    state: QuizGenerationState
):

    question_count = len(
        state["saved_questions"]
    )

    update_generation_run(
        generation_run_id=state[
            "generation_run_id"
        ],
        status="completed",
        model_provider="openai",
        model_name=settings.openai_model,
        prompt_version="quiz-generation-v1",
        generation_metadata={
            "question_count": question_count,
            "difficulty": state[
                "stage"
            ]["difficulty"],
        },
    )

    update_stage_status(
        stage_id=state["stage_id"],
        status="ready",
    )

    return {}


# ============================================================
# GRAPH
# ============================================================

def build_quiz_generation_graph():

    graph = StateGraph(
        QuizGenerationState
    )

    graph.add_node(
        "load_quiz",
        load_quiz,
    )

    graph.add_node(
        "load_stage",
        load_stage,
    )

    graph.add_node(
        "load_sources",
        load_sources,
    )

    graph.add_node(
        "load_learner",
        load_learner,
    )

    graph.add_node(
        "load_previous_performance",
        load_previous_performance,
    )

    graph.add_node(
        "retrieve_knowledge",
        retrieve_knowledge,
    )

    graph.add_node(
        "prepare_generation_context",
        prepare_generation_context,
    )

    graph.add_node(
        "generate_questions",
        generate_questions,
    )

    graph.add_node(
        "validate_questions",
        validate_questions,
    )

    graph.add_node(
        "persist_questions",
        persist_questions,
    )

    graph.add_node(
        "complete_generation",
        complete_generation,
    )

    graph.add_edge(
        START,
        "load_quiz",
    )

    graph.add_edge(
        "load_quiz",
        "load_stage",
    )

    graph.add_edge(
        "load_stage",
        "load_sources",
    )

    graph.add_edge(
        "load_sources",
        "load_learner",
    )

    graph.add_edge(
        "load_learner",
        "load_previous_performance",
    )

    graph.add_edge(
        "load_previous_performance",
        "retrieve_knowledge",
    )

    graph.add_edge(
        "retrieve_knowledge",
        "prepare_generation_context",
    )

    graph.add_edge(
        "prepare_generation_context",
        "generate_questions",
    )

    graph.add_edge(
        "generate_questions",
        "validate_questions",
    )

    graph.add_edge(
        "validate_questions",
        "persist_questions",
    )

    graph.add_edge(
        "persist_questions",
        "complete_generation",
    )

    graph.add_edge(
        "complete_generation",
        END,
    )

    return graph.compile()


quiz_generation_graph = (
    build_quiz_generation_graph()
)