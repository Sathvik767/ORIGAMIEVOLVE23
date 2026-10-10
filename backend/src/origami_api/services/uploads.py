"""Stream a request body to storage with a hard byte limit, computing SHA-256 on the way.

The body is never held in memory and never spooled anywhere except the storage tmp/ area,
which is why uploads are raw request bodies rather than multipart forms (Starlette parses
multipart fully, to an unbounded temp file, before the handler runs).
"""

import asyncio
import hashlib
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from origami_core.storage import StorageBackend

SNIFF_BYTES = 4096


class UploadTooLarge(Exception):
    pass


@dataclass(frozen=True)
class StoredUpload:
    tmp_key: str
    size_bytes: int
    sha256: str
    prefix: bytes


async def stream_to_storage(
    chunks: AsyncIterator[bytes], storage: StorageBackend, *, max_bytes: int, buffer_bytes: int
) -> StoredUpload:
    tmp_key = f"tmp/{uuid.uuid4().hex}.upload"
    digest = hashlib.sha256()
    size = 0
    prefix = bytearray()
    buffer = bytearray()
    try:
        with storage.open_write(tmp_key) as fh:
            async for chunk in chunks:
                size += len(chunk)
                if size > max_bytes:
                    raise UploadTooLarge
                digest.update(chunk)
                if len(prefix) < SNIFF_BYTES:
                    prefix += chunk[: SNIFF_BYTES - len(prefix)]
                buffer += chunk
                if len(buffer) >= buffer_bytes:
                    await asyncio.to_thread(fh.write, bytes(buffer))
                    buffer.clear()
            if buffer:
                await asyncio.to_thread(fh.write, bytes(buffer))
    except BaseException:
        storage.delete(tmp_key)
        raise
    return StoredUpload(tmp_key, size, digest.hexdigest(), bytes(prefix))
