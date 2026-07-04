import pytest

from pixelle_video.pipelines.asset_based import AssetBasedPipeline
from pixelle_video.pipelines.linear import PipelineContext


class FakeCore:
    def __init__(self):
        self.image_analysis_calls = []
        self.llm = None
        self.tts = None
        self.media = None
        self.video = None

    async def image_analysis(self, asset_path, **kwargs):
        self.image_analysis_calls.append((asset_path, kwargs))
        return "A pet care image."


@pytest.mark.asyncio
async def test_asset_pipeline_passes_runninghub_instance_type_to_image_analysis(tmp_path):
    asset_path = tmp_path / "petwoods.jpg"
    asset_path.write_bytes(b"fake jpg bytes")
    core = FakeCore()
    pipeline = AssetBasedPipeline(core)
    pipeline._progress_callback = None
    context = PipelineContext(
        input_text="PetWoods daily care",
        params={
            "assets": [str(asset_path)],
            "source": "runninghub",
            "runninghub_instance_type": "plus",
        },
    )
    context.request = context.params

    await pipeline.setup_environment(context)

    assert core.image_analysis_calls == [
        (
            str(asset_path),
            {
                "source": "runninghub",
                "runninghub_instance_type": "plus",
            },
        )
    ]
