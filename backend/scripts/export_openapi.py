"""Write the API's OpenAPI schema to stdout or a file (used to generate frontend types).

python scripts/export_openapi.py ../frontend/src/api/openapi.json
"""

import json
import sys
from pathlib import Path

from origami_api.config import Settings
from origami_api.main import create_app


def main() -> None:
    schema = json.dumps(create_app(Settings(env="test")).openapi(), indent=2, sort_keys=True) + "\n"
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(schema, encoding="utf-8")
    else:
        sys.stdout.write(schema)


if __name__ == "__main__":
    main()
