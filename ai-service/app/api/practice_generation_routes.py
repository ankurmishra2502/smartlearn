from fastapi import APIRouter, HTTPException

from app.models.practice_generation import PracticeGenerationRequest
from app.graphs.practice_generation_graph import run_practice_generation_graph

router = APIRouter()


@router.post("/internal/v1/practice/generate")
async def generate_practice(request: PracticeGenerationRequest):

    graph_result = run_practice_generation_graph(
        request.questionContext
    )

    if graph_result.get("error"):
        raise HTTPException(
            status_code=500,
            detail=graph_result["error"],
        )

    return {
        "success": True,
        "userId": request.userId,
        "questionId": request.questionId,
        "question": graph_result["question"],
    }