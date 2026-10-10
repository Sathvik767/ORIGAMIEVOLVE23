from celery import Celery

from origami_api.config import Settings, get_settings
from origami_worker.task_names import REAP_STALE_JOBS

QUEUES = ("ingest", "optimize", "maintenance")


def create_celery(settings: Settings | None = None) -> Celery:
    settings = settings or get_settings()
    app = Celery(
        "origami_evolve",
        broker=settings.redis_url,
        include=[
            "origami_worker.tasks.maintenance",
            "origami_worker.tasks.ingest",
            "origami_worker.tasks.optimize",
            "origami_worker.tasks.structure",
        ],
    )
    app.conf.update(
        # JSON only: never deserialize pickled payloads from the broker.
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        # Job state lives in MongoDB; Celery results are not used.
        task_ignore_result=True,
        # Redeliver tasks from crashed workers; tasks must be idempotent (docs/PLAN.md section 5.4).
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
        # Default process count; Compose passes --concurrency per worker (ORIGAMI_OPTIMIZE_CONCURRENCY).
        worker_concurrency=settings.optimize_concurrency,
        task_default_queue="maintenance",
        task_routes={f"origami.{q}.*": {"queue": q} for q in QUEUES},
        broker_connection_retry_on_startup=True,
        timezone="UTC",
        enable_utc=True,
        beat_schedule={
            "reap-stale-jobs": {"task": REAP_STALE_JOBS, "schedule": float(settings.reaper_interval_s)},
        },
    )
    return app


celery_app = create_celery()
