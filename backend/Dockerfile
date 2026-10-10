# syntax=docker/dockerfile:1
FROM python:3.12-slim AS build
WORKDIR /build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY backend/pyproject.toml ./
COPY backend/src ./src
RUN python -m venv /venv && /venv/bin/pip install .

FROM python:3.12-slim
ENV PATH="/venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    ORIGAMI_STORAGE_ROOT=/data
RUN useradd --create-home --uid 10001 origami && mkdir -p /data && chown origami:origami /data
COPY --from=build /venv /venv
USER origami
WORKDIR /home/origami
EXPOSE 8000
CMD ["uvicorn", "origami_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
