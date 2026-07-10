"""长文生产线（long_form）与 text 产物模型测试。"""

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
from pixelle_video.pipelines import long_form as long_form_module
from pixelle_video.pipelines.long_form import LongFormPipeline, LongFormResult

LONG_FORM_SKELETON = "pipeline_long_form_base_v1"

MARKDOWN = "# 标题\n\n钩子段落。\n\n## 小节一\n正文正文。\n\n## 行动号召\n快去试试。"


class _FakeLLM:
    def __init__(self, response):
        self.response = response
        self.last_kwargs = None

    async def __call__(self, **kwargs):
        self.last_kwargs = kwargs
        return self.response


class _FakePersistence:
    def __init__(self):
        self.metadata = None

    async def save_task_metadata(self, task_id, metadata):
        self.metadata = metadata


class _FakeCore:
    def __init__(self, response=MARKDOWN):
        self.llm = _FakeLLM(response)
        self.tts = None
        self.media = None
        self.video = None
        self.persistence = _FakePersistence()


@pytest.fixture
def patched(monkeypatch, tmp_path):
    # 用不重试、不睡眠的版本替换 LLM 重试助手（真助手会退避 sleep）
    async def fake_retry(llm_service, *, attempts=3, **kwargs):
        return await llm_service(**kwargs)

    monkeypatch.setattr(
        "web.utils.script_review._call_llm_retrying_empty", fake_retry
    )
    monkeypatch.setattr(
        long_form_module,
        "create_task_output_dir",
        lambda: (str(tmp_path), "task-lf"),
    )
    yield tmp_path


@pytest.mark.asyncio
async def test_long_form_writes_article_and_returns_text(patched):
    tmp_path = patched
    core = _FakeCore()
    pipeline = LongFormPipeline(core)
    result = await pipeline(
        text="确认稿第一句。\n确认稿第二句。",
        title="我的标题",
        language="中文",
        word_count=1500,
        long_form_prompt="按 {word_count} 字写 {language} 长文，标题 {title}：\n{script}",
    )

    assert isinstance(result, LongFormResult)
    assert result.artifact_type == "text"
    assert result.article == MARKDOWN
    assert result.word_count == len(MARKDOWN)
    # 全文落盘
    assert (tmp_path / "article.md").read_text(encoding="utf-8") == MARKDOWN
    # 占位替换：script 注入了 prompt
    assert "确认稿第一句。" in core.llm.last_kwargs["prompt"]
    assert "{script}" not in core.llm.last_kwargs["prompt"]
    # 落了长文 metadata
    assert core.persistence.metadata["result"]["artifact_type"] == "text"


@pytest.mark.asyncio
async def test_long_form_uses_default_prompt_when_absent(patched):
    core = _FakeCore()
    pipeline = LongFormPipeline(core)
    await pipeline(text="确认稿。")
    # 默认提示词含 markdown 结构要求，且注入了确认稿
    assert "markdown" in core.llm.last_kwargs["prompt"].lower()
    assert "确认稿。" in core.llm.last_kwargs["prompt"]


@pytest.mark.asyncio
async def test_long_form_rejects_prompt_without_script_placeholder(patched):
    pipeline = LongFormPipeline(_FakeCore())
    with pytest.raises(ValueError, match=r"\{script\}"):
        await pipeline(text="确认稿。", long_form_prompt="没有占位符的提示词")


@pytest.mark.asyncio
async def test_long_form_rejects_empty_script(patched):
    pipeline = LongFormPipeline(_FakeCore())
    with pytest.raises(ValueError, match="确认稿"):
        await pipeline(text="   \n  ")


@pytest.mark.asyncio
async def test_long_form_rejects_empty_model_response(patched):
    pipeline = LongFormPipeline(_FakeCore(response="   "))
    with pytest.raises(ValueError, match="空内容"):
        await pipeline(text="确认稿。")


# --- 产物模型 text 兼容 ---


def test_generation_result_text_allows_null_primary_video():
    result = GenerationResult(
        task_id="t",
        pipeline_id="long_form",
        entry="script",
        artifact_type="text",
        artifacts=[
            GenerationArtifact(
                kind="metadata", path="/a.md", media_type="text/markdown", role="article"
            )
        ],
        primary_video=None,
    )
    assert result.artifact_type == "text"
    assert result.primary_video is None


# --- service 把 LongFormResult 转成 text GenerationResult ---


def _long_form_task() -> GenerationTask:
    request = GenerationRequest(
        pipeline_id="long_form",
        entry="script",
        input={"script": "确认稿。"},
        metadata={"production_template": {"id": LONG_FORM_SKELETON}},
    )
    return GenerationTask(
        task_id="task-1",
        pipeline_id="long_form",
        entry="script",
        request=request,
        progress=GenerationProgress(stage="write_article"),
    )


def test_service_converts_long_form_result_to_text():
    service = GenerationService(pipeline_registry=object())
    pipeline_result = LongFormResult(
        article=MARKDOWN,
        article_path="/tmp/article.md",
        title="标题",
        language="中文",
        word_count=len(MARKDOWN),
        task_id="task-1",
    )
    result = service._to_generation_result(_long_form_task(), pipeline_result)

    assert result.artifact_type == "text"
    assert result.primary_video is None
    assert result.artifacts[0].role == "article"
    assert result.artifacts[0].kind == "metadata"
    assert result.metadata["article"] == MARKDOWN
    assert result.metadata["title"] == "标题"
    assert result.metadata["language"] == "中文"
    assert result.metadata["production_template"]["id"] == LONG_FORM_SKELETON


# --- 注册（manifest + 骨架） ---


def test_long_form_manifest_registered_with_script_entry():
    manifests = {m.id: m for m in build_default_pipeline_manifests()}
    assert "long_form" in manifests
    manifest = manifests["long_form"]
    assert manifest.default_entry == "script"
    assert manifest.required_capabilities == ["llm", "persistence"]


def test_long_form_skeleton_registered_and_compiles():
    registry = build_default_production_template_registry()
    template = registry.get(LONG_FORM_SKELETON)
    assert template.pipeline_id == "long_form"
    assert template.entry == "script"
    assert template.enabled is True
    assert template.product_entry == "generate"
    assert "ffmpeg" not in template.required_capabilities
    assert "tts" not in template.required_capabilities
    # 长文提示词默认含 {script} 占位
    assert "{script}" in template.fixed_params["long_form_prompt"]

    request = registry.compile_request(
        LONG_FORM_SKELETON, input={"script": "确认稿。"}
    )
    assert request.pipeline_id == "long_form"
    assert request.entry == "script"
    assert request.params["word_count"] == 1800
