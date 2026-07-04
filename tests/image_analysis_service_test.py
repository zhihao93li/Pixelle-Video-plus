import pytest
from comfykit.comfyui.models import ExecuteResult

import pixelle_video.services.image_analysis as image_analysis_module
from pixelle_video.services.image_analysis import ImageAnalysisService


class SharedKitShouldNotBeUsed:
    async def _get_or_create_comfykit(self):
        raise AssertionError("per-call RunningHub override should not use the shared ComfyKit")


@pytest.mark.asyncio
async def test_image_analysis_uses_per_call_runninghub_instance_type(monkeypatch, tmp_path):
    image_path = tmp_path / "petwoods.jpg"
    image_path.write_bytes(b"fake jpg bytes")
    created_configs = []
    executed = []
    closed = []

    class FakeComfyKit:
        def __init__(self, **config):
            created_configs.append(config)

        async def execute(self, workflow_input, workflow_params):
            executed.append((workflow_input, workflow_params))
            return ExecuteResult(status="completed", texts=["Detailed pet image description."])

        async def close(self):
            closed.append(True)

    monkeypatch.setattr(image_analysis_module, "ComfyKit", FakeComfyKit)
    service = ImageAnalysisService(
        {
            "comfyui": {
                "comfyui_url": "http://127.0.0.1:8188",
                "runninghub_api_key": "test-key",
            }
        },
        core=SharedKitShouldNotBeUsed(),
    )

    description = await service(
        str(image_path),
        source="runninghub",
        runninghub_instance_type="plus",
    )

    assert description == "Detailed pet image description."
    assert created_configs == [
        {
            "comfyui_url": "http://127.0.0.1:8188",
            "runninghub_api_key": "test-key",
            "runninghub_instance_type": "plus",
        }
    ]
    assert executed == [("1996069253201739777", {"image": str(image_path)})]
    assert closed == [True]
