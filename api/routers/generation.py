from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.dependencies import PixelleVideoDep
from pixelle_video.generation import PipelineManifest

router = APIRouter(prefix="/generation", tags=["Generation Pipelines"])


class PipelineListResponse(BaseModel):
    default_pipeline: str | None
    pipelines: list[PipelineManifest]


@router.get("/pipelines", response_model=PipelineListResponse)
async def list_generation_pipelines(pixelle_video: PixelleVideoDep):
    manifests = pixelle_video.pipeline_registry.list_manifests()
    default_pipeline = "standard" if "standard" in pixelle_video.pipeline_registry.pipeline_ids() else None

    return PipelineListResponse(
        default_pipeline=default_pipeline,
        pipelines=manifests,
    )


@router.get("/pipelines/{pipeline_id}", response_model=PipelineManifest)
async def get_generation_pipeline(pipeline_id: str, pixelle_video: PixelleVideoDep):
    try:
        return pixelle_video.pipeline_registry.get_manifest(pipeline_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown pipeline: {pipeline_id}") from None
