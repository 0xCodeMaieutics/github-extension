FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DB_PATH=/data/deliveries.sqlite3 \
    PORT=8083

RUN useradd --system --uid 10001 --home-dir /app app \
    && mkdir -p /data && chown app:app /data

WORKDIR /app
COPY app.py .

USER app
VOLUME ["/data"]
EXPOSE 8083

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8083/healthz', timeout=2)"]

CMD ["python", "app.py"]
