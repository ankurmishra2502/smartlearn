from pydantic import BaseModel, Field


class AIRunRequest(BaseModel):
    user_id: str
    request: str = Field(min_length=1)


class AIRunResponse(BaseModel):
    run_id: str
    intent: str
    response: str