import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO

from origami_core.storage.base import InvalidStorageKey, validate_key


class LocalStorage:
    """StorageBackend on a local directory (a Docker volume in Compose)."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / validate_key(key)).resolve()
        if not path.is_relative_to(self.root):
            raise InvalidStorageKey(key)
        return path

    @contextmanager
    def open_write(self, key: str) -> Iterator[BinaryIO]:
        final = self._path(key)
        final.parent.mkdir(parents=True, exist_ok=True)
        partial = final.with_name(f".{final.name}.{uuid.uuid4().hex}.partial")
        try:
            with partial.open("wb") as fh:
                yield fh
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(partial, final)
        finally:
            partial.unlink(missing_ok=True)

    @contextmanager
    def open_read(self, key: str) -> Iterator[BinaryIO]:
        with self._path(key).open("rb") as fh:
            yield fh

    def move(self, src: str, dst: str) -> None:
        target = self._path(dst)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(self._path(src), target)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def size(self, key: str) -> int:
        return self._path(key).stat().st_size

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)
