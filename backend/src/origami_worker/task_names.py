"""Celery task names, importable without loading Celery (the API enqueues by name)."""

INGEST_DATASET = "origami.ingest.dataset"
OPTIMIZE_DESIGN = "origami.optimize.design"  # args: [job_id, attempt]
REAP_STALE_JOBS = "origami.maintenance.reap_stale_jobs"
VALIDATE_STRUCTURE = "origami.ingest.structure"  # args: [structure_id]
CONVERT_STRUCTURE = "origami.ingest.structure_convert"  # args: [structure_id, lattice]
SIMULATE_STRUCTURE = "origami.ingest.structure_simulate"  # args: [structure_id]
