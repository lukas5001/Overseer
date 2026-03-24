FROM python:3.12-slim

WORKDIR /app

COPY ai_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY ai_service/ ./ai_service/

EXPOSE 8002
CMD ["uvicorn", "ai_service.app.main:app", "--host", "0.0.0.0", "--port", "8002"]
