"""Read-only Pixelle operations API."""

from fastapi import APIRouter, HTTPException

from api.schemas.ops import OpsCurrentResponse, OpsExperimentResponse
from ops.service import OpsError, OpsService

router = APIRouter(prefix="/ops", tags=["Ops"])


@router.get("/current", response_model=OpsCurrentResponse)
async def get_current_ops_view():
    return OpsService().current_view()


@router.get("/experiments/{experiment_id}", response_model=OpsExperimentResponse)
async def get_ops_experiment(experiment_id: str):
    try:
        return OpsService().get_experiment_view(experiment_id)
    except OpsError as exc:
        _raise_ops_error(exc)


def _raise_ops_error(exc: OpsError) -> None:
    status_code = 404 if exc.code.endswith("_not_found") else 400
    raise HTTPException(
        status_code=status_code,
        detail={
            "status": "error",
            "error": {"code": exc.code, "message": exc.message},
        },
    ) from exc
