import subprocess
import sys

FORBIDDEN = ("fastapi", "pymongo", "redis", "celery", "starlette")


def test_core_library_imports_no_framework_or_service_clients() -> None:
    """origami_core must stay testable without the API, database, or queue."""
    code = (
        "import sys, pkgutil, importlib, origami_core\n"
        "for m in pkgutil.walk_packages(origami_core.__path__, 'origami_core.'):\n"
        "    importlib.import_module(m.name)\n"
        f"print(','.join(sorted(n for n in {FORBIDDEN!r} if n in sys.modules)))\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)  # noqa: S603
    assert out.stdout.strip() == ""
