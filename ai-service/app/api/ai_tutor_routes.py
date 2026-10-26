from fastapi import APIRouter, HTTPException

from app.graphs.ai_tutor_graph import run_ai_tutor_graph
from app.models.ai_tutor import AITutorRequest  # Keep your existing model import path

router = APIRouter()


@router.post("/internal/v1/ai-tutor/respond")
async def respond_to_ai_tutor(request: AITutorRequest):
    graph_result = run_ai_tutor_graph({
        "action": request.action,
        "question": request.questionContext or {},
        "conversation": request.conversation or [],
        "user_message": (request.userMessage or "").strip(),
    })

    if graph_result.get("error"):
        raise HTTPException(
            status_code=500,
            detail=graph_result["error"],
        )

    return {
        "success": True,
        "userId": request.userId,
        "questionId": request.questionId,
        "conversationId": request.conversationId,
        "conversationType": request.conversationType,
        "action": request.action,
        "result": graph_result.get("result", {}),
    }