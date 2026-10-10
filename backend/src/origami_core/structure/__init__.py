"""Real DNA origami structure files (M7).

Supported:
  * oxDNA topology + configuration (classic and "new" 5'->3' topology): per-nucleotide coordinates,
    used exactly as stored. This is the only source of molecular coordinates.
  * caDNAno 2 JSON: lattice/strand topology only (no coordinates, no sequences). Coordinates can be
    produced from it only by an external converter (tacoxDNA), never by OrigamiEvolve itself.
"""

from origami_core.structure.cadnano import CadnanoSummary, parse_cadnano
from origami_core.structure.common import StructureError, StructureIssue, StructureLimits
from origami_core.structure.mapping import StapleMapping, map_design
from origami_core.structure.oxdna import OxdnaStructure, parse_oxdna, viewer_geometry

__all__ = [
    "CadnanoSummary",
    "OxdnaStructure",
    "StapleMapping",
    "StructureError",
    "StructureIssue",
    "StructureLimits",
    "map_design",
    "parse_cadnano",
    "parse_oxdna",
    "viewer_geometry",
]
