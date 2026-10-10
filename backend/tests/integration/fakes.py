"""Async facade over mongomock so API code written for PyMongo's async API runs without a server.

Only the subset of the API the application uses is implemented. Tests marked `services`
exercise the same code against a real MongoDB.
"""

from typing import Any, ClassVar

import mongomock


class AsyncCursor:
    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor

    def sort(self, *args: Any, **kwargs: Any) -> "AsyncCursor":
        self._cursor = self._cursor.sort(*args, **kwargs)
        return self

    def limit(self, n: int) -> "AsyncCursor":
        self._cursor = self._cursor.limit(n)
        return self

    def skip(self, n: int) -> "AsyncCursor":
        self._cursor = self._cursor.skip(n)
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        docs = list(self._cursor)
        return docs if length is None else docs[:length]

    def __aiter__(self) -> "AsyncCursor":
        self._iter = iter(self._cursor)
        return self

    async def __anext__(self) -> dict[str, Any]:
        try:
            return next(self._iter)
        except StopIteration:
            raise StopAsyncIteration from None


class AsyncCollection:
    _ASYNC: ClassVar[frozenset[str]] = frozenset(
        {
            "insert_one",
            "insert_many",
            "find_one",
            "find_one_and_update",
            "update_one",
            "update_many",
            "delete_one",
            "delete_many",
            "count_documents",
            "create_index",
            "create_indexes",
        }
    )

    def __init__(self, coll: Any) -> None:
        self._coll = coll

    def find(self, *args: Any, **kwargs: Any) -> AsyncCursor:
        return AsyncCursor(self._coll.find(*args, **kwargs))

    def __getattr__(self, name: str) -> Any:
        if name not in self._ASYNC:
            raise AttributeError(name)
        method = getattr(self._coll, name)

        async def call(*args: Any, **kwargs: Any) -> Any:
            return method(*args, **kwargs)

        return call


class AsyncDatabase:
    def __init__(self, sync_db: Any) -> None:
        self.sync = sync_db

    def __getitem__(self, name: str) -> AsyncCollection:
        return AsyncCollection(self.sync[name])

    def __getattr__(self, name: str) -> AsyncCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        return AsyncCollection(self.sync[name])


def new_mongomock_db() -> Any:
    return mongomock.MongoClient(tz_aware=True)["origami_test"]
