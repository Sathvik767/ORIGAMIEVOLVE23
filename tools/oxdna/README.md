# oxDNA (optional)

Put a **Linux** oxDNA executable here as `oxDNA`. It must match the container architecture (`docker compose exec api uname -m`).
Build it from https://github.com/lorenzo-rovigatti/oxDNA:

    cmake .. && make      # in a build/ folder on Linux or WSL; the binary is build/bin/oxDNA

Then set `ORIGAMI_OXDNA_BIN=/opt/oxdna/oxDNA` in `.env` and run `docker compose --profile full up -d`.
Check: `GET /api/v1/structures/tools` should report `"oxdna": {"available": true}`.
