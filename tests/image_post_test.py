"""小红书图文帖管线（image_post）与图集产物模型测试。"""

import pytest

from pixelle_video.generation import build_default_production_template_registry
from pixelle_video.generation.defaults import build_default_pipeline_manifests
from pixelle_video.generation.schemas import (
    GenerationArtifact,
    GenerationProgress,
    GenerationRequest,
    GenerationResult,
    GenerationTask,
)
from pixelle_video.generation.service import GenerationService
from pixelle_video.pipelines import image_post as image_post_module
from pixelle_video.pipelines.image_post import (
    MAX_BODY_PAGES,
    ImagePostPipeline,
    ImagePostResult,
)

IMAGE_POST_SKELETON = "pipeline_image_post_base_v1"


# --- 假 core / frame_processor（不触真 LLM / ComfyUI / 浏览器） ---


class _FakeFrameProcessor:
    def __init__(self):
        self.media_calls = 0
        self.compose_calls = 0

    async def _step_generate_media(self, frame, config):
        self.media_calls += 1
        frame.media_type = "image"
        frame.image_path = f"/tmp/img_{frame.index}.png"

    async def _compose_frame_html(self, frame, storyboard, config, output_path):
        self.compose_calls += 1
        return output_path


class _FakePersistence:
    def __init__(self):
        self.metadata = None

    async def save_task_metadata(self, task_id, metadata):
        self.metadata = metadata

    async def save_storyboard(self, task_id, storyboard):
        pass


class _FakeCore:
    def __init__(self):
        self.llm = object()
        self.tts = object()
        self.media = object()
        self.video = object()
        self.frame_processor = _FakeFrameProcessor()
        self.persistence = _FakePersistence()


@pytest.fixture
def patched_generators(monkeypatch, tmp_path):
    async def fake_split(script, split_mode="paragraph"):
        return [line for line in script.split("\n") if line.strip()]

    async def fake_prompts(llm, narrations, **kwargs):
        return [f"prompt::{n}" for n in narrations]

    async def fake_title(llm, content, strategy="auto", max_length=15):
        return "自动标题"

    monkeypatch.setattr(image_post_module, "split_narration_script", fake_split)
    monkeypatch.setattr(image_post_module, "generate_image_prompts", fake_prompts)
    monkeypatch.setattr(image_post_module, "generate_title", fake_title)
    monkeypatch.setattr(
        image_post_module, "build_image_prompt", lambda p, prefix="": f"{prefix}{p}"
    )
    monkeypatch.setattr(
        image_post_module,
        "create_task_output_dir",
        lambda: (str(tmp_path), "task-xyz"),
    )
    monkeypatch.setattr(
        image_post_module,
        "get_task_frame_path",
        lambda task_id, idx, kind: str(tmp_path / f"{kind}_{idx}.png"),
    )
    yield


@pytest.mark.asyncio
async def test_image_post_produces_cover_and_one_page_per_line(patched_generators):
    core = _FakeCore()
    pipeline = ImagePostPipeline(core)
    result = await pipeline(text="第一行\n第二行\n第三行", title="我的标题")

    assert isinstance(result, ImagePostResult)
    assert result.artifact_type == "image_set"
    assert result.page_count == 3
    # 封面在首，其后每行一页
    assert len(result.image_paths) == 4
    assert result.cover_path == result.image_paths[0]
    assert result.caption == "第一行\n第二行\n第三行"
    assert result.title == "我的标题"
    # 3 页正文 + 1 封面 = 4 次配图与 4 次版式渲染
    assert core.frame_processor.media_calls == 4
    assert core.frame_processor.compose_calls == 4
    # 落了图集 metadata
    assert core.persistence.metadata["result"]["artifact_type"] == "image_set"


@pytest.mark.asyncio
async def test_image_post_auto_titles_when_missing(patched_generators):
    pipeline = ImagePostPipeline(_FakeCore())
    result = await pipeline(text="只有一行")
    assert result.title == "自动标题"
    assert result.page_count == 1


@pytest.mark.asyncio
async def test_image_post_rejects_over_page_cap(patched_generators):
    pipeline = ImagePostPipeline(_FakeCore())
    script = "\n".join(f"第{i}行" for i in range(MAX_BODY_PAGES + 1))
    with pytest.raises(ValueError, match="超过小红书上限"):
        await pipeline(text=script)


@pytest.mark.asyncio
async def test_image_post_rejects_empty_script(patched_generators):
    pipeline = ImagePostPipeline(_FakeCore())
    with pytest.raises(ValueError, match="没有可用的正文"):
        await pipeline(text="   \n  ")


# --- 产物模型向后兼容 ---


def test_generation_result_defaults_to_video_without_artifact_type():
    result = GenerationResult(
        task_id="t",
        pipeline_id="standard",
        entry="script",
        artifacts=[GenerationArtifact(kind="video", path="/v.mp4")],
        primary_video=GenerationArtifact(kind="video", path="/v.mp4"),
    )
    assert result.artifact_type == "video"
    assert result.primary_video is not None


def test_generation_result_image_set_allows_null_primary_video():
    result = GenerationResult(
        task_id="t",
        pipeline_id="image_post",
        entry="script",
        artifact_type="image_set",
        artifacts=[
            GenerationArtifact(kind="image", path="/c.png", role="cover"),
            GenerationArtifact(kind="image", path="/p1.png", role="page"),
        ],
        primary_video=None,
    )
    assert result.artifact_type == "image_set"
    assert result.primary_video is None


# --- service 把 ImagePostResult 转成 image_set GenerationResult ---


def _image_post_task() -> GenerationTask:
    request = GenerationRequest(
        pipeline_id="image_post",
        entry="script",
        input={"script": "a\nb"},
        metadata={"production_template": {"id": IMAGE_POST_SKELETON}},
    )
    return GenerationTask(
        task_id="task-1",
        pipeline_id="image_post",
        entry="script",
        request=request,
        progress=GenerationProgress(stage="paginate"),
    )


def test_service_converts_image_post_result_to_image_set():
    service = GenerationService(pipeline_registry=object())
    pipeline_result = ImagePostResult(
        artifact_type="image_set",
        image_paths=["/cover.png", "/p0.png", "/p1.png"],
        cover_path="/cover.png",
        page_paths=["/p0.png", "/p1.png"],
        caption="全文文案",
        title="标题",
        page_count=2,
        task_id="task-1",
    )
    result = service._to_generation_result(_image_post_task(), pipeline_result)

    assert result.artifact_type == "image_set"
    assert result.primary_video is None
    assert [a.path for a in result.artifacts] == ["/cover.png", "/p0.png", "/p1.png"]
    assert result.artifacts[0].role == "cover"
    assert result.artifacts[1].role == "page"
    assert result.metadata["caption"] == "全文文案"
    assert result.metadata["page_count"] == 2
    # 溯源 metadata 透传
    assert result.metadata["production_template"]["id"] == IMAGE_POST_SKELETON


# --- 注册（管线 manifest + 生产模板骨架） ---


def test_image_post_manifest_registered_with_script_entry():
    manifests = {m.id: m for m in build_default_pipeline_manifests()}
    assert "image_post" in manifests
    manifest = manifests["image_post"]
    assert manifest.default_entry == "script"
    assert "ffmpeg" not in manifest.required_capabilities
    assert "tts" not in manifest.required_capabilities


def test_image_post_skeleton_registered_and_compiles():
    registry = build_default_production_template_registry()
    template = registry.get(IMAGE_POST_SKELETON)
    assert template.pipeline_id == "image_post"
    assert template.entry == "script"
    assert template.enabled is True
    assert template.product_entry == "generate"
    # 无 ffmpeg/tts 依赖
    assert "ffmpeg" not in template.required_capabilities
    assert "tts" not in template.required_capabilities
    # compose_runtime 不在图文线白名单（排版渲染非视频合成）
    assert "compose_runtime" not in template.allowed_user_params

    request = registry.compile_request(
        IMAGE_POST_SKELETON, input={"script": "第一行\n第二行"}
    )
    assert request.pipeline_id == "image_post"
    assert request.entry == "script"
    assert request.input == {"script": "第一行\n第二行"}
    assert request.params["split_mode"] == "line"
