from fastapi import APIRouter, HTTPException, Request

from origami_api.routers.common import parse_oid
from origami_api.schemas import DesignOut, design_out
from origami_api.security import CurrentPrincipal

router = APIRouter(prefix="/designs", tags=["designs"])


@router.get("/{design_id}", response_model=DesignOut)
async def get_design(request: Request, _: CurrentPrincipal, design_id: str) -> DesignOut:
    db = request.app.state.db
    doc = await db.designs.find_one({"_id": parse_oid(design_id)})
    if doc is None or await db.datasets.count_documents({"_id": doc["dataset_id"], "deleted_at": None}) == 0:
        raise HTTPException(404, "Design not found")
    return design_out(doc)
