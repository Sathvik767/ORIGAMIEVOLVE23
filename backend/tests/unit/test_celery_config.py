from origami_worker.celery_app import celery_app
from origami_worker.tasks.maintenance import ping


def test_celery_is_json_only_and_retry_safe() -> None:
    conf = celery_app.conf
    assert conf.accept_content == ["json"]
    assert conf.task_serializer == "json"
    assert conf.task_acks_late is True
    assert conf.task_reject_on_worker_lost is True
    assert conf.worker_prefetch_multiplier == 1


def test_tasks_route_to_their_queue() -> None:
    router = celery_app.amqp.router
    assert router.route({}, "origami.optimize.run")["queue"].name == "optimize"
    assert router.route({}, "origami.ingest.parse")["queue"].name == "ingest"


def test_ping_task_runs_eagerly() -> None:
    assert ping.apply().get() == "pong"
