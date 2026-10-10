from pathlib import Path

import pytest

from origami_api.config import Settings


def test_defaults_are_local_and_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(Path(__file__).parent)  # no .env here
    s = Settings()
    assert s.env == "development"
    assert s.cors_origin_list == ["http://localhost:5173"]


def test_reads_prefixed_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORIGAMI_MONGO_DB", "other")
    monkeypatch.setenv("ORIGAMI_CORS_ORIGINS", "http://a.test, http://b.test ,")
    s = Settings()
    assert s.mongo_db == "other"
    assert s.cors_origin_list == ["http://a.test", "http://b.test"]


def test_rejects_unknown_env_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORIGAMI_ENV", "staging")
    with pytest.raises(ValueError):
        Settings()
