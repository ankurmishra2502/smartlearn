from typing import Any
from pydantic import BaseModel, Field


class PracticeGenerationRequest(BaseModel):
    userId: str
    questionId: str
    questionContext: dict[str, Any] = Field(default_factory=dict)


class PracticeOption(BaseModel):
    optionKey: str
    optionText: str


class PracticeQuestion(BaseModel):
    questionText: str
    options: list[PracticeOption]
    correctOptionKey: str
    explanation: str
    topicName: str


class PracticeGenerationResponse(BaseModel):
    success: bool
    userId: str
    questionId: str
    question: PracticeQuestion