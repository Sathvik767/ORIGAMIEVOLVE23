from pathlib import Path

import pytest

from origami_core.storage import InvalidStorageKey, LocalStorage


def test_write_is_atomic_and_readable(tmp_path: Path) -> None:
    store = LocalStorage(tmp_path)
    with store.open_write("raw/abc/file.csv") as fh:
        fh.write(b"hello")
        assert not store.exists("raw/abc/file.csv")  # not visible until committed
    assert store.exists("raw/abc/file.csv")
    assert store.size("raw/abc/file.csv") == 5
    with store.open_read("raw/abc/file.csv") as fh:
        assert fh.read() == b"hello"


def test_failed_write_leaves_nothing_behind(tmp_path: Path) -> None:
    store = LocalStorage(tmp_path)
    with pytest.raises(RuntimeError), store.open_write("raw/x.bin") as fh:
        fh.write(b"partial")
        raise RuntimeError("boom")
    assert not store.exists("raw/x.bin")
    assert list((tmp_path / "raw").iterdir()) == []


def test_move_and_delete(tmp_path: Path) -> None:
    store = LocalStorage(tmp_path)
    with store.open_write("tmp/u1.partial") as fh:
        fh.write(b"x")
    store.move("tmp/u1.partial", "raw/d1/abc.csv")
    assert store.exists("raw/d1/abc.csv") and not store.exists("tmp/u1.partial")
    store.delete("raw/d1/abc.csv")
    store.delete("raw/d1/abc.csv")  # idempotent
    assert not store.exists("raw/d1/abc.csv")


@pytest.mark.parametrize("key", ["../etc/passwd", "/abs", "raw/../../x", "Raw/Upper", "", "raw//x", "a\\b"])
def test_rejects_unsafe_keys(tmp_path: Path, key: str) -> None:
    with pytest.raises(InvalidStorageKey):
        LocalStorage(tmp_path).exists(key)
