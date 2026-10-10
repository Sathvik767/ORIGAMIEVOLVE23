from origami_worker.celery_app import celery_app


@celery_app.task(name="origami.maintenance.ping")
def ping() -> str:
    """Smoke-test task used to verify the broker and worker are wired up."""
    return "pong"
