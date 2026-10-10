"""MongoDB index definitions, shared by the API (async) and the CLI/worker (sync)."""

from typing import Any

from pymongo import ASCENDING, DESCENDING, IndexModel

SCHEMA_VERSION = 1

INDEXES: dict[str, list[IndexModel]] = {
    "datasets": [
        # Present only while the dataset is active, so a soft-deleted upload can be re-uploaded.
        IndexModel([("dedupe_key", ASCENDING)], unique=True, sparse=True, name="dedupe_key_unique"),
        IndexModel([("deleted_at", ASCENDING), ("created_at", DESCENDING)], name="active_by_created"),
    ],
    "designs": [
        IndexModel(
            [("dataset_id", ASCENDING), ("external_id", ASCENDING)], unique=True, name="dataset_external_id"
        ),
    ],
    "jobs": [
        IndexModel([("dataset_id", ASCENDING), ("type", ASCENDING)], name="dataset_type"),
        IndexModel([("status", ASCENDING), ("heartbeat_at", ASCENDING)], name="status_heartbeat"),
        IndexModel([("batch_id", ASCENDING), ("status", ASCENDING)], name="batch_status"),
        # One job per design per batch (ingest jobs lack both fields and are skipped by `sparse`).
        IndexModel(
            [("batch_id", ASCENDING), ("design_id", ASCENDING)], unique=True, sparse=True, name="batch_design"
        ),
    ],
    "structures": [
        IndexModel([("design_id", ASCENDING), ("created_at", DESCENDING)], name="design_created"),
    ],
    "batches": [
        IndexModel([("idempotency_key", ASCENDING)], unique=True, sparse=True, name="idempotency_key_unique"),
        IndexModel([("created_at", DESCENDING)], name="created"),
    ],
    "job_events": [IndexModel([("job_id", ASCENDING), ("at", ASCENDING)], name="job_at")],
    "api_tokens": [IndexModel([("token_hash", ASCENDING)], unique=True, name="token_hash_unique")],
}


async def ensure_indexes_async(db: Any) -> None:
    for name, models in INDEXES.items():
        await db[name].create_indexes(models)


def ensure_indexes_sync(db: Any) -> None:
    for name, models in INDEXES.items():
        db[name].create_indexes(models)
