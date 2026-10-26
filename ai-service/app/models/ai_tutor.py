from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


AIAction = Literal[
    "why_is_my_answer_wrong",
    "show_steps",
    "explain_simpler",
    "similar_question",
    "ask_question",
]

ConversationType = Literal[
    "ai_tutor",
    "general_chatbot",
]


class AITutorQuestionOption(BaseModel):
    optionId: Optional[str] = None
    optionKey: str
    optionText: str


class AITutorQuestionContext(BaseModel):
    questionText: str
    options: list[AITutorQuestionOption] = Field(default_factory=list)

    selectedOptionId: Optional[str] = None
    selectedAnswer: Optional[str] = None

    correctOptionKey: Optional[str] = None
    correctAnswer: Optional[str] = None

    explanation: Optional[str] = None
    topicName: Optional[str] = None

    mistakeCategory: Optional[
        Literal[
            "concept",
            "calculation",
            "misread",
            "guess",
            "time",
        ]
    ] = None


class AITutorConversationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

from typing import Any, Literal
from pydantic import BaseModel

class AITutorRequest(BaseModel):
    userId: str
    questionId: str | None = None
    quizAttemptId: str | None = None
    conversationId: str | None = None

    conversationType: Literal[
        "ai_tutor",
        "general_chatbot",
    ] = "ai_tutor"

    action: Literal[
        "why_is_my_answer_wrong",
        "show_steps",
        "explain_simpler",
        "similar_question",
        "ask_question",
    ]

    userMessage: str | None = None
    conversation: list[dict[str, Any]] = []
    questionContext: dict[str, Any] | None = None

class AITutorResponse(BaseModel):
    success: bool
    questionId: Optional[str] = None
    conversationId: Optional[str] = None
    conversationType: ConversationType = "ai_tutor"
    action: str
    result: dict = Field(default_factory=dict)

