from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.dependencies import GenerationServiceDep, PixelleVideoDep
from pixelle_video.generation import (
    GenerationRequest,
    GenerationResult,
    GenerationTask,
    PipelineManifest,
)

router = APIRouter(prefix="/generation", tags=["Generation Pipelines"])


class PipelineListResponse(BaseModel):
    default_pipeline: str | None
    pipelines: list[PipelineManifest]


class GenerationSubmitResponse(BaseModel):
    success: bool = True
    message: str = "Generation task created successfully"
    generation_task_id: str
    task: GenerationTask


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


@router.post("/tasks", response_model=GenerationSubmitResponse)
async def submit_generation_task(
    request_body: GenerationRequest,
    generation_service: GenerationServiceDep,
):
    try:
        task = generation_service.submit(request_body)
        return GenerationSubmitResponse(
            generation_task_id=task.task_id,
            task=task,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.get("/tasks/{task_id}", response_model=GenerationTask)
async def get_generation_task(task_id: str, generation_service: GenerationServiceDep):
    try:
        return generation_service.get_task(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Generation task not found: {task_id}") from None


@router.get("/tasks/{task_id}/result", response_model=GenerationResult)
async def get_generation_task_result(task_id: str, generation_service: GenerationServiceDep):
    try:
        return generation_service.get_result(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Generation task not found: {task_id}") from None
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.delete("/tasks/{task_id}", response_model=GenerationTask)
async def cancel_generation_task(task_id: str, generation_service: GenerationServiceDep):
    try:
        return generation_service.cancel_task(task_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Generation task not found: {task_id}") from None
