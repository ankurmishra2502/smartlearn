from fastapi import APIRouter, HTTPException

from app.models.quiz import (
    QuizStageGenerationRequest,
    QuizStageGenerationResponse,
)
from app.graphs.quiz_generation_graph import (
    quiz_generation_graph,
)
from app.services.quiz_generation import (
    update_generation_run,
    update_stage_status,
)


router = APIRouter(
    prefix="/internal/v1/quiz",
    tags=["Quiz Generation"],
)


@router.post(
    "/stages/generate",
    response_model=QuizStageGenerationResponse,
)
async def generate_quiz_stage(
    payload: QuizStageGenerationRequest,
):
    try:
        result = await quiz_generation_graph.ainvoke(
            {
                "quiz_id": payload.quizId,
                "stage_id": payload.stageId,
                "generation_run_id": payload.generationRunId,
            }
        )

        question_count = len(
            result.get(
                "saved_questions",
                [],
            )
        )

        return QuizStageGenerationResponse(
            success=True,
            quizId=payload.quizId,
            stageId=payload.stageId,
            generationRunId=payload.generationRunId,
            status="completed",
            questionCount=question_count,
        )

    except Exception as error:

        print(
            "❌ Quiz stage generation failed:",
            str(error),
        )

        # The Node service has already marked the
        # generation run as started and the stage
        # as generating.
        #
        # If anything fails inside the AI workflow,
        # make the lifecycle state consistent.

        try:
            update_generation_run(
                generation_run_id=payload.generationRunId,
                status="failed",
                model_provider="openai",
                error_message=str(error),
                generation_metadata={
                    "quiz_id": payload.quizId,
                    "stage_id": payload.stageId,
                },
            )

            update_stage_status(
                stage_id=payload.stageId,
                status="failed",
            )

        except Exception as state_error:

            print(
                "❌ Failed to update generation state:",
                str(state_error),
            )

        raise HTTPException(
            status_code=500,
            detail="Quiz stage generation failed",
        )