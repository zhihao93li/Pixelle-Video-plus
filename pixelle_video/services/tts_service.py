# Copyright (C) 2025 AIDC-AI
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
TTS (Text-to-Speech) Service - Supports both local and ComfyUI inference
"""

import json
import os
import uuid
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from pixelle_video.services.comfy_base_service import ComfyBaseService
from pixelle_video.tts_voices import speed_to_rate
from pixelle_video.utils.tts_util import edge_tts


class TTSService(ComfyBaseService):
    """
    TTS (Text-to-Speech) service - Workflow-based

    Uses ComfyKit to execute TTS workflows.

    Usage:
        # Use default workflow
        audio_path = await pixelle_video.tts(text="Hello, world!")

        # Use specific workflow
        audio_path = await pixelle_video.tts(
            text="你好，世界！",
            workflow="tts_edge.json"
        )

        # List available workflows
        workflows = pixelle_video.tts.list_workflows()
    """

    WORKFLOW_PREFIX = "tts_"
    DEFAULT_WORKFLOW = None  # No hardcoded default, must be configured
    WORKFLOWS_DIR = "workflows"

    def __init__(self, config: dict, core=None):
        """
        Initialize TTS service

        Args:
            config: Full application config dict
            core: PixelleVideoCore instance (for accessing shared ComfyKit)
        """
        super().__init__(config, service_name="tts", core=core)


    async def __call__(
        self,
        text: str,
        workflow: Optional[str] = None,
        # ComfyUI connection (optional overrides)
        comfyui_url: Optional[str] = None,
        runninghub_api_key: Optional[str] = None,
        # TTS parameters
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        reference_id: Optional[str] = None,
        fish_model: Optional[str] = None,
        # Inference mode override
        inference_mode: Optional[str] = None,
        # Output path
        output_path: Optional[str] = None,
        **params
    ) -> str:
        """
        Generate speech using local Edge TTS or ComfyUI workflow

        Args:
            text: Text to convert to speech
            workflow: Workflow filename (for ComfyUI mode, default: from config)
            comfyui_url: ComfyUI URL (optional, overrides config)
            runninghub_api_key: RunningHub API key (optional, overrides config)
            voice: Voice ID (for local mode: Edge TTS voice ID; for ComfyUI: workflow-specific)
            speed: Speech speed multiplier (1.0 = normal, >1.0 = faster, <1.0 = slower)
            reference_id: Fish Audio voice model ID (Fish mode)
            fish_model: Fish Audio model, e.g. "s2-pro" (Fish mode)
            inference_mode: Override inference mode ("local", "comfyui", or "fish", default: from config)
            output_path: Custom output path (auto-generated if None)
            **params: Additional workflow parameters

        Returns:
            Generated audio file path

        Examples:
            # Local inference (Edge TTS)
            audio_path = await pixelle_video.tts(
                text="Hello, world!",
                inference_mode="local",
                voice="zh-CN-YunjianNeural",
                speed=1.2
            )

            # ComfyUI inference
            audio_path = await pixelle_video.tts(
                text="你好，世界！",
                inference_mode="comfyui",
                workflow="runninghub/tts_edge.json"
            )

            # Fish Audio API inference
            audio_path = await pixelle_video.tts(
                text="你好，世界！",
                inference_mode="fish",
                reference_id="fish-voice-model-id"
            )
        """
        # Determine inference mode (param > config)
        mode = inference_mode or self.config.get("inference_mode", "local")

        # Route to appropriate implementation
        if mode == "local":
            return await self._call_local_tts(
                text=text,
                voice=voice,
                speed=speed,
                output_path=output_path
            )
        if mode == "fish":
            return await self._call_fish_audio_tts(
                text=text,
                voice=voice,
                speed=speed,
                reference_id=reference_id,
                fish_model=fish_model,
                output_path=output_path,
                **params
            )
        if mode == "comfyui":
            # 1. Resolve workflow (returns structured info)
            workflow_info = self._resolve_workflow(workflow=workflow)

            # 2. Execute ComfyUI workflow
            return await self._call_comfyui_workflow(
                workflow_info=workflow_info,
                text=text,
                comfyui_url=comfyui_url,
                runninghub_api_key=runninghub_api_key,
                voice=voice,
                speed=speed,
                output_path=output_path,
                **params
            )

        raise ValueError(
            f"Unsupported TTS inference_mode '{mode}'. "
            "Expected one of: local, comfyui, fish."
        )

    async def _call_local_tts(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        output_path: Optional[str] = None,
    ) -> str:
        """
        Generate speech using local Edge TTS

        Args:
            text: Text to convert to speech
            voice: Edge TTS voice ID (default: from config)
            speed: Speech speed multiplier (default: from config)
            output_path: Custom output path (auto-generated if None)

        Returns:
            Generated audio file path
        """
        # Get config defaults
        local_config = self.config.get("local", {})

        # Determine voice and speed (param > config)
        final_voice = voice or local_config.get("voice", "zh-CN-YunjianNeural")
        final_speed = speed if speed is not None else local_config.get("speed", 1.2)

        # Convert speed to rate parameter
        rate = speed_to_rate(final_speed)

        logger.info(f"🎙️  Using local Edge TTS: voice={final_voice}, speed={final_speed}x (rate={rate})")

        # Generate output path if not provided
        if not output_path:
            # Generate unique filename
            unique_id = uuid.uuid4().hex
            output_path = f"output/{unique_id}.mp3"

            # Ensure output directory exists
            Path("output").mkdir(parents=True, exist_ok=True)

        # Call Edge TTS
        try:
            await edge_tts(
                text=text,
                voice=final_voice,
                rate=rate,
                output_path=output_path
            )

            logger.info(f"✅ Generated audio (local Edge TTS): {output_path}")
            return output_path

        except Exception as e:
            logger.error(f"Local TTS generation error: {e}")
            raise

    async def _call_fish_audio_tts(
        self,
        text: str,
        voice: Optional[str] = None,
        speed: Optional[float] = None,
        reference_id: Optional[str] = None,
        fish_model: Optional[str] = None,
        output_path: Optional[str] = None,
        **params
    ) -> str:
        """
        Generate speech using Fish Audio HTTP API.

        Fish Audio's JSON /v1/tts endpoint accepts a model header and returns
        binary audio. Inline reference audio cloning requires MessagePack with
        transcripts, so this integration supports model IDs via reference_id.
        """
        fish_config = self.config.get("fish_audio", {})
        api_key = (
            params.pop("api_key", None)
            or fish_config.get("api_key")
            or os.getenv("FISH_API_KEY")
            or ""
        )
        if not api_key.strip():
            raise ValueError(
                "Fish Audio API key is required. Set comfyui.tts.fish_audio.api_key "
                "in config.yaml or export FISH_API_KEY."
            )

        ref_audio = params.pop("ref_audio", None)
        references = params.pop("references", None)
        if ref_audio or references:
            raise ValueError(
                "Fish Audio ref_audio cloning is not supported by this JSON integration. "
                "Use a Fish Audio voice model ID via reference_id."
            )

        base_url = (
            params.pop("base_url", None)
            or fish_config.get("base_url")
            or "https://api.fish.audio"
        )
        endpoint = f"{base_url.rstrip('/')}/v1/tts"
        model = fish_model or params.pop("model", None) or fish_config.get("model", "s2-pro")
        final_reference_id = (
            reference_id
            or params.pop("reference_id", None)
            or voice
            or fish_config.get("reference_id")
        )
        final_speed = speed if speed is not None else fish_config.get("speed", 1.0)
        audio_format = params.pop("format", None) or fish_config.get("format", "mp3")

        payload = {
            "text": text,
            "temperature": params.pop("temperature", fish_config.get("temperature", 0.7)),
            "top_p": params.pop("top_p", fish_config.get("top_p", 0.7)),
            "prosody": {
                "speed": final_speed,
                "volume": params.pop("volume", fish_config.get("volume", 0.0)),
                "normalize_loudness": params.pop(
                    "normalize_loudness",
                    fish_config.get("normalize_loudness", True)
                ),
            },
            "chunk_length": params.pop("chunk_length", fish_config.get("chunk_length", 300)),
            "normalize": params.pop("normalize", fish_config.get("normalize", True)),
            "format": audio_format,
            "latency": params.pop("latency", fish_config.get("latency", "normal")),
            "max_new_tokens": params.pop("max_new_tokens", fish_config.get("max_new_tokens", 1024)),
            "repetition_penalty": params.pop(
                "repetition_penalty",
                fish_config.get("repetition_penalty", 1.2)
            ),
            "min_chunk_length": params.pop(
                "min_chunk_length",
                fish_config.get("min_chunk_length", 50)
            ),
            "condition_on_previous_chunks": params.pop(
                "condition_on_previous_chunks",
                fish_config.get("condition_on_previous_chunks", True)
            ),
            "early_stop_threshold": params.pop(
                "early_stop_threshold",
                fish_config.get("early_stop_threshold", 1.0)
            ),
        }

        if final_reference_id:
            payload["reference_id"] = final_reference_id

        sample_rate = params.pop("sample_rate", fish_config.get("sample_rate"))
        if sample_rate:
            payload["sample_rate"] = sample_rate
        if audio_format == "mp3":
            payload["mp3_bitrate"] = params.pop("mp3_bitrate", fish_config.get("mp3_bitrate", 128))
        if audio_format == "opus":
            payload["opus_bitrate"] = params.pop(
                "opus_bitrate",
                fish_config.get("opus_bitrate", -1000)
            )

        if not output_path:
            unique_id = uuid.uuid4().hex
            output_path = f"output/{unique_id}.{audio_format}"

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "model": model,
        }
        timeout = params.pop("timeout", fish_config.get("timeout", 120.0))

        logger.info(
            f"🎙️  Using Fish Audio TTS: model={model}, "
            f"reference_id={final_reference_id or 'default'}, format={audio_format}"
        )

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(endpoint, headers=headers, json=payload)

            if response.status_code >= 400:
                detail = response.text
                try:
                    detail = json.dumps(response.json(), ensure_ascii=False)
                except Exception:
                    pass
                raise RuntimeError(f"Fish Audio TTS failed ({response.status_code}): {detail}")

            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type.lower():
                raise RuntimeError(f"Fish Audio TTS returned JSON instead of audio: {response.text}")
            if not response.content:
                raise RuntimeError("Fish Audio TTS returned empty audio")

            output.write_bytes(response.content)
            logger.info(f"✅ Generated audio (Fish Audio): {output_path}")
            return str(output_path)

        except Exception as e:
            logger.error(f"Fish Audio TTS generation error: {e}")
            raise

    async def _call_comfyui_workflow(
        self,
        workflow_info: dict,
        text: str,
        comfyui_url: Optional[str] = None,
        runninghub_api_key: Optional[str] = None,
        voice: Optional[str] = None,
        speed: float = 1.0,
        output_path: Optional[str] = None,
        **params
    ) -> str:
        """
        Generate speech using ComfyUI workflow

        Args:
            workflow_info: Workflow info dict from _resolve_workflow()
            text: Text to convert to speech
            comfyui_url: ComfyUI URL
            runninghub_api_key: RunningHub API key
            voice: Voice ID (workflow-specific)
            speed: Speech speed multiplier (workflow-specific)
            output_path: Custom output path (downloads if URL returned)
            **params: Additional workflow parameters

        Returns:
            Generated audio file path (local if output_path provided, otherwise URL)
        """
        logger.info(f"🎙️  Using workflow: {workflow_info['key']}")

        # 1. Build workflow parameters (ComfyKit config is now managed by core)
        workflow_params = {"text": text}

        # Add optional TTS parameters (only if explicitly provided and not None)
        if voice is not None:
            workflow_params["voice"] = voice
        if speed is not None and speed != 1.0:
            workflow_params["speed"] = speed

        # Add any additional parameters
        workflow_params.update(params)

        logger.debug(f"Workflow parameters: {workflow_params}")

        # 3. Execute workflow using shared ComfyKit instance from core
        try:
            # Get shared ComfyKit instance (lazy initialization + config hot-reload)
            kit = await self.core._get_or_create_comfykit()

            # Determine what to pass to ComfyKit based on source
            if workflow_info["source"] == "runninghub" and "workflow_id" in workflow_info:
                # RunningHub: pass workflow_id
                workflow_input = workflow_info["workflow_id"]
                logger.info(f"Executing RunningHub TTS workflow: {workflow_input}")
            else:
                # Selfhost: pass file path
                workflow_input = workflow_info["path"]
                logger.info(f"Executing selfhost TTS workflow: {workflow_input}")

            result = await kit.execute(workflow_input, workflow_params)

            # 4. Handle result
            if result.status != "completed":
                error_msg = result.msg or "Unknown error"
                logger.error(f"TTS generation failed: {error_msg}")
                raise Exception(f"TTS generation failed: {error_msg}")

            # ComfyKit result can have audio files in different output types
            # Try to get audio file path from result
            audio_path = None

            # Check for audio files in result.audios (if available)
            if hasattr(result, 'audios') and result.audios:
                audio_path = result.audios[0]
                logger.debug(f"✅ Found audio in result.audios: {audio_path}")
            # Check for files in result.files
            elif hasattr(result, 'files') and result.files:
                audio_path = result.files[0]
                logger.debug(f"✅ Found audio in result.files: {audio_path}")
            # Check in outputs dictionary
            elif hasattr(result, 'outputs') and result.outputs:
                logger.debug(f"Searching for audio file in result.outputs: {result.outputs}")
                # Try to find audio file in outputs
                for key, value in result.outputs.items():
                    if isinstance(value, str) and any(value.endswith(ext) for ext in ['.mp3', '.wav', '.flac']):
                        audio_path = value
                        logger.debug(f"✅ Found audio in result.outputs[{key}]: {audio_path}")
                        break

            if not audio_path:
                logger.error("No audio file generated")
                logger.error("❌ Result analysis:")
                logger.error(f"   - result.audios: {getattr(result, 'audios', 'NOT_FOUND')}")
                logger.error(f"   - result.files: {getattr(result, 'files', 'NOT_FOUND')}")
                logger.error(f"   - result.outputs: {getattr(result, 'outputs', 'NOT_FOUND')}")
                logger.error(f"   - Full __dict__: {result.__dict__}")
                raise Exception("No audio file generated by workflow")

            # If output_path provided and audio_path is URL, download to local
            if output_path and audio_path.startswith(('http://', 'https://')):
                # Ensure parent directory exists
                os.makedirs(os.path.dirname(output_path), exist_ok=True)

                logger.info(f"Downloading audio from {audio_path} to {output_path}")
                async with httpx.AsyncClient() as client:
                    response = await client.get(audio_path)
                    response.raise_for_status()

                    with open(output_path, 'wb') as f:
                        f.write(response.content)

                logger.info(f"✅ Generated audio (ComfyUI): {output_path}")
                return output_path

            logger.info(f"✅ Generated audio (ComfyUI): {audio_path}")
            return audio_path

        except Exception as e:
            logger.error(f"TTS generation error: {e}")
            raise
