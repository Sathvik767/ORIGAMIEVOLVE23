"""Admin commands.

python -m origami_api.cli init-db
python -m origami_api.cli create-token <name>     # prints the token ONCE
python -m origami_api.cli list-tokens
python -m origami_api.cli revoke-token <name>
"""

import argparse
import sys
from datetime import UTC, datetime
from typing import Any

from pymongo import MongoClient

from origami_api.config import get_settings
from origami_api.db import ensure_indexes_sync
from origami_api.security import generate_token, hash_token


def _db() -> Any:
    settings = get_settings()
    client: MongoClient[Any] = MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=3000, tz_aware=True)
    return client[settings.mongo_db]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="origami_api.cli", description="OrigamiEvolve admin commands")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db", help="create MongoDB indexes")
    create = sub.add_parser("create-token", help="create an API token")
    create.add_argument("name")
    sub.add_parser("list-tokens")
    revoke = sub.add_parser("revoke-token")
    revoke.add_argument("name")
    args = parser.parse_args(argv)

    db = _db()
    if args.cmd == "init-db":
        ensure_indexes_sync(db)
        print("Indexes ensured.")
    elif args.cmd == "create-token":
        ensure_indexes_sync(db)
        if db.api_tokens.find_one({"name": args.name, "revoked_at": None}):
            print(f"An active token named {args.name!r} already exists; revoke it first.", file=sys.stderr)
            return 1
        token = generate_token()
        db.api_tokens.insert_one(
            {
                "name": args.name,
                "token_hash": hash_token(token),
                "created_at": datetime.now(UTC),
                "revoked_at": None,
            }
        )
        print(token)
        print("Store this token now; it cannot be shown again.", file=sys.stderr)
    elif args.cmd == "list-tokens":
        for t in db.api_tokens.find({}, {"token_hash": 0}).sort("created_at", 1):
            state = f"revoked {t['revoked_at']:%Y-%m-%d}" if t.get("revoked_at") else "active"
            print(f"{t['name']:<24} created {t['created_at']:%Y-%m-%d %H:%M}  {state}")
    elif args.cmd == "revoke-token":
        result = db.api_tokens.update_many(
            {"name": args.name, "revoked_at": None}, {"$set": {"revoked_at": datetime.now(UTC)}}
        )
        print(f"Revoked {result.modified_count} token(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
