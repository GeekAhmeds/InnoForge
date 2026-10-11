# InnoForge License Server. Build from the repository root so editions.json is included:
#   docker build -f apps/license-server/Dockerfile -t innoforge-licenses .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    EDITIONS_FILE=/app/editions.json LICENSE_KEYS_DIR=/data/keys
WORKDIR /app
COPY apps/license-server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/license-server/ .
COPY apps/pos/electron/editions.json /app/editions.json
RUN DJANGO_SECRET_KEY=build python manage.py collectstatic --noinput
RUN useradd -r -u 10001 app && mkdir -p /data/keys && chown -R app /data
USER app
EXPOSE 8000
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi -b 0.0.0.0:8000 -w ${WEB_WORKERS:-3} --access-logfile -"]
