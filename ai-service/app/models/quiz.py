from typing import Literal

from pydantic import BaseModel, Field


class QuizStageGenerationRequest(BaseModel):
    quizId: str
    stageId: str
    generationRunId: str
    stageAttemptId: str | None = None


class QuizStageGenerationResponse(BaseModel):
    success: bool
    quizId: str
    stageId: str
    generationRunId: str
    status: str
    questionCount: int


class QuizOption(BaseModel):
    optionKey: Literal[
        "option1",
        "option2",
        "option3",
        "option4",
    ]

    
    optionText: str = Field(min_length=1)

    displayOrder: int


class GeneratedQuestion(BaseModel):
    questionText: str = Field(min_length=1)

    questionType: Literal[
        "single_choice",
        "multiple_choice",
        "true_false",
    ] = "single_choice"

    topicName: str = Field(min_length=1)
    topicKey: str = Field(min_length=1)

    subtopicName: str | None = None
    subtopicKey: str | None = None

    correctOptionKey: Literal[
        "option1",
        "option2",
        "option3",
        "option4",
    ]

    explanation: str = Field(min_length=1)

    sourceReference: str | None = None

    options: list[QuizOption] = Field(
        min_length=4,
        max_length=4,
    )


class GeneratedQuizQuestions(BaseModel):
    questions: list[GeneratedQuestion] = Field(
        min_length=1
    )