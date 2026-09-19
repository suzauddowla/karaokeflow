FROM python:3.11-slim

# Install system dependencies (ffmpeg is recommended for audio format handling)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy application source
COPY backend /app/backend
COPY frontend /app/frontend

ENV PYTHONUNBUFFERED=1
ENV PORT=5000

EXPOSE 5000

# Start production gunicorn server
CMD exec gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 2 --threads 4 --timeout 120 backend.server:app
