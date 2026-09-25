from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SmartLearn AI Platform"
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    openai_api_key: str
    openai_model: str

    db_user: str
    db_host: str
    db_name: str
    db_password: str
    db_port: int = 5432
    
    node_backend_url: str = "http://localhost:5000"

    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()