import json
from types import SimpleNamespace

import pytest

from pixelle_video.pipelines.linear import PipelineContext
from pixelle_video.pipelines.standard import StandardPipeline


@pytest.mark.asyncio
@pytest.mark.parametrize("scene_count", [2, 6])
async def test_standard_pipeline_lets_scene_llm_choose_scene_count(scene_count):
    calls = []

    async def llm(**kwargs):
        calls.append(kwargs)
        return json.dumps({"narrations": [f"Scene {index + 1}" for index in range(scene_count)]})

    core = SimpleNamespace(llm=llm, tts=None, media=None, video=None)
    pipeline = StandardPipeline(core)
    context = PipelineContext(
        input_text="A complete confirmed script with several narrative turns.",
        params={
            "split_template_name": "Copy-Safe Scene Split",
            "split_model": "scene-planner-model",
            "_split_language": "English",
            "_split_topic": "Why cats like boxes",
        },
    )

    await pipeline.generate_content(context)

    assert context.narrations == [f"Scene {index + 1}" for index in range(scene_count)]
    assert calls[0]["model"] == "scene-planner-model"
    assert "A complete confirmed script" in calls[0]["prompt"]
    assert "n_scenes" not in context.params
