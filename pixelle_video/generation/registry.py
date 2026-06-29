from collections.abc import Iterable, Mapping
from typing import Any

from pixelle_video.generation.schemas import PipelineManifest


class PipelineRegistry:
    def __init__(self):
        self._manifests: dict[str, PipelineManifest] = {}
        self._pipelines: dict[str, Any] = {}

    def register(self, manifest: PipelineManifest, pipeline: Any = None) -> None:
        if manifest.id in self._manifests:
            raise ValueError(f"Pipeline already registered: {manifest.id}")

        self._manifests[manifest.id] = manifest
        self._pipelines[manifest.id] = pipeline

    def pipeline_ids(self) -> list[str]:
        return list(self._manifests.keys())

    def list_manifests(self) -> list[PipelineManifest]:
        return list(self._manifests.values())

    def get_manifest(self, pipeline_id: str) -> PipelineManifest:
        try:
            return self._manifests[pipeline_id]
        except KeyError:
            raise KeyError(f"Unknown pipeline: {pipeline_id}") from None

    def get_pipeline(self, pipeline_id: str) -> Any:
        if pipeline_id not in self._manifests:
            raise KeyError(f"Unknown pipeline: {pipeline_id}")
        return self._pipelines[pipeline_id]


def build_pipeline_registry(
    manifests: Iterable[PipelineManifest],
    pipelines: Mapping[str, Any] | None = None,
) -> PipelineRegistry:
    registry = PipelineRegistry()
    pipeline_map = pipelines or {}

    for manifest in manifests:
        registry.register(manifest, pipeline=pipeline_map.get(manifest.id))

    return registry
