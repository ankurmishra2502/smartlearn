from fastapi import FastAPI

from app.api.routes import router
from app.api.quiz_routes import router as quiz_router
from app.api.ai_tutor_routes import router as ai_tutor_router
from app.core.config import settings


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
)

# Existing generic AI routes
app.include_router(router)

# V2 Quiz AI routes
app.include_router(quiz_router)

# AI Tutor routes
app.include_router(ai_tutor_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
    }