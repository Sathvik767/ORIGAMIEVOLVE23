from functools import lru_cache
from typing import Any

from pymongo import MongoClient

from origami_api.config import get_settings
from origami_core.storage import LocalStorage


@lru_cache
def get_db() -> Any:
    """Created lazily inside each worker process (after fork), never at import time."""
    settings = get_settings()
    client: MongoClient[Any] = MongoClient(settings.mongo_uri, tz_aware=True)
    return client[settings.mongo_db]


@lru_cache
def get_storage() -> LocalStorage:
    return LocalStorage(get_settings().storage_root)
