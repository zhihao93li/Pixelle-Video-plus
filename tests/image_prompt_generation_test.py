import pytest

from pixelle_video.prompts.image_generation import (
    IMAGE_PROMPT_GENERATION_PROMPT,
    build_image_prompt_prompt,
)
from pixelle_video.utils.content_generators import generate_image_prompts


class CapturingLLM:
    def __init__(self, responses):
        self.responses = list(responses)
        self.prompts = []

    async def __call__(self, *, prompt, temperature, max_tokens):
        self.prompts.append(prompt)
        return self.responses.pop(0)


def test_default_image_prompt_prompt_includes_full_context_and_current_batch():
    prompt = build_image_prompt_prompt(
        narrations=["scene one", "scene two"],
        min_words=30,
        max_words=60,
        all_narrations=["scene one", "scene two", "scene three"],
    )

    assert "Full Storyboard Context" in prompt
    assert "Current Batch To Generate" in prompt
    assert '"all_narrations"' in prompt
    assert '"current_batch_narrations"' in prompt
    assert "scene three" in prompt


@pytest.mark.asyncio
async def test_visual_context_enters_llm_request_but_is_not_directly_concatenated():
    visual_context = "Use the same red-haired protagonist in every frame."
    llm = CapturingLLM(['{"image_prompts": ["A quiet library scene at dusk."]}'])

    result = await generate_image_prompts(
        llm,
        narrations=["The character enters a library."],
        visual_context=visual_context,
    )

    assert result == ["A quiet library scene at dusk."]
    assert visual_context in llm.prompts[0]
    assert visual_context not in result[0]


def test_custom_generation_rules_override_default_rules():
    custom_rules = "CUSTOM IMAGE PROMPT RULES: use concise cinematic English only."

    prompt = build_image_prompt_prompt(
        narrations=["scene one"],
        min_words=30,
        max_words=60,
        generation_rules=custom_rules,
    )

    assert custom_rules in prompt
    assert IMAGE_PROMPT_GENERATION_PROMPT.splitlines()[0] not in prompt
    assert "Current Batch To Generate" in prompt


@pytest.mark.asyncio
async def test_each_batch_receives_full_storyboard_context():
    narrations = [f"scene {idx}" for idx in range(1, 13)]
    llm = CapturingLLM(
        [
            '{"image_prompts": ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"]}',
            '{"image_prompts": ["p11", "p12"]}',
        ]
    )

    result = await generate_image_prompts(llm, narrations=narrations, batch_size=10)

    assert result == [f"p{idx}" for idx in range(1, 13)]
    assert len(llm.prompts) == 2
    assert '"all_narrations"' in llm.prompts[0]
    assert '"all_narrations"' in llm.prompts[1]
    assert "scene 12" in llm.prompts[0]
    assert "scene 1" in llm.prompts[1]
    assert "scene 11" in llm.prompts[1]


@pytest.mark.asyncio
async def test_mismatched_image_prompt_count_retries_and_then_errors():
    llm = CapturingLLM(
        [
            '{"image_prompts": ["only one"]}',
            '{"image_prompts": ["still one"]}',
        ]
    )

    with pytest.raises(ValueError, match="prompt count mismatch"):
        await generate_image_prompts(
            llm,
            narrations=["scene one", "scene two"],
            max_retries=2,
        )

    assert len(llm.prompts) == 2
