import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from celery import Celery

# (task_name, *task_args) -> enqueued. Raises if the broker is unreachable.
Dispatch = Callable[..., Awaitable[None]]


def celery_dispatch(app: Celery) -> Dispatch:
    async def dispatch(task_name: str, *args: Any) -> None:
        # Bounded retries so an unreachable broker fails the request quickly instead of hanging it.
        await asyncio.to_thread(
            app.send_task,
            task_name,
            args=list(args),
            retry=True,
            retry_policy={"max_retries": 2, "interval_start": 0, "interval_step": 0.5, "interval_max": 1},
        )

    return dispatch
