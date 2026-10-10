from datetime import UTC, datetime
from typing import Annotated, Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, Query

Limit = Annotated[int, Query(ge=1, le=100)]
Cursor = Annotated[str | None, Query(max_length=24)]


def now() -> datetime:
    return datetime.now(UTC)


def parse_oid(value: str | None, *, not_found: str = "Not found") -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(404, not_found) from None


def parse_cursor(cursor: str | None) -> ObjectId | None:
    if cursor is None:
        return None
    try:
        return ObjectId(cursor)
    except InvalidId:
        raise HTTPException(422, "Invalid cursor") from None


def next_cursor(items: list[dict[str, Any]], limit: int) -> str | None:
    return str(items[-1]["_id"]) if len(items) == limit else None
