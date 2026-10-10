"""Bearer API tokens. Tokens are 256-bit random values, so a fast SHA-256 hash at rest is sufficient
(no password-style KDF needed); only the hash is stored."""

import hashlib
import secrets
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

TOKEN_PREFIX = "oe_"  # noqa: S105 - public prefix, not a secret


def generate_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class Principal:
    token_id: str
    name: str


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(401, detail, headers={"WWW-Authenticate": "Bearer"})


async def require_principal(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> Principal:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("Missing bearer token")
    if any(c.isspace() for c in token.strip()):
        # Usually extra text captured with the token (e.g. the CLI's advisory line via a TTY). Still rejected.
        raise _unauthorized("Malformed bearer token: it contains spaces. Send only the oe_... value.")
    doc = await request.app.state.db.api_tokens.find_one(
        {"token_hash": hash_token(token.strip()), "revoked_at": None}
    )
    if doc is None:
        raise _unauthorized("Invalid or revoked token")
    return Principal(token_id=str(doc["_id"]), name=doc["name"])


CurrentPrincipal = Annotated[Principal, Depends(require_principal)]
