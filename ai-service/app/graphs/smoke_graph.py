from typing import TypedDict

from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

from app.core.config import settings
from app.mcp.client import call_mcp_tool


class AIState(TypedDict, total=False):
    user_id: str
    request: str
    intent: str
    required_context: list[str]
    learner_context: dict
    response: str


class IntentResult(TypedDict):
    intent: str


class ContextPlan(TypedDict):
    required_context: list[str]


llm = ChatOpenAI(
    model=settings.openai_model,
    api_key=settings.openai_api_key,
    temperature=0,
)


def understand_request(state: AIState):
    structured_llm = llm.with_structured_output(IntentResult)

    result = structured_llm.invoke(
        f"""
Classify the user's request into exactly one short intent.

User request:
{state["request"]}

Allowed intents:
- quiz
- doubt
- study_plan
- recommendation
- general_learning
"""
    )

    return {
        "intent": result["intent"]
    }


def plan_context(state: AIState):
    """
    Decide which learner context is required for this request.
    """

    structured_llm = llm.with_structured_output(ContextPlan)

    result = structured_llm.invoke(
        f"""
You are planning context retrieval for a SmartLearn AI workflow.

User request:
{state["request"]}

Detected intent:
{state["intent"]}

Available learner context:

- student
  Basic learner identity and onboarding state.

- academic
  School, class/standard, location and academic information.

- goals
  Learning goals selected by the learner.

- subjects
  Subjects selected by the learner.

Select ONLY the context categories actually needed
to answer the user's request.

Allowed values:
- student
- academic
- goals
- subjects

Return an empty list if no learner context is required.
"""
    )

    return {
        "required_context": result["required_context"]
    }


async def load_context(state: AIState):
    """
    Execute only the MCP tools selected by the context planner.
    """

    required_context = state.get(
        "required_context",
        [],
    )

    context = {}

    tool_mapping = {
        "student": "student_context",
        "academic": "academic_context",
        "goals": "user_goals",
        "subjects": "selected_subjects",
    }

    for context_name in required_context:

        tool_name = tool_mapping.get(context_name)

        if not tool_name:
            continue

        result = await call_mcp_tool(
            tool_name,
            {
                "user_id": state["user_id"],
            },
        )

        context[context_name] = result

    return {
        "learner_context": context
    }


async def generate_response(state: AIState):

    learner_context = state.get(
        "learner_context",
        {},
    )

    result = await llm.ainvoke(
        f"""
You are the SmartLearn AI assistant.

User request:
{state["request"]}

Detected intent:
{state["intent"]}

Learner context retrieved specifically for this request:
{learner_context}

Rules:
- Use the learner context when relevant.
- Do not invent learner information.
- Do not expose unnecessary personal information.
- If required information is unavailable, say so.
- Give a concise and useful response.
"""
    )

    return {
        "response": result.content
    }


def build_graph():

    graph = StateGraph(AIState)

    graph.add_node(
        "understand_request",
        understand_request,
    )

    graph.add_node(
        "plan_context",
        plan_context,
    )

    graph.add_node(
        "load_context",
        load_context,
    )

    graph.add_node(
        "generate_response",
        generate_response,
    )

    graph.add_edge(
        START,
        "understand_request",
    )

    graph.add_edge(
        "understand_request",
        "plan_context",
    )

    graph.add_edge(
        "plan_context",
        "load_context",
    )

    graph.add_edge(
        "load_context",
        "generate_response",
    )

    graph.add_edge(
        "generate_response",
        END,
    )

    return graph.compile()


ai_graph = build_graph()