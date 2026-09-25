import uuid

from fastapi import APIRouter

from app.graphs.smoke_graph import ai_graph
from app.models.run import AIRunRequest, AIRunResponse


router = APIRouter()


@router.post(
    "/internal/v1/runs",
    response_model=AIRunResponse,
)
async def create_ai_run(payload: AIRunRequest):

    run_id = str(uuid.uuid4())

    result = await ai_graph.ainvoke(
        {
            "user_id": payload.user_id,
            "request": payload.request,
        }
    )

    return AIRunResponse(
        run_id=run_id,
        intent=result["intent"],
        response=result["response"],
    )