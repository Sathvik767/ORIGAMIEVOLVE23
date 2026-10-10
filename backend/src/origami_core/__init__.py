"""Framework-free domain library for OrigamiEvolve.

Nothing in this package may import FastAPI, PyMongo, Redis, or Celery.
Fitness values produced by plugins here are computational proxies unless a
plugin explicitly declares otherwise; see docs/PLAN.md section 0.
"""

__version__ = "0.1.0"
