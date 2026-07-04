#!/usr/bin/env python3
"""Verify Streamlit-to-React migration coverage against the running API."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from comfykit.comfyui.runninghub_executor import RunningHubExecutor


EXPECTED_TEMPLATES = {
    "petwoods_xhs_daily_v1",
    "petwoods_xhs_static_subtitle_v1",
    "petwoods_xhs_topic_to_video_v1",
    "petwoods_xhs_quality_explainer_v1",
    "petwoods_xhs_asset_enhanced_v1",
    "petwoods_xhs_real_material_montage_v1",
    "pixelle_i2v_basic_v1",
    "pixelle_action_transfer_basic_v1",
    "pixelle_digital_human_basic_v1",
    "pixelle_script_review_v1",
    "pixelle_batch_production_v1",
}

DEFAULT_REAL_TEMPLATE_IDS = ["petwoods_xhs_daily_v1"]
ASSET_MONTAGE_TEMPLATE_IDS = [
    "petwoods_xhs_asset_enhanced_v1",
    "petwoods_xhs_real_material_montage_v1",
]
SPECIAL_PIPELINE_TEMPLATE_IDS = [
    "pixelle_i2v_basic_v1",
    "pixelle_action_transfer_basic_v1",
    "pixelle_digital_human_basic_v1",
]
PROVIDER_E2E_TEMPLATE_IDS = [
    "petwoods_xhs_daily_v1",
    "petwoods_xhs_topic_to_video_v1",
    "petwoods_xhs_quality_explainer_v1",
    "petwoods_xhs_asset_enhanced_v1",
    "petwoods_xhs_real_material_montage_v1",
    "pixelle_i2v_basic_v1",
    "pixelle_action_transfer_basic_v1",
    "pixelle_digital_human_basic_v1",
]
EXTERNAL_E2E_CHECK_ORDER = [
    "real_generation_petwoods_xhs_daily_v1",
    "real_generation_petwoods_xhs_topic_to_video_v1",
    "real_generation_petwoods_xhs_quality_explainer_v1",
    "real_generation_petwoods_xhs_asset_enhanced_v1",
    "real_generation_petwoods_xhs_real_material_montage_v1",
    "real_generation_pixelle_i2v_basic_v1",
    "real_generation_pixelle_action_transfer_basic_v1",
    "real_generation_pixelle_digital_human_basic_v1",
    "real_script_review_generation",
    "real_publish_e2e",
]
EXTERNAL_E2E_EFFECTS = {
    "real_generation_petwoods_xhs_daily_v1": ["provider_generation"],
    "real_generation_petwoods_xhs_topic_to_video_v1": ["provider_generation", "llm_script"],
    "real_generation_petwoods_xhs_quality_explainer_v1": ["provider_generation"],
    "real_generation_petwoods_xhs_asset_enhanced_v1": ["provider_generation"],
    "real_generation_petwoods_xhs_real_material_montage_v1": ["provider_generation"],
    "real_generation_pixelle_i2v_basic_v1": ["provider_generation"],
    "real_generation_pixelle_action_transfer_basic_v1": ["provider_generation"],
    "real_generation_pixelle_digital_human_basic_v1": ["provider_generation"],
    "real_script_review_generation": ["llm_draft", "local_generation"],
    "real_publish_e2e": ["upload_media", "buffer_post"],
}
PROVIDER_READINESS_DIAGNOSTIC_IDS = [
    "llm_config",
    "ffmpeg",
    "runninghub_config",
    "runninghub_timeout",
    "default_image_workflow",
    "default_video_workflow",
]
STREAMLIT_SETTINGS_CONFIG_PATHS = [
    "llm.api_key",
    "llm.base_url",
    "llm.model",
    "comfyui.comfyui_url",
    "comfyui.comfyui_api_key",
    "comfyui.runninghub_api_key",
    "comfyui.runninghub_concurrent_limit",
    "comfyui.runninghub_instance_type",
    "comfyui.runninghub_timeout",
    "comfyui.tts.inference_mode",
    "comfyui.tts.fish_audio.api_key",
    "comfyui.tts.fish_audio.base_url",
    "comfyui.tts.fish_audio.model",
    "comfyui.tts.fish_audio.reference_id",
    "publish.buffer.api_key",
    "publish.buffer.channels.youtube",
    "publish.buffer.channels.tiktok",
    "publish.buffer.channels.instagram",
    "publish.buffer.channels.x",
    "publish.buffer.channels.pinterest",
    "publish.cos.region",
    "publish.cos.bucket",
    "publish.cos.secret_id",
    "publish.cos.secret_key",
    "publish.cos.public_base_url",
    "publish.cos.endpoint_url",
]
STREAMLIT_SETTINGS_DIAGNOSTIC_IDS = [
    "llm_config",
    "ffmpeg",
    "runninghub_config",
    "runninghub_timeout",
    "comfyui_config",
    "fish_audio_config",
    "default_image_workflow",
    "default_video_workflow",
    "buffer_publish",
    "cos_publish",
]
STREAMLIT_COMPLETION_REQUIRED_CHECKS = [
    "template_inventory",
    "route_contract",
    "capability_matrix",
    "management_readiness",
    "browser_smoke",
    "provider_readiness",
    "real_generation_petwoods_xhs_daily_v1",
    "real_generation_petwoods_xhs_static_subtitle_v1",
    "real_generation_petwoods_xhs_topic_to_video_v1",
    "real_generation_petwoods_xhs_quality_explainer_v1",
    "real_generation_petwoods_xhs_asset_enhanced_v1",
    "real_generation_petwoods_xhs_real_material_montage_v1",
    "real_generation_pixelle_i2v_basic_v1",
    "real_generation_pixelle_action_transfer_basic_v1",
    "real_generation_pixelle_digital_human_basic_v1",
    "real_batch_generation",
    "real_script_review_generation",
    "publish_readiness",
    "real_publish_e2e",
]
STREAMLIT_COMPLETION_CHECK_DETAILS = {
    "template_inventory": {
        "capability": "生产模板清单",
        "phase": "P0",
        "command": "uv run python scripts/verify_streamlit_migration.py",
        "requires_confirmation": False,
    },
    "route_contract": {
        "capability": "统一 task API contract",
        "phase": "P0",
        "command": "uv run python scripts/verify_streamlit_migration.py",
        "requires_confirmation": False,
    },
    "capability_matrix": {
        "capability": "Streamlit 功能迁移清单完整性",
        "phase": "P0",
        "command": "uv run python scripts/verify_streamlit_migration.py",
        "requires_confirmation": False,
    },
    "management_readiness": {
        "capability": "History / Settings / Resources / Help 管理入口",
        "phase": "P2",
        "command": "uv run python scripts/verify_streamlit_migration.py --management-readiness",
        "requires_confirmation": False,
    },
    "browser_smoke": {
        "capability": "React 主入口浏览器可用性",
        "phase": "P2",
        "command": "uv run python scripts/verify_streamlit_migration.py --browser-smoke",
        "requires_confirmation": False,
    },
    "provider_readiness": {
        "capability": "外部 provider 配置与 workflow 文件 readiness",
        "phase": "P4",
        "command": "uv run python scripts/verify_streamlit_migration.py --provider-readiness",
        "requires_confirmation": False,
    },
    "real_generation_petwoods_xhs_daily_v1": {
        "capability": "标准视频生成：已有文案到视频",
        "phase": "P1",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template petwoods_xhs_daily_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_generation_petwoods_xhs_static_subtitle_v1": {
        "capability": "静态字幕短视频生成",
        "phase": "P1",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template petwoods_xhs_static_subtitle_v1 --timeout 120"
        ),
        "requires_confirmation": False,
    },
    "existing_real_template": {
        "capability": "复查已有 generation task 作为指定模板 E2E 证据",
        "phase": "P1/P4",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--existing-real-template <template_id>:<generation_task_id>"
        ),
        "requires_confirmation": False,
    },
    "real_generation_petwoods_xhs_topic_to_video_v1": {
        "capability": "选题生成脚本后生成视频",
        "phase": "P1",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template petwoods_xhs_topic_to_video_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_generation_petwoods_xhs_quality_explainer_v1": {
        "capability": "重点解释/质量解释器视频",
        "phase": "P1",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template petwoods_xhs_quality_explainer_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_generation_petwoods_xhs_asset_enhanced_v1": {
        "capability": "素材增强视频生成",
        "phase": "P4-A",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template petwoods_xhs_asset_enhanced_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_generation_petwoods_xhs_real_material_montage_v1": {
        "capability": "真实素材 montage 生成",
        "phase": "P4-A",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template petwoods_xhs_real_material_montage_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_generation_pixelle_i2v_basic_v1": {
        "capability": "图片生成视频 I2V",
        "phase": "P4",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template pixelle_i2v_basic_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_generation_pixelle_action_transfer_basic_v1": {
        "capability": "动作迁移视频",
        "phase": "P4",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template pixelle_action_transfer_basic_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_generation_pixelle_digital_human_basic_v1": {
        "capability": "数字人视频",
        "phase": "P4",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-template pixelle_digital_human_basic_v1 --no-cancel-on-timeout --timeout 900"
        ),
        "requires_confirmation": True,
    },
    "real_batch_generation": {
        "capability": "批量生产",
        "phase": "P3",
        "command": "uv run python scripts/verify_streamlit_migration.py --real-batch --timeout 120",
        "requires_confirmation": False,
    },
    "real_script_review_generation": {
        "capability": "文案审核完整闭环：LLM draft 到确认生成",
        "phase": "P3",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-script-review --timeout 240"
        ),
        "requires_confirmation": True,
    },
    "publish_readiness": {
        "capability": "发布配置 readiness",
        "phase": "P2",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--publish-readiness --publish-platform x"
        ),
        "requires_confirmation": False,
    },
    "real_publish_e2e": {
        "capability": "真实发布 E2E",
        "phase": "P2",
        "command": (
            "uv run python scripts/verify_streamlit_migration.py "
            "--real-publish-e2e --confirm-real-publish --publish-platform x"
        ),
        "requires_confirmation": True,
    },
}

STREAMLIT_CAPABILITY_MATRIX = [
    {
        "id": "standard_script",
        "capability": "已有文案生成视频",
        "streamlit_source": "web/pipelines/standard.py + web/components/output_preview.py",
        "react_surface": "生成视频",
        "migration_decision": "react_template",
        "phase": "P1",
        "template_ids": ["petwoods_xhs_daily_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_petwoods_xhs_daily_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "static_subtitle",
        "capability": "静态字幕短视频",
        "streamlit_source": "web/components/style_config.py + web/pipelines/standard.py",
        "react_surface": "生成视频",
        "migration_decision": "react_template",
        "phase": "P1",
        "template_ids": ["petwoods_xhs_static_subtitle_v1"],
        "evidence_checks": [
            "browser_smoke",
            "real_generation_petwoods_xhs_static_subtitle_v1",
        ],
        "requires_external_e2e": False,
    },
    {
        "id": "topic_to_video",
        "capability": "选题生成视频",
        "streamlit_source": "web/components/content_input.py",
        "react_surface": "生成视频",
        "migration_decision": "react_template",
        "phase": "P1",
        "template_ids": ["petwoods_xhs_topic_to_video_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_petwoods_xhs_topic_to_video_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "quality_explainer",
        "capability": "重点解释/质量解释器视频",
        "streamlit_source": "web/components/content_input.py + web/pipelines/standard.py",
        "react_surface": "生成视频",
        "migration_decision": "react_template",
        "phase": "P1",
        "template_ids": ["petwoods_xhs_quality_explainer_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_petwoods_xhs_quality_explainer_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "standard_advanced_params",
        "capability": "标准高级参数",
        "streamlit_source": "web/components/style_config.py",
        "react_surface": "生成视频高级设置",
        "migration_decision": "react_advanced_settings",
        "phase": "P1",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "management_readiness"],
        "requires_external_e2e": False,
    },
    {
        "id": "bgm_resources",
        "capability": "BGM 选择/上传/预览",
        "streamlit_source": "web/components/content_input.py",
        "react_surface": "生成视频高级设置 / 批量生产",
        "migration_decision": "react_resources",
        "phase": "P1/P3",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "management_readiness"],
        "requires_external_e2e": False,
    },
    {
        "id": "tts_preview",
        "capability": "TTS 预览",
        "streamlit_source": "web/components/style_config.py",
        "react_surface": "生成视频高级设置",
        "migration_decision": "react_api",
        "phase": "P1",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "management_readiness"],
        "requires_external_e2e": False,
    },
    {
        "id": "frame_preview",
        "capability": "模板预览",
        "streamlit_source": "web/components/style_config.py",
        "react_surface": "生成视频高级设置",
        "migration_decision": "react_api",
        "phase": "P1",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "management_readiness"],
        "requires_external_e2e": False,
    },
    {
        "id": "media_workflow_preview",
        "capability": "媒体工作流预览",
        "streamlit_source": "web/components/style_config.py",
        "react_surface": "生成视频高级设置",
        "migration_decision": "react_api",
        "phase": "P1",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "provider_readiness"],
        "requires_external_e2e": False,
    },
    {
        "id": "asset_based_video",
        "capability": "素材生成视频",
        "streamlit_source": "web/pipelines/asset_based.py",
        "react_surface": "生成视频 / 素材模板",
        "migration_decision": "react_template",
        "phase": "P4-A",
        "template_ids": ["petwoods_xhs_asset_enhanced_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_petwoods_xhs_asset_enhanced_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "real_material_montage",
        "capability": "真实素材混剪",
        "streamlit_source": "web/pipelines/asset_based.py",
        "react_surface": "生成视频 / 素材模板",
        "migration_decision": "react_template",
        "phase": "P4-A",
        "template_ids": ["petwoods_xhs_real_material_montage_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_petwoods_xhs_real_material_montage_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "batch_generation",
        "capability": "批量生成",
        "streamlit_source": "web/components/output_preview.py + web/utils/batch_manager.py",
        "react_surface": "批量生产",
        "migration_decision": "react_dedicated_flow",
        "phase": "P3",
        "template_ids": ["pixelle_batch_production_v1"],
        "evidence_checks": ["browser_smoke", "real_batch_generation"],
        "requires_external_e2e": False,
    },
    {
        "id": "script_review",
        "capability": "文案审核后生成",
        "streamlit_source": "web/components/script_review_workflow.py",
        "react_surface": "文案审核",
        "migration_decision": "react_dedicated_flow",
        "phase": "P3",
        "template_ids": ["pixelle_script_review_v1"],
        "evidence_checks": [
            "browser_smoke",
            "real_script_review_generation",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "i2v",
        "capability": "图片生成视频 I2V",
        "streamlit_source": "web/pipelines/i2v.py",
        "react_surface": "特殊生成",
        "migration_decision": "react_template",
        "phase": "P4",
        "template_ids": ["pixelle_i2v_basic_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_pixelle_i2v_basic_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "action_transfer",
        "capability": "动作迁移视频",
        "streamlit_source": "web/pipelines/action_transfer.py",
        "react_surface": "特殊生成",
        "migration_decision": "react_template",
        "phase": "P4",
        "template_ids": ["pixelle_action_transfer_basic_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_pixelle_action_transfer_basic_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "digital_human",
        "capability": "数字人视频",
        "streamlit_source": "web/pipelines/digital_human.py",
        "react_surface": "特殊生成",
        "migration_decision": "react_template",
        "phase": "P4",
        "template_ids": ["pixelle_digital_human_basic_v1"],
        "evidence_checks": [
            "browser_smoke",
            "provider_readiness",
            "real_generation_pixelle_digital_human_basic_v1",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "history",
        "capability": "历史记录",
        "streamlit_source": "web/pages/2_📚_History.py",
        "react_surface": "历史与发布",
        "migration_decision": "react_management",
        "phase": "P2",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "management_readiness"],
        "requires_external_e2e": False,
    },
    {
        "id": "publish",
        "capability": "发布到 Buffer",
        "streamlit_source": "web/pages/2_📚_History.py",
        "react_surface": "历史与发布",
        "migration_decision": "react_management",
        "phase": "P2",
        "template_ids": [],
        "evidence_checks": [
            "browser_smoke",
            "publish_readiness",
            "real_publish_e2e",
        ],
        "requires_external_e2e": True,
    },
    {
        "id": "settings",
        "capability": "系统设置",
        "streamlit_source": "web/pages/3_⚙️_Settings.py",
        "react_surface": "设置",
        "migration_decision": "react_management",
        "phase": "P2",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "management_readiness"],
        "requires_external_e2e": False,
    },
    {
        "id": "help",
        "capability": "帮助页",
        "streamlit_source": "web/pages/4_❓_Help.py",
        "react_surface": "帮助",
        "migration_decision": "react_help",
        "phase": "P2",
        "template_ids": [],
        "evidence_checks": ["browser_smoke", "management_readiness"],
        "requires_external_e2e": False,
    },
]

SAMPLE_SCRIPT = (
    "今天分享一个猫咪喝水的小技巧。把水碗放在远离猫粮的位置，"
    "很多猫会更愿意主动喝水。"
)
SAMPLE_TOPIC = "猫咪为什么不爱喝水，以及主人可以怎么改善。"
SAMPLE_ASSET_INTENT = "把猫咪日常素材包装成一条轻量小红书短视频。"

EXPECTED_ROUTE_METHODS = {
    "/api/generation/tasks/{task_id}": {"get", "delete"},
    "/api/generation/batches/{batch_id}/items/{item_index}/retry": {"post"},
}

READ_ONLY_ENDPOINTS = [
    ("health", "GET", "/health"),
    ("templates", "GET", "/api/generation/templates"),
    ("batches", "GET", "/api/generation/batches"),
    ("script_review_templates", "GET", "/api/generation/script-review/templates"),
    ("script_review_drafts", "GET", "/api/generation/script-review/draft-sets"),
    ("history_tasks", "GET", "/api/history/tasks?page=1&page_size=1"),
    ("history_statistics", "GET", "/api/history/statistics"),
    ("publish_platforms", "GET", "/api/publish/platforms"),
    ("publish_timezones", "GET", "/api/publish/timezones"),
    ("settings", "GET", "/api/settings/config"),
    ("settings_diagnostics", "GET", "/api/settings/diagnostics"),
    ("bgm", "GET", "/api/resources/bgm"),
    ("frame_templates", "GET", "/api/resources/templates"),
    ("media_workflows", "GET", "/api/resources/workflows/media"),
    ("tts_workflows", "GET", "/api/resources/workflows/tts"),
    ("help", "GET", "/api/help/faq?language=zh_CN"),
]

BROWSER_SMOKE_SCRIPT = r"""
import { chromium } from "playwright";

const frontendUrl = process.env.PIXELLE_FRONTEND_URL || "http://127.0.0.1:5173";
const checked = [];
const consoleErrors = [];
const pageErrors = [];
const errors = [];
const forbiddenTexts = [
  "模板读取失败",
  "历史读取失败",
  "设置读取失败",
  "帮助内容读取失败",
  "批量操作失败",
  "发布操作失败",
];

function recordError(message) {
  errors.push(message);
}

async function expectVisible(page, text) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({
      state: "visible",
      timeout: 8000,
    });
    checked.push(text);
  } catch (error) {
    recordError(`missing visible text: ${text}`);
  }
}

async function expectControl(page, name) {
  const candidates = [
    page.getByLabel(name, { exact: false }).first(),
    page.getByRole("button", { name }).first(),
    page.getByText(name, { exact: false }).first(),
    page.getByPlaceholder(name, { exact: false }).first(),
  ];

  for (const candidate of candidates) {
    try {
      await candidate.waitFor({ state: "visible", timeout: 1000 });
      checked.push(`control:${name}`);
      return;
    } catch (error) {
      // Try the next locator strategy.
    }
  }

  recordError(`missing control: ${name}`);
}

async function verifyNoInlineFailure(page, context) {
  const bodyText = await page.locator("body").innerText({ timeout: 5000 });
  for (const forbiddenText of forbiddenTexts) {
    if (bodyText.includes(forbiddenText)) {
      recordError(`${context} shows failure text: ${forbiddenText}`);
    }
  }
}

async function clickEntry(page, name, expectedText) {
  try {
    await page.getByRole("button", { name }).click({ timeout: 8000 });
    checked.push(`nav:${name}`);
  } catch (error) {
    recordError(`could not click nav entry: ${name}`);
    return;
  }
  await expectVisible(page, expectedText);
  await verifyNoInlineFailure(page, name);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("console", (message) => {
  if (message.type() === "error") {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => {
  pageErrors.push(error.message);
});

try {
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await expectVisible(page, "Pixelle 生产模板");
  await expectVisible(page, "生成视频");
  await expectVisible(page, "当前真实生成方式");
  await verifyNoInlineFailure(page, "生成视频");
  await expectControl(page, "视频文案");
  await expectControl(page, "高级生成设置");
  await expectControl(page, "创建真实生成任务");
  await expectControl(page, "真实任务状态");

  await clickEntry(page, "历史与发布", "历史记录");
  await expectVisible(page, "发布准备");
  await expectControl(page, "刷新历史记录");
  await expectControl(page, "视频详情");
  await expectControl(page, "真实 Buffer 发布链路");
  await clickEntry(page, "文案审核", "文案审核后生成");
  await expectControl(page, "选题");
  await expectControl(page, "语言");
  await expectControl(page, "脚本 Prompt");
  await expectControl(page, "提交生成视频");
  await clickEntry(page, "特殊生成", "特殊生成");
  await expectControl(page, "图片生成视频");
  await expectControl(page, "动作迁移视频");
  await expectControl(page, "数字人视频");
  await expectControl(page, "提交后会显示任务");
  await clickEntry(page, "批量生产", "批量生产");
  await expectControl(page, "批量选题");
  await expectControl(page, "批量文案");
  await expectControl(page, "创建批量任务");
  await expectControl(page, "批次状态");
  await clickEntry(page, "模板状态", "模板与迁移状态");
  await expectControl(page, "React 可提交");
  await expectControl(page, "Legacy only");
  await clickEntry(page, "设置", "系统设置");
  await expectControl(page, "AiHubMix API Key");
  await expectControl(page, "ComfyUI URL");
  await expectControl(page, "RunningHub API Key");
  await expectControl(page, "Fish Audio");
  await expectControl(page, "Buffer API Key");
  await expectControl(page, "COS Region");
  await clickEntry(page, "帮助", "帮助");
  await expectControl(page, "旧 Streamlit Help 页 FAQ");
} catch (error) {
  recordError(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

if (consoleErrors.length > 0) {
  recordError(`console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
}
if (pageErrors.length > 0) {
  recordError(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`);
}

const payload = {
  ok: errors.length === 0,
  url: frontendUrl,
  checked,
  errors,
  consoleErrors,
  pageErrors,
};
console.log(JSON.stringify(payload, null, 2));
process.exit(payload.ok ? 0 : 1);
"""


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class RealGenerationAssetPaths:
    image: Path
    reference_video: Path | None = None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--frontend-url", default="http://127.0.0.1:5173")
    parser.add_argument(
        "--real-generate",
        action="store_true",
        help="Run a real E2E generation check. Defaults to petwoods_xhs_daily_v1.",
    )
    parser.add_argument(
        "--real-template",
        action="append",
        default=[],
        help="Template id to submit as a real E2E generation check. Can be repeated.",
    )
    parser.add_argument(
        "--real-all-enabled",
        action="store_true",
        help="Submit every enabled production template. This may trigger external providers.",
    )
    parser.add_argument(
        "--real-special-pipelines",
        action="store_true",
        help=(
            "Submit I2V, Action Transfer, and Digital Human production templates "
            "as a focused special-pipeline E2E group."
        ),
    )
    parser.add_argument(
        "--real-asset-pipelines",
        action="store_true",
        help=(
            "Submit asset-enhanced and real-material montage production templates "
            "as a focused asset/Montage E2E group."
        ),
    )
    parser.add_argument(
        "--real-batch",
        action="store_true",
        help="Submit one real persisted batch item through /api/generation/batches.",
    )
    parser.add_argument(
        "--real-script-review",
        action="store_true",
        help="Create a real script-review draft set, submit it, and poll the resulting batch.",
    )
    parser.add_argument(
        "--script-review-submit-only",
        action="store_true",
        help=(
            "Submit an existing script-review draft set without creating new LLM drafts. "
            "This verifies the reviewed-draft-to-video half only and does not satisfy "
            "the full real_script_review_generation completion gate."
        ),
    )
    parser.add_argument(
        "--script-review-draft-set-id",
        default="",
        help=(
            "Draft set id for --script-review-submit-only. If omitted, the verifier "
            "uses the newest draft set with at least one draft."
        ),
    )
    parser.add_argument(
        "--publish-readiness",
        action="store_true",
        help=(
            "Run non-mutating publish readiness checks through /api/publish/check. "
            "This does not create Buffer posts."
        ),
    )
    parser.add_argument(
        "--real-publish-e2e",
        action="store_true",
        help=(
            "Run a real publish E2E through /api/publish/tasks/{task_id}. "
            "Requires --confirm-real-publish because it can upload media and create Buffer posts."
        ),
    )
    parser.add_argument(
        "--confirm-real-publish",
        action="store_true",
        help="Required with --real-publish-e2e to confirm external publish side effects.",
    )
    parser.add_argument(
        "--management-readiness",
        action="store_true",
        help=(
            "Run read-only shape checks for History, Settings, Resources, and Help "
            "management surfaces used by the React UI."
        ),
    )
    parser.add_argument(
        "--browser-smoke",
        action="store_true",
        help=(
            "Open the React UI in Chromium and verify the main Streamlit-replacement "
            "product entries render without page or console errors."
        ),
    )
    parser.add_argument(
        "--provider-readiness",
        action="store_true",
        help=(
            "Run non-mutating provider/workflow readiness checks for templates that "
            "still need external provider E2E. This does not submit generation tasks."
        ),
    )
    parser.add_argument(
        "--external-e2e-plan",
        action="store_true",
        help=(
            "Print the ordered external-side-effect E2E plan required before Streamlit "
            "can be considered fully replaced. This does not submit generation, LLM, "
            "upload, or publish tasks."
        ),
    )
    parser.add_argument(
        "--provider-task-status",
        action="store_true",
        help=(
            "Query existing RunningHub provider task ids without creating new tasks. "
            "Use with --provider-task-id."
        ),
    )
    parser.add_argument(
        "--provider-task-id",
        action="append",
        default=[],
        help="Existing provider task id to query with --provider-task-status. Can be repeated.",
    )
    parser.add_argument(
        "--generation-task-id",
        action="append",
        default=[],
        help=(
            "Existing Pixelle generation task id to poll for final result without "
            "creating or cancelling tasks. Can be repeated."
        ),
    )
    parser.add_argument(
        "--existing-real-template",
        action="append",
        default=[],
        help=(
            "Poll an existing Pixelle generation task as template-specific E2E evidence "
            "without creating or cancelling tasks. Format: TEMPLATE_ID:TASK_ID. "
            "Can be repeated."
        ),
    )
    parser.add_argument(
        "--no-cancel-on-timeout",
        action="store_true",
        help=(
            "Leave verifier-submitted generation tasks running when the poll timeout "
            "is reached. Use this for long provider E2E checks that may finish after "
            "the verifier exits."
        ),
    )
    parser.add_argument(
        "--completion-audit",
        action="store_true",
        help=(
            "Append a strict Streamlit replacement gate. The gate fails until "
            "all required browser, generation, management, and publish evidence "
            "checks are present and passing in the same verifier run."
        ),
    )
    parser.add_argument(
        "--publish-platform",
        action="append",
        default=[],
        help=(
            "Publish platform to include in publish checks. Can be repeated. "
            "If omitted, readiness checks all supported platforms and real E2E defaults to x."
        ),
    )
    parser.add_argument(
        "--publish-task-id",
        default="",
        help=(
            "Completed generation task id to publish in --real-publish-e2e. "
            "If omitted, verifier creates a static local-render task first."
        ),
    )
    parser.add_argument(
        "--publish-caption",
        default="Pixelle Streamlit migration publish E2E check.",
        help="Caption used by --real-publish-e2e.",
    )
    parser.add_argument(
        "--publish-title",
        default="Pixelle migration publish E2E",
        help="Title used by --real-publish-e2e.",
    )
    parser.add_argument(
        "--publish-due-at",
        default="",
        help="Optional ISO due_at used by --real-publish-e2e scheduled publish.",
    )
    parser.add_argument(
        "--local-render-smoke",
        action="store_true",
        help=(
            "Submit a standard task with a static frame template to verify local "
            "TTS/frame/FFmpeg composition without external media providers."
        ),
    )
    parser.add_argument(
        "--asset-image",
        default="",
        help="Image asset path used for asset/I2V/digital-human templates.",
    )
    parser.add_argument(
        "--reference-video",
        default="",
        help="Reference video path used for action-transfer templates.",
    )
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--poll-interval", type=float, default=2.0)
    args = parser.parse_args()

    checks: list[Check] = []
    with httpx.Client(base_url=args.base_url.rstrip("/"), timeout=15.0) as client:
        checks.extend(run_read_only_checks(client))
        checks.append(check_templates(client))
        checks.append(check_route_contract(client))
        checks.append(check_capability_matrix())
        real_template_ids = resolve_real_template_ids(
            client,
            explicit_template_ids=args.real_template,
            run_default=args.real_generate,
            run_all_enabled=args.real_all_enabled,
            run_asset_pipelines=args.real_asset_pipelines,
            run_special_pipelines=args.real_special_pipelines,
        )
        if real_template_ids:
            asset_paths = prepare_real_generation_assets(
                image_path=args.asset_image,
                reference_video_path=args.reference_video,
                needs_reference_video=any(
                    template_id == "pixelle_action_transfer_basic_v1"
                    for template_id in real_template_ids
                ),
            )
            for template_id in real_template_ids:
                checks.append(
                    run_real_template_check(
                        client,
                        template_id=template_id,
                        asset_paths=asset_paths,
                        timeout_seconds=args.timeout,
                        poll_interval=args.poll_interval,
                        cancel_on_timeout=not args.no_cancel_on_timeout,
                    )
                )
        for task_id in args.generation_task_id:
            checks.append(
                run_existing_generation_task_check(
                    client,
                    task_id=task_id,
                    timeout_seconds=args.timeout,
                    poll_interval=args.poll_interval,
                )
            )
        for spec in args.existing_real_template:
            checks.append(
                run_existing_real_template_check(
                    client,
                    spec=spec,
                    timeout_seconds=args.timeout,
                    poll_interval=args.poll_interval,
                )
            )
        if args.real_batch:
            checks.append(
                run_real_batch_check(
                    client,
                    timeout_seconds=args.timeout,
                    poll_interval=args.poll_interval,
                    cancel_on_timeout=not args.no_cancel_on_timeout,
                )
            )
        if args.real_script_review:
            checks.append(
                run_real_script_review_check(
                    client,
                    timeout_seconds=args.timeout,
                    poll_interval=args.poll_interval,
                    cancel_on_timeout=not args.no_cancel_on_timeout,
                )
            )
        if args.script_review_submit_only:
            checks.append(
                run_script_review_submit_only_check(
                    client,
                    draft_set_id=args.script_review_draft_set_id or None,
                    timeout_seconds=args.timeout,
                    poll_interval=args.poll_interval,
                    cancel_on_timeout=not args.no_cancel_on_timeout,
                )
            )
        if args.local_render_smoke:
            checks.append(
                run_local_render_smoke_check(
                    client,
                    timeout_seconds=args.timeout,
                    poll_interval=args.poll_interval,
                    cancel_on_timeout=not args.no_cancel_on_timeout,
                )
            )
        if args.publish_readiness:
            checks.append(
                run_publish_readiness_check(
                    client,
                    platforms=args.publish_platform or None,
                )
            )
        if args.real_publish_e2e:
            checks.append(
                run_real_publish_e2e_check(
                    client,
                    platforms=args.publish_platform or ["x"],
                    confirmed=args.confirm_real_publish,
                    task_id=args.publish_task_id or None,
                    caption=args.publish_caption,
                    title=args.publish_title,
                    due_at=args.publish_due_at or None,
                    timeout_seconds=args.timeout,
                    poll_interval=args.poll_interval,
                    cancel_on_timeout=not args.no_cancel_on_timeout,
                )
            )
        if args.management_readiness:
            checks.append(run_management_readiness_check(client))
        if args.browser_smoke:
            checks.append(
                run_browser_smoke_check(
                    args.frontend_url,
                    timeout_seconds=args.timeout,
                )
            )
        if args.provider_readiness:
            checks.append(run_provider_readiness_check(client))
        if args.external_e2e_plan:
            checks.append(build_external_e2e_plan())
        if args.provider_task_status:
            checks.append(
                run_provider_task_status_check(
                    provider_task_ids=args.provider_task_id,
                )
            )
        if args.completion_audit:
            if not any(check.name == "capability_matrix" for check in checks):
                checks.append(check_capability_matrix())
            if not any(check.name == "management_readiness" for check in checks):
                checks.append(run_management_readiness_check(client))
            if not any(check.name == "browser_smoke" for check in checks):
                checks.append(
                    run_browser_smoke_check(
                        args.frontend_url,
                        timeout_seconds=args.timeout,
                    )
                )
            if not any(check.name == "provider_readiness" for check in checks):
                checks.append(run_provider_readiness_check(client))
            checks.append(build_streamlit_completion_gate(checks))

    payload = {
        "ok": all(check.ok for check in checks),
        "checks": [check.__dict__ for check in checks],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["ok"] else 1


def run_read_only_checks(client: httpx.Client) -> list[Check]:
    checks = []
    for name, method, path in READ_ONLY_ENDPOINTS:
        try:
            response = client.request(method, path)
            checks.append(
                Check(
                    name=name,
                    ok=200 <= response.status_code < 300,
                    detail=f"HTTP {response.status_code}",
                )
            )
        except Exception as exc:
            checks.append(Check(name=name, ok=False, detail=str(exc)))
    return checks


def check_templates(client: httpx.Client) -> Check:
    response = client.get("/api/generation/templates")
    if response.status_code != 200:
        return Check("template_inventory", False, f"HTTP {response.status_code}")

    payload = response.json()
    templates = payload.get("templates") or []
    ids = {template.get("id") for template in templates}
    missing = sorted(EXPECTED_TEMPLATES - ids)
    enabled = sorted(template["id"] for template in templates if template.get("enabled"))
    dedicated = sorted(
        template["id"]
        for template in templates
        if template.get("product_entry") in {"script_review", "batch"}
    )
    ok = not missing and len(enabled) >= 8 and set(dedicated) == {
        "pixelle_batch_production_v1",
        "pixelle_script_review_v1",
    }
    return Check(
        "template_inventory",
        ok,
        "all expected templates present" if ok else f"missing={missing}",
        {"enabled": enabled, "dedicated": dedicated},
    )


def check_route_contract(client: httpx.Client) -> Check:
    response = client.get("/openapi.json")
    if response.status_code != 200:
        return Check("route_contract", False, f"HTTP {response.status_code}")

    paths = response.json().get("paths") or {}
    missing = []
    for path, methods in EXPECTED_ROUTE_METHODS.items():
        actual_methods = set((paths.get(path) or {}).keys())
        for method in methods:
            if method not in actual_methods:
                missing.append(f"{method.upper()} {path}")

    return Check(
        "route_contract",
        not missing,
        "required task control routes present" if not missing else f"missing={missing}",
    )


def check_capability_matrix() -> Check:
    ids = [item.get("id") for item in STREAMLIT_CAPABILITY_MATRIX]
    duplicate_ids = sorted(
        {capability_id for capability_id in ids if ids.count(capability_id) > 1}
    )
    missing_fields = [
        item.get("id", "<missing id>")
        for item in STREAMLIT_CAPABILITY_MATRIX
        if not all(
            item.get(field)
            for field in [
                "id",
                "capability",
                "streamlit_source",
                "react_surface",
                "migration_decision",
                "phase",
            ]
        )
        or not isinstance(item.get("evidence_checks"), list)
    ]
    template_ids = {
        template_id
        for item in STREAMLIT_CAPABILITY_MATRIX
        for template_id in item.get("template_ids", [])
    }
    missing_templates = sorted(template_ids - EXPECTED_TEMPLATES)
    covered_checks = {
        check_name
        for item in STREAMLIT_CAPABILITY_MATRIX
        for check_name in item.get("evidence_checks", [])
    }
    user_facing_required_checks = set(STREAMLIT_COMPLETION_REQUIRED_CHECKS) - {
        "template_inventory",
        "route_contract",
        "capability_matrix",
    }
    missing_required_checks = sorted(user_facing_required_checks - covered_checks)
    external_checks = {
        check_name
        for item in STREAMLIT_CAPABILITY_MATRIX
        if item.get("requires_external_e2e")
        for check_name in item.get("evidence_checks", [])
        if check_name in EXTERNAL_E2E_CHECK_ORDER
    }
    missing_external_plan_checks = sorted(set(EXTERNAL_E2E_CHECK_ORDER) - external_checks)

    ok = not (
        duplicate_ids
        or missing_fields
        or missing_templates
        or missing_required_checks
        or missing_external_plan_checks
    )
    failed_sections = []
    if duplicate_ids:
        failed_sections.append(f"duplicate_ids={','.join(duplicate_ids)}")
    if missing_fields:
        failed_sections.append(f"missing_fields={','.join(missing_fields)}")
    if missing_templates:
        failed_sections.append(f"missing_templates={','.join(missing_templates)}")
    if missing_required_checks:
        failed_sections.append(
            f"missing_required_checks={','.join(missing_required_checks)}"
        )
    if missing_external_plan_checks:
        failed_sections.append(
            f"missing_external_plan_checks={','.join(missing_external_plan_checks)}"
        )

    return Check(
        "capability_matrix",
        ok,
        "capability matrix covers Streamlit migration scope"
        if ok
        else "capability matrix failed: " + "; ".join(failed_sections),
        {
            "capabilities_count": len(STREAMLIT_CAPABILITY_MATRIX),
            "template_ids": sorted(template_ids),
            "covered_checks": sorted(covered_checks),
            "external_checks": sorted(external_checks),
            "duplicate_ids": duplicate_ids,
            "missing_fields": missing_fields,
            "missing_templates": missing_templates,
            "missing_required_checks": missing_required_checks,
            "missing_external_plan_checks": missing_external_plan_checks,
        },
    )


def resolve_real_template_ids(
    client: httpx.Client,
    *,
    explicit_template_ids: list[str],
    run_default: bool,
    run_all_enabled: bool,
    run_asset_pipelines: bool = False,
    run_special_pipelines: bool = False,
) -> list[str]:
    if run_all_enabled:
        response = client.get("/api/generation/templates")
        response.raise_for_status()
        template_ids = [
            template["id"]
            for template in response.json().get("templates", [])
            if template.get("enabled")
        ]
    else:
        template_ids = list(explicit_template_ids)
        if run_default and not template_ids:
            template_ids = list(DEFAULT_REAL_TEMPLATE_IDS)

    if run_special_pipelines:
        template_ids.extend(SPECIAL_PIPELINE_TEMPLATE_IDS)
    if run_asset_pipelines:
        template_ids.extend(ASSET_MONTAGE_TEMPLATE_IDS)

    return _dedupe_preserving_order(template_ids)


def prepare_real_generation_assets(
    *,
    image_path: str,
    reference_video_path: str,
    needs_reference_video: bool,
) -> RealGenerationAssetPaths:
    image = Path(image_path).expanduser() if image_path else default_image_asset_path()
    if not image.exists():
        raise FileNotFoundError(f"Image asset does not exist: {image}")

    reference_video: Path | None = None
    if needs_reference_video:
        reference_video = (
            Path(reference_video_path).expanduser()
            if reference_video_path
            else default_reference_video_path()
        )
        if not reference_video.exists():
            create_reference_video(reference_video)
        if not reference_video.exists():
            raise FileNotFoundError(f"Reference video does not exist: {reference_video}")

    return RealGenerationAssetPaths(
        image=image.resolve(),
        reference_video=reference_video.resolve() if reference_video else None,
    )


def default_image_asset_path() -> Path:
    candidates = [
        Path("docs/images/1080x1920/image_default.jpg"),
        Path("resources/example.png"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "No default image asset found. Pass --asset-image with a readable image path."
    )


def default_reference_video_path() -> Path:
    return Path("/tmp/pixelle-streamlit-migration-reference.mp4")


def create_reference_video(path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError(
            "ffmpeg is required to create a reference video. Pass --reference-video "
            "with an existing mp4 or install ffmpeg."
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x568:d=2",
            "-vf",
            "format=yuv420p",
            "-movflags",
            "+faststart",
            str(path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def build_real_template_input(
    template_id: str,
    asset_paths: RealGenerationAssetPaths,
) -> dict[str, Any]:
    image_path = str(asset_paths.image)
    if template_id in {
        "petwoods_xhs_daily_v1",
        "petwoods_xhs_static_subtitle_v1",
        "petwoods_xhs_quality_explainer_v1",
    }:
        return {
            "script": SAMPLE_SCRIPT,
            "title": "猫咪喝水小技巧",
        }
    if template_id == "petwoods_xhs_topic_to_video_v1":
        return {
            "topic": SAMPLE_TOPIC,
            "title": "猫咪喝水改善方法",
            "n_scenes": 2,
        }
    if template_id in {
        "petwoods_xhs_asset_enhanced_v1",
        "petwoods_xhs_real_material_montage_v1",
    }:
        return {
            "assets": [image_path],
            "video_title": "猫咪日常素材",
            "intent": SAMPLE_ASSET_INTENT,
            "duration": 6,
        }
    if template_id == "pixelle_i2v_basic_v1":
        return {
            "assets": [image_path],
            "prompt": "让画面里的猫咪轻轻抬头，保持真实自然的居家氛围。",
            "title": "猫咪轻动作",
            "duration": 4,
        }
    if template_id == "pixelle_action_transfer_basic_v1":
        if asset_paths.reference_video is None:
            raise ValueError("Action transfer requires a reference video asset.")
        return {
            "reference_video": str(asset_paths.reference_video),
            "assets": [image_path],
            "prompt": "把参考视频中的简单动作迁移到目标图片，保持画面稳定。",
            "title": "动作迁移验收",
            "duration": 2,
        }
    if template_id == "pixelle_digital_human_basic_v1":
        return {
            "character_assets": [image_path],
            "script": "大家好，今天分享一个猫咪喝水的小技巧。",
            "title": "数字人验收",
            "mode": "customize",
            "tts_inference_mode": "local",
            "tts_voice": "zh-CN-YunjianNeural",
            "tts_speed": 1,
        }

    raise ValueError(
        f"No real E2E sample input is registered for template {template_id!r}. "
        "Dedicated product entries need dedicated verifier support."
    )


def run_real_template_check(
    client: httpx.Client,
    *,
    template_id: str,
    asset_paths: RealGenerationAssetPaths,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    try:
        template_input = build_real_template_input(template_id, asset_paths)
    except Exception as exc:
        return Check(
            f"real_generation_{template_id}",
            False,
            f"sample input error: {exc}",
        )

    response = client.post(
        f"/api/generation/templates/{template_id}/tasks",
        json={
            "input": template_input,
            "metadata": {
                "source": "streamlit_migration_verifier",
                "purpose": "real_generation_e2e",
                "template_id": template_id,
            },
        },
    )
    if response.status_code != 200:
        return Check(
            f"real_generation_{template_id}",
            False,
            f"submit HTTP {response.status_code}",
            {"response": _safe_response_json(response)},
        )

    task_id = response.json().get("generation_task_id")
    deadline = time.monotonic() + timeout_seconds
    last_task: dict[str, Any] = {}
    while time.monotonic() < deadline:
        task_response = client.get(f"/api/generation/tasks/{task_id}")
        if task_response.status_code != 200:
            return Check(
                f"real_generation_{template_id}",
                False,
                f"status HTTP {task_response.status_code}",
                {"task_id": task_id, "response": _safe_response_json(task_response)},
            )
        last_task = task_response.json()
        status = last_task.get("status")
        if status == "completed":
            result_response = client.get(f"/api/generation/tasks/{task_id}/result")
            result_payload = _safe_response_json(result_response)
            has_result_artifact = bool(
                (isinstance(result_payload, dict) and result_payload.get("primary_video"))
                or (isinstance(result_payload, dict) and result_payload.get("artifacts"))
            )
            return Check(
                f"real_generation_{template_id}",
                result_response.status_code == 200 and has_result_artifact,
                (
                    f"completed; result HTTP {result_response.status_code}; "
                    f"has_artifact={has_result_artifact}"
                ),
                {"task_id": task_id, "result": result_payload},
            )
        if status in {"failed", "cancelled"}:
            return Check(
                f"real_generation_{template_id}",
                False,
                f"terminal status={status}",
                {"task_id": task_id, "task": last_task},
            )
        time.sleep(poll_interval)

    if cancel_on_timeout:
        client.delete(f"/api/generation/tasks/{task_id}")
    blocker = classify_task_blocker(last_task)
    timeout_action = "task cancelled" if cancel_on_timeout else "task left running"
    resume_command = (
        "uv run python scripts/verify_streamlit_migration.py "
        f"--existing-real-template {template_id}:{task_id} "
        f"--timeout {timeout_seconds} --poll-interval {poll_interval:g}"
    )
    return Check(
        f"real_generation_{template_id}",
        False,
        f"timed out after {timeout_seconds}s; {timeout_action}; blocker={blocker}",
        {
            "task_id": task_id,
            "blocker": blocker,
            "cancelled_on_timeout": cancel_on_timeout,
            "resume_command": resume_command,
            "last_task": last_task,
        },
    )


def run_local_render_smoke_check(
    client: httpx.Client,
    *,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    response = client.post(
        "/api/generation/templates/petwoods_xhs_static_subtitle_v1/tasks",
        json={
            "input": {
                "script": SAMPLE_SCRIPT,
                "title": "本地合成验收",
                "split_mode": "paragraph",
            },
            "metadata": {
                "source": "streamlit_migration_verifier",
                "purpose": "local_render_smoke",
                "provider_e2e": False,
            },
        },
    )
    if response.status_code != 200:
        return Check(
            "local_render_smoke",
            False,
            f"submit HTTP {response.status_code}",
            {"response": _safe_response_json(response)},
        )

    task_id = response.json().get("generation_task_id")
    return poll_generation_task_result(
        client,
        name="local_render_smoke",
        task_id=task_id,
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=cancel_on_timeout,
    )


def run_existing_generation_task_check(
    client: httpx.Client,
    *,
    task_id: str,
    timeout_seconds: int,
    poll_interval: float,
) -> Check:
    normalized_task_id = task_id.strip()
    if not normalized_task_id:
        return Check(
            "existing_generation_task",
            False,
            "no generation task id provided",
            {"task_id": task_id},
        )
    return poll_generation_task_result(
        client,
        name="existing_generation_task",
        task_id=normalized_task_id,
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=False,
    )


def run_existing_real_template_check(
    client: httpx.Client,
    *,
    spec: str,
    timeout_seconds: int,
    poll_interval: float,
) -> Check:
    try:
        template_id, task_id = parse_existing_real_template_spec(spec)
    except ValueError as exc:
        return Check(
            "existing_real_template",
            False,
            str(exc),
            {"spec": spec},
        )

    if template_id in {"pixelle_script_review_v1", "pixelle_batch_production_v1"}:
        return Check(
            f"real_generation_{template_id}",
            False,
            "dedicated batch/script-review entries cannot be checked as a single template task",
            {"template_id": template_id, "task_id": task_id},
        )

    if template_id not in EXPECTED_TEMPLATES:
        return Check(
            f"real_generation_{template_id}",
            False,
            f"unknown template id: {template_id}",
            {"template_id": template_id, "task_id": task_id},
        )

    return poll_generation_task_result(
        client,
        name=f"real_generation_{template_id}",
        task_id=task_id,
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=False,
        extra_data={"template_id": template_id, "resumed_existing_task": True},
    )


def parse_existing_real_template_spec(spec: str) -> tuple[str, str]:
    if ":" not in spec:
        raise ValueError("expected TEMPLATE_ID:TASK_ID")
    template_id, task_id = (part.strip() for part in spec.split(":", 1))
    if not template_id or not task_id:
        raise ValueError("expected non-empty TEMPLATE_ID:TASK_ID")
    return template_id, task_id


def poll_generation_task_result(
    client: httpx.Client,
    *,
    name: str,
    task_id: str,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
    extra_data: dict[str, Any] | None = None,
) -> Check:
    base_data = {"task_id": task_id, **(extra_data or {})}
    deadline = time.monotonic() + timeout_seconds
    last_task: dict[str, Any] = {}
    while time.monotonic() < deadline:
        task_response = client.get(f"/api/generation/tasks/{task_id}")
        if task_response.status_code != 200:
            return Check(
                name,
                False,
                f"status HTTP {task_response.status_code}",
                {**base_data, "response": _safe_response_json(task_response)},
            )
        last_task = task_response.json()
        status = last_task.get("status")
        if status == "completed":
            result_response = client.get(f"/api/generation/tasks/{task_id}/result")
            result_payload = _safe_response_json(result_response)
            has_result_artifact = bool(
                (isinstance(result_payload, dict) and result_payload.get("primary_video"))
                or (isinstance(result_payload, dict) and result_payload.get("artifacts"))
            )
            return Check(
                name,
                result_response.status_code == 200 and has_result_artifact,
                (
                    f"completed; result HTTP {result_response.status_code}; "
                    f"has_artifact={has_result_artifact}"
                ),
                {**base_data, "result": result_payload},
            )
        if status in {"failed", "cancelled"}:
            return Check(
                name,
                False,
                f"terminal status={status}",
                {**base_data, "task": last_task},
            )
        time.sleep(poll_interval)

    if cancel_on_timeout:
        client.delete(f"/api/generation/tasks/{task_id}")
    blocker = classify_task_blocker(last_task)
    timeout_action = "task cancelled" if cancel_on_timeout else "task left running"
    return Check(
        name,
        False,
        f"timed out after {timeout_seconds}s; {timeout_action}; blocker={blocker}",
        {
            **base_data,
            "blocker": blocker,
            "cancelled_on_timeout": cancel_on_timeout,
            "last_task": last_task,
        },
    )


def run_real_batch_check(
    client: httpx.Client,
    *,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    response = client.post(
        "/api/generation/batches",
        json={
            "template_id": "petwoods_xhs_static_subtitle_v1",
            "items": [
                {
                    "input": {
                        "script": SAMPLE_SCRIPT,
                        "title": "批量验收猫咪喝水",
                        "split_mode": "paragraph",
                    },
                    "metadata": {
                        "source": "streamlit_migration_verifier",
                        "purpose": "real_batch_e2e",
                        "provider_e2e": False,
                    },
                }
            ],
            "metadata": {
                "source": "streamlit_migration_verifier",
                "purpose": "real_batch_e2e",
                "provider_e2e": False,
            },
        },
    )
    if response.status_code != 200:
        return Check(
            "real_batch_generation",
            False,
            f"submit HTTP {response.status_code}",
            {"response": _safe_response_json(response)},
        )

    batch = response.json()
    return poll_generation_batch(
        client,
        name="real_batch_generation",
        batch_id=batch["batch_id"],
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=cancel_on_timeout,
    )


def run_real_script_review_check(
    client: httpx.Client,
    *,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    draft_response = client.post(
        "/api/generation/script-review/draft-sets",
        json={
            "topics": [SAMPLE_TOPIC],
            "languages": ["Chinese"],
            "metadata": {
                "source": "streamlit_migration_verifier",
                "purpose": "real_script_review_e2e",
            },
        },
    )
    if draft_response.status_code != 200:
        return Check(
            "real_script_review_generation",
            False,
            f"draft HTTP {draft_response.status_code}",
            {"response": _safe_response_json(draft_response)},
        )

    draft_set = draft_response.json()
    if draft_set.get("status") not in {"drafted", "partial_failed"}:
        return Check(
            "real_script_review_generation",
            False,
            f"draft status={draft_set.get('status')}",
            {"draft_set": draft_set},
        )
    if not draft_set.get("drafts"):
        return Check(
            "real_script_review_generation",
            False,
            "draft set returned no drafts",
            {"draft_set": draft_set},
        )

    submit_response = client.post(
        f"/api/generation/script-review/draft-sets/{draft_set['draft_set_id']}/tasks",
        json={
            "drafts": draft_set["drafts"],
            "base_params": script_review_static_base_params(),
            "metadata": {
                "source": "streamlit_migration_verifier",
                "purpose": "real_script_review_e2e",
            },
        },
    )
    if submit_response.status_code != 200:
        return Check(
            "real_script_review_generation",
            False,
            f"submit HTTP {submit_response.status_code}",
            {
                "draft_set_id": draft_set["draft_set_id"],
                "response": _safe_response_json(submit_response),
            },
        )

    batch = submit_response.json().get("batch") or {}
    if not batch.get("batch_id"):
        return Check(
            "real_script_review_generation",
            False,
            "submit response did not include a batch id",
            {"response": _safe_response_json(submit_response)},
        )

    return poll_generation_batch(
        client,
        name="real_script_review_generation",
        batch_id=batch["batch_id"],
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=cancel_on_timeout,
        extra_data={"draft_set_id": draft_set["draft_set_id"]},
    )


def run_script_review_submit_only_check(
    client: httpx.Client,
    *,
    draft_set_id: str | None,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    draft_set_check = get_script_review_draft_set_for_submit(
        client,
        draft_set_id=draft_set_id,
    )
    if not draft_set_check.ok:
        return draft_set_check

    draft_set = draft_set_check.data["draft_set"]
    submit_response = client.post(
        f"/api/generation/script-review/draft-sets/{draft_set['draft_set_id']}/tasks",
        json={
            "drafts": draft_set["drafts"],
            "base_params": script_review_static_base_params(),
            "metadata": {
                "source": "streamlit_migration_verifier",
                "purpose": "script_review_submit_only",
                "llm_draft_e2e": False,
            },
        },
    )
    if submit_response.status_code != 200:
        return Check(
            "script_review_submit_only",
            False,
            f"submit HTTP {submit_response.status_code}",
            {
                "draft_set_id": draft_set["draft_set_id"],
                "response": _safe_response_json(submit_response),
            },
        )

    batch = submit_response.json().get("batch") or {}
    if not batch.get("batch_id"):
        return Check(
            "script_review_submit_only",
            False,
            "submit response did not include a batch id",
            {"draft_set_id": draft_set["draft_set_id"], "response": _safe_response_json(submit_response)},
        )

    return poll_generation_batch(
        client,
        name="script_review_submit_only",
        batch_id=batch["batch_id"],
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=cancel_on_timeout,
        extra_data={
            "draft_set_id": draft_set["draft_set_id"],
            "llm_draft_e2e": False,
        },
    )


def get_script_review_draft_set_for_submit(
    client: httpx.Client,
    *,
    draft_set_id: str | None,
) -> Check:
    if draft_set_id:
        response = client.get(f"/api/generation/script-review/draft-sets/{draft_set_id}")
        if response.status_code != 200:
            return Check(
                "script_review_submit_only",
                False,
                f"draft set HTTP {response.status_code}",
                {"draft_set_id": draft_set_id, "response": _safe_response_json(response)},
            )
        draft_set = response.json()
    else:
        response = client.get("/api/generation/script-review/draft-sets")
        if response.status_code != 200:
            return Check(
                "script_review_submit_only",
                False,
                f"draft sets HTTP {response.status_code}",
                {"response": _safe_response_json(response)},
            )
        draft_sets = response.json().get("draft_sets") or []
        draft_set = next(
            (candidate for candidate in draft_sets if candidate.get("drafts")),
            None,
        )
        if not draft_set:
            return Check(
                "script_review_submit_only",
                False,
                "no existing script-review draft set with drafts",
                {"draft_sets_count": len(draft_sets)},
            )

    if not draft_set.get("drafts"):
        return Check(
            "script_review_submit_only",
            False,
            "draft set has no drafts",
            {"draft_set_id": draft_set.get("draft_set_id"), "draft_set": draft_set},
        )

    return Check(
        "script_review_submit_only",
        True,
        "draft set loaded",
        {"draft_set": draft_set},
    )


def script_review_static_base_params() -> dict[str, Any]:
    return {
        "frame_template": "1080x1920/static_default.html",
        "tts_inference_mode": "local",
        "tts_voice": "zh-CN-YunjianNeural",
        "tts_speed": 1,
        "n_scenes": 2,
    }


def run_publish_readiness_check(
    client: httpx.Client,
    *,
    platforms: list[str] | None = None,
) -> Check:
    platform_response = client.get("/api/publish/platforms")
    timezone_response = client.get("/api/publish/timezones")
    if platform_response.status_code != 200:
        return Check(
            "publish_readiness",
            False,
            f"platforms HTTP {platform_response.status_code}",
            {"response": _safe_response_json(platform_response)},
        )
    if timezone_response.status_code != 200:
        return Check(
            "publish_readiness",
            False,
            f"timezones HTTP {timezone_response.status_code}",
            {"response": _safe_response_json(timezone_response)},
        )

    request_payload = {"platforms": platforms} if platforms else {"platforms": None}
    check_response = client.post("/api/publish/check", json=request_payload)
    response_payload = _safe_response_json(check_response)
    if check_response.status_code != 200:
        return Check(
            "publish_readiness",
            False,
            f"check HTTP {check_response.status_code}",
            {"response": response_payload},
        )

    checks = response_payload.get("checks") if isinstance(response_payload, dict) else []
    failed_checks = [
        check
        for check in checks or []
        if isinstance(check, dict) and check.get("ok") is not True
    ]
    ok = bool(checks) and not failed_checks
    return Check(
        "publish_readiness",
        ok,
        (
            "publish readiness passed"
            if ok
            else "publish readiness failed: "
            + ", ".join(str(check.get("name") or "unknown") for check in failed_checks)
        ),
        {
            "platforms": platforms,
            "checks": checks or [],
            "failed_checks": failed_checks,
            "platforms_response": _safe_response_json(platform_response),
            "timezones_response": _safe_response_json(timezone_response),
        },
    )


def run_real_publish_e2e_check(
    client: httpx.Client,
    *,
    platforms: list[str],
    confirmed: bool,
    task_id: str | None,
    caption: str,
    title: str,
    due_at: str | None,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    if not confirmed:
        return Check(
            "real_publish_e2e",
            False,
            "real publish E2E requires --confirm-real-publish",
            {
                "platforms": platforms,
                "publish_endpoint_called": False,
                "reason": "Publishing can upload media and create Buffer posts.",
            },
        )

    readiness = run_publish_readiness_check(client, platforms=platforms)
    if not readiness.ok:
        return Check(
            "real_publish_e2e",
            False,
            "publish readiness failed before real publish",
            {"platforms": platforms, "readiness": readiness.__dict__},
        )

    source_task_id = task_id
    source_check: Check | None = None
    if not source_task_id:
        source_check = create_static_publish_source_task(
            client,
            timeout_seconds=timeout_seconds,
            poll_interval=poll_interval,
            cancel_on_timeout=cancel_on_timeout,
        )
        if not source_check.ok:
            return Check(
                "real_publish_e2e",
                False,
                "could not create completed source video for publish",
                {"platforms": platforms, "source_check": source_check.__dict__},
            )
        source_task_id = str(source_check.data.get("task_id") or "")

    if not source_task_id:
        return Check(
            "real_publish_e2e",
            False,
            "publish source task id is missing",
            {"platforms": platforms, "source_check": source_check.__dict__ if source_check else None},
        )

    publish_response = client.post(
        f"/api/publish/tasks/{source_task_id}",
        json={
            "platforms": platforms,
            "caption": caption,
            "title": title,
            "due_at": due_at,
        },
    )
    publish_payload = _safe_response_json(publish_response)
    if publish_response.status_code != 200:
        return Check(
            "real_publish_e2e",
            False,
            f"publish HTTP {publish_response.status_code}",
            {
                "task_id": source_task_id,
                "platforms": platforms,
                "response": publish_payload,
                "source_check": source_check.__dict__ if source_check else None,
            },
        )

    record = publish_payload.get("record") if isinstance(publish_payload, dict) else None
    if not isinstance(record, dict):
        return Check(
            "real_publish_e2e",
            False,
            "publish response did not include a record",
            {"task_id": source_task_id, "platforms": platforms, "response": publish_payload},
        )

    selected_jobs = [
        job
        for job in record.get("jobs", [])
        if isinstance(job, dict) and job.get("platform") in platforms
    ]
    failed_jobs = [
        job
        for job in selected_jobs
        if job.get("status") == "failed" or job.get("error")
    ]
    missing_jobs = [platform for platform in platforms if platform not in {job.get("platform") for job in selected_jobs}]
    jobs_with_post_ids = [job for job in selected_jobs if job.get("buffer_post_id")]
    ok = (
        bool(selected_jobs)
        and not failed_jobs
        and not missing_jobs
        and len(jobs_with_post_ids) == len(selected_jobs)
        and bool(record.get("public_video_url"))
    )

    record_response = client.get(f"/api/publish/tasks/{source_task_id}/record")
    return Check(
        "real_publish_e2e",
        ok,
        "real publish E2E passed" if ok else "real publish E2E failed",
        {
            "task_id": source_task_id,
            "platforms": platforms,
            "source_check": source_check.__dict__ if source_check else None,
            "record": record,
            "selected_jobs": selected_jobs,
            "failed_jobs": failed_jobs,
            "missing_jobs": missing_jobs,
            "record_readback_status": record_response.status_code,
            "record_readback": _safe_response_json(record_response),
        },
    )


def create_static_publish_source_task(
    client: httpx.Client,
    *,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    response = client.post(
        "/api/generation/templates/petwoods_xhs_static_subtitle_v1/tasks",
        json={
            "input": {
                "script": SAMPLE_SCRIPT,
                "title": "发布验收视频",
                "split_mode": "paragraph",
            },
            "metadata": {
                "source": "streamlit_migration_verifier",
                "purpose": "real_publish_e2e_source_video",
                "provider_e2e": False,
            },
        },
    )
    if response.status_code != 200:
        return Check(
            "real_publish_e2e_source_video",
            False,
            f"submit HTTP {response.status_code}",
            {"response": _safe_response_json(response)},
        )

    task_id = response.json().get("generation_task_id")
    return poll_generation_task_result(
        client,
        name="real_publish_e2e_source_video",
        task_id=task_id,
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=cancel_on_timeout,
    )


def run_provider_readiness_check(client: httpx.Client) -> Check:
    diagnostics_response = client.get("/api/settings/diagnostics")
    templates_response = client.get("/api/generation/templates")
    media_workflows_response = client.get("/api/resources/workflows/media")

    endpoint_errors = []
    if diagnostics_response.status_code != 200:
        endpoint_errors.append(f"diagnostics HTTP {diagnostics_response.status_code}")
    if templates_response.status_code != 200:
        endpoint_errors.append(f"templates HTTP {templates_response.status_code}")
    if media_workflows_response.status_code != 200:
        endpoint_errors.append(f"media workflows HTTP {media_workflows_response.status_code}")
    if endpoint_errors:
        return Check(
            "provider_readiness",
            False,
            "provider readiness endpoints failed: " + ", ".join(endpoint_errors),
            {
                "endpoint_errors": endpoint_errors,
                "diagnostics": _safe_response_json(diagnostics_response),
                "templates": _safe_response_json(templates_response),
                "media_workflows": _safe_response_json(media_workflows_response),
            },
        )

    diagnostics_payload = diagnostics_response.json()
    diagnostics_by_id = {
        check.get("id"): check
        for check in diagnostics_payload.get("checks") or []
        if isinstance(check, dict)
    }
    diagnostic_checks = []
    for diagnostic_id in PROVIDER_READINESS_DIAGNOSTIC_IDS:
        diagnostic = diagnostics_by_id.get(diagnostic_id)
        diagnostic_checks.append(
            {
                "id": diagnostic_id,
                "ok": bool(diagnostic and diagnostic.get("ok") is True),
                "message": diagnostic.get("message") if diagnostic else "missing diagnostic",
            }
        )

    templates = templates_response.json().get("templates") or []
    provider_templates = [
        template
        for template in templates
        if template.get("id") in PROVIDER_E2E_TEMPLATE_IDS
    ]
    missing_templates = sorted(
        set(PROVIDER_E2E_TEMPLATE_IDS) - {template.get("id") for template in provider_templates}
    )

    media_workflow_keys = {
        workflow.get("key")
        for workflow in media_workflows_response.json().get("workflows") or []
        if isinstance(workflow, dict)
    }
    workflow_refs = collect_provider_workflow_refs(provider_templates)
    workflow_checks = [
        {
            "ref": ref,
            "file_exists": workflow_ref_path(ref).exists(),
            "listed_by_media_resources": workflow_ref_key(ref) in media_workflow_keys,
        }
        for ref in workflow_refs
    ]
    missing_workflow_files = [
        check["ref"] for check in workflow_checks if not check["file_exists"]
    ]

    failed_diagnostics = [check for check in diagnostic_checks if not check["ok"]]
    ok = not failed_diagnostics and not missing_templates and not missing_workflow_files
    detail = "provider readiness passed"
    if not ok:
        blockers = []
        if failed_diagnostics:
            blockers.append(
                "diagnostics="
                + ",".join(check["id"] for check in failed_diagnostics)
            )
        if missing_templates:
            blockers.append("templates=" + ",".join(missing_templates))
        if missing_workflow_files:
            blockers.append("workflow_files=" + ",".join(missing_workflow_files))
        detail = "provider readiness failed: " + "; ".join(blockers)

    return Check(
        "provider_readiness",
        ok,
        detail,
        {
            "diagnostic_checks": diagnostic_checks,
            "failed_diagnostics": failed_diagnostics,
            "provider_templates": [template.get("id") for template in provider_templates],
            "missing_templates": missing_templates,
            "workflow_checks": workflow_checks,
            "missing_workflow_files": missing_workflow_files,
            "resource_listed_workflows": sorted(key for key in media_workflow_keys if key),
            "runtime_note": (
                "This check is non-mutating. It proves configuration and workflow file "
                "readiness, not provider queue/runtime completion."
            ),
        },
    )


def run_provider_task_status_check(
    *,
    provider_task_ids: list[str],
    executor_factory=RunningHubExecutor,
    config_manager_factory=None,
) -> Check:
    task_ids = _dedupe_preserving_order(
        [task_id.strip() for task_id in provider_task_ids if task_id.strip()]
    )
    if not task_ids:
        return Check(
            "provider_task_status",
            False,
            "no provider task ids provided",
            {"provider": "runninghub", "tasks": []},
        )

    try:
        if config_manager_factory is None:
            from pixelle_video.config.manager import ConfigManager

            config_manager_factory = ConfigManager
        config_manager = config_manager_factory()
        comfy_config = config_manager.config.comfyui
        api_key = getattr(comfy_config, "runninghub_api_key", None)
        timeout = getattr(comfy_config, "runninghub_timeout", None)
        instance_type = getattr(comfy_config, "runninghub_instance_type", None)
    except Exception as exc:
        return Check(
            "provider_task_status",
            False,
            f"could not load RunningHub config: {exc}",
            {"provider": "runninghub", "tasks": task_ids},
        )

    if not api_key:
        return Check(
            "provider_task_status",
            False,
            "RunningHub API key is not configured",
            {"provider": "runninghub", "tasks": task_ids},
        )

    try:
        task_results = asyncio.run(
            _query_runninghub_task_statuses(
                task_ids,
                api_key=api_key,
                timeout=timeout,
                instance_type=instance_type,
                executor_factory=executor_factory,
            )
        )
    except Exception as exc:
        return Check(
            "provider_task_status",
            False,
            f"provider task status query failed: {exc}",
            {"provider": "runninghub", "tasks": task_ids},
        )

    failed = [result for result in task_results if not result.get("query_ok")]
    ok = not failed
    return Check(
        "provider_task_status",
        ok,
        (
            "provider task status query passed"
            if ok
            else "provider task status query failed: "
            + ", ".join(str(result.get("provider_task_id")) for result in failed)
        ),
        {
            "provider": "runninghub",
            "tasks": task_results,
            "runtime_note": (
                "This check only re-queries existing provider task ids. It does not "
                "submit new generation tasks and does not satisfy provider E2E completion."
            ),
        },
    )


async def _query_runninghub_task_statuses(
    task_ids: list[str],
    *,
    api_key: str,
    timeout: int | None,
    instance_type: str | None,
    executor_factory=RunningHubExecutor,
) -> list[dict[str, Any]]:
    executor = executor_factory(
        api_key=api_key,
        timeout=timeout,
        instance_type=instance_type,
    )
    try:
        results = []
        for task_id in task_ids:
            try:
                status_info = await executor.client.query_task_status(task_id)
            except Exception as exc:
                results.append(
                    {
                        "provider_task_id": task_id,
                        "query_ok": False,
                        "error": str(exc),
                        "exception_type": type(exc).__name__,
                    }
                )
                continue

            results.append(
                {
                    "provider_task_id": task_id,
                    "query_ok": True,
                    "status": status_info.get("status"),
                    "message": status_info.get("msg"),
                    "raw": {
                        key: value
                        for key, value in status_info.items()
                        if key not in {"apiKey", "apikey", "api_key", "token"}
                    },
                }
            )
        return results
    finally:
        await executor.close()


def collect_provider_workflow_refs(templates: list[dict[str, Any]]) -> list[str]:
    refs: list[str] = []
    for template in templates:
        fixed_params = template.get("fixed_params") or {}
        workflow_key = fixed_params.get("workflow_key")
        if isinstance(workflow_key, str) and workflow_key.strip():
            refs.append(workflow_key.strip())
        workflow_paths = fixed_params.get("workflow_paths")
        if isinstance(workflow_paths, dict):
            for value in workflow_paths.values():
                if isinstance(value, str) and value.strip():
                    refs.append(value.strip())
    return _dedupe_preserving_order(refs)


def workflow_ref_key(ref: str) -> str:
    if ref.startswith("workflows/"):
        return ref[len("workflows/") :]
    return ref


def workflow_ref_path(ref: str) -> Path:
    if ref.startswith("workflows/"):
        return Path(ref)
    return Path("workflows") / ref


def run_management_readiness_check(client: httpx.Client) -> Check:
    endpoint_checks = [
        _read_shape(
            client,
            "history_tasks",
            "/api/history/tasks?page=1&page_size=1",
            lambda payload: isinstance(payload.get("tasks"), list)
            and isinstance(payload.get("total"), int)
            and isinstance(payload.get("page"), int)
            and isinstance(payload.get("page_size"), int),
        ),
        _read_shape(
            client,
            "history_statistics",
            "/api/history/statistics",
            lambda payload: any(key in payload for key in ("total_tasks", "completed", "failed")),
        ),
        _read_shape(
            client,
            "settings_config",
            "/api/settings/config",
            validate_settings_config_payload,
        ),
        _read_shape(
            client,
            "settings_diagnostics",
            "/api/settings/diagnostics",
            validate_settings_diagnostics_payload,
        ),
        _read_shape(
            client,
            "resource_bgm",
            "/api/resources/bgm",
            lambda payload: isinstance(payload.get("bgm_files"), list),
        ),
        _read_shape(
            client,
            "resource_templates",
            "/api/resources/templates",
            lambda payload: isinstance(payload.get("templates"), list),
        ),
        _read_shape(
            client,
            "resource_media_workflows",
            "/api/resources/workflows/media",
            lambda payload: isinstance(payload.get("workflows"), list),
        ),
        _read_shape(
            client,
            "resource_tts_workflows",
            "/api/resources/workflows/tts",
            lambda payload: isinstance(payload.get("workflows"), list),
        ),
        _read_shape(
            client,
            "help_faq",
            "/api/help/faq?language=zh_CN",
            lambda payload: payload.get("language") == "zh_CN"
            and isinstance(payload.get("sections"), list)
            and bool(payload.get("content")),
        ),
    ]
    failed_checks = [check for check in endpoint_checks if not check["ok"]]
    ok = not failed_checks
    return Check(
        "management_readiness",
        ok,
        (
            "management readiness passed"
            if ok
            else "management readiness failed: "
            + ", ".join(str(check["name"]) for check in failed_checks)
        ),
        {"checks": endpoint_checks, "failed_checks": failed_checks},
    )


def run_browser_smoke_check(frontend_url: str, timeout_seconds: int = 45) -> Check:
    node = shutil.which("node")
    if not node:
        return Check(
            "browser_smoke",
            False,
            "node executable not found; cannot run Playwright browser smoke",
        )

    app_dir = Path("apps/production-template-demo")
    if not app_dir.exists():
        return Check(
            "browser_smoke",
            False,
            f"React app directory not found: {app_dir}",
        )

    env = os.environ.copy()
    env["PIXELLE_FRONTEND_URL"] = frontend_url
    try:
        completed = subprocess.run(
            [node, "--input-type=module", "-e", BROWSER_SMOKE_SCRIPT],
            cwd=app_dir,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return Check(
            "browser_smoke",
            False,
            f"browser smoke timed out after {timeout_seconds}s",
            {
                "stdout": exc.stdout,
                "stderr": exc.stderr,
                "frontend_url": frontend_url,
            },
        )
    except Exception as exc:
        return Check(
            "browser_smoke",
            False,
            f"browser smoke could not start: {exc}",
            {"frontend_url": frontend_url},
        )

    payload = _safe_json_text(completed.stdout)
    if completed.returncode == 0 and isinstance(payload, dict) and payload.get("ok") is True:
        return Check(
            "browser_smoke",
            True,
            "React Streamlit-replacement entries rendered without browser errors",
            payload,
        )

    data: dict[str, Any] = {
        "frontend_url": frontend_url,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
    if isinstance(payload, dict):
        data.update(payload)
    detail = "browser smoke failed"
    if isinstance(payload, dict) and payload.get("errors"):
        detail = "browser smoke failed: " + "; ".join(
            str(error) for error in payload["errors"][:3]
        )
    elif completed.stderr.strip():
        detail = "browser smoke failed: " + completed.stderr.strip().splitlines()[-1]

    return Check("browser_smoke", False, detail, data)


def build_streamlit_completion_gate(checks: list[Check]) -> Check:
    by_name = {check.name: check for check in checks}
    missing = [
        name
        for name in STREAMLIT_COMPLETION_REQUIRED_CHECKS
        if name not in by_name
    ]
    failed = [
        name
        for name in STREAMLIT_COMPLETION_REQUIRED_CHECKS
        if name in by_name and not by_name[name].ok
    ]
    missing_details = [
        build_streamlit_completion_gap(name, status="missing")
        for name in missing
    ]
    failed_details = [
        build_streamlit_completion_gap(
            name,
            status="failed",
            detail=by_name[name].detail,
        )
        for name in failed
    ]
    capability_report = build_capability_completion_report(checks)
    ok = not missing and not failed
    return Check(
        "streamlit_replacement_gate",
        ok,
        (
            "streamlit replacement gate passed"
            if ok
            else "streamlit replacement gate failed"
        ),
        {
            "required": STREAMLIT_COMPLETION_REQUIRED_CHECKS,
            "missing": missing,
            "failed": failed,
            "missing_details": missing_details,
            "failed_details": failed_details,
            "capability_summary": capability_report["summary"],
            "capability_gaps": capability_report["gaps"],
            "requires_confirmation": [
                gap
                for gap in [*missing_details, *failed_details]
                if gap.get("requires_confirmation")
            ],
        },
    )


def build_capability_completion_report(checks: list[Check]) -> dict[str, Any]:
    by_name = {check.name: check for check in checks}
    capabilities = []
    for item in STREAMLIT_CAPABILITY_MATRIX:
        evidence = []
        for check_name in item.get("evidence_checks", []):
            check = by_name.get(check_name)
            if check is None:
                status = "missing"
                detail = None
            elif check.ok:
                status = "passed"
                detail = check.detail
            else:
                status = "failed"
                detail = check.detail
            row = {"check": check_name, "status": status}
            if detail and status == "failed":
                row["detail"] = detail
            evidence.append(row)

        missing_evidence = [
            row["check"] for row in evidence if row["status"] == "missing"
        ]
        failed_evidence = [
            row["check"] for row in evidence if row["status"] == "failed"
        ]
        complete = not missing_evidence and not failed_evidence
        capabilities.append(
            {
                "id": item["id"],
                "capability": item["capability"],
                "phase": item["phase"],
                "react_surface": item["react_surface"],
                "migration_decision": item["migration_decision"],
                "template_ids": item.get("template_ids", []),
                "requires_external_e2e": bool(item.get("requires_external_e2e")),
                "status": "complete" if complete else "incomplete",
                "missing_evidence": missing_evidence,
                "failed_evidence": failed_evidence,
                "evidence": evidence,
            }
        )

    gaps = [capability for capability in capabilities if capability["status"] != "complete"]
    return {
        "summary": {
            "total": len(capabilities),
            "complete": len(capabilities) - len(gaps),
            "incomplete": len(gaps),
            "external_incomplete": len(
                [
                    capability
                    for capability in gaps
                    if capability["requires_external_e2e"]
                ]
            ),
        },
        "capabilities": capabilities,
        "gaps": gaps,
    }


def build_external_e2e_plan() -> Check:
    steps = []
    for index, check_name in enumerate(EXTERNAL_E2E_CHECK_ORDER, start=1):
        metadata = STREAMLIT_COMPLETION_CHECK_DETAILS[check_name]
        command = metadata["command"]
        steps.append(
            {
                "order": index,
                "check": check_name,
                "capability": metadata["capability"],
                "phase": metadata["phase"],
                "command": command,
                "requires_confirmation": bool(metadata["requires_confirmation"]),
                "effects": EXTERNAL_E2E_EFFECTS.get(check_name, []),
                "resume_strategy": (
                    "If the command times out with --no-cancel-on-timeout, rerun the "
                    "reported --existing-real-template TEMPLATE_ID:TASK_ID command."
                    if check_name.startswith("real_generation_")
                    else None
                ),
            }
        )

    return Check(
        "external_e2e_plan",
        True,
        "external E2E plan generated; no side effects executed",
        {
            "steps": steps,
            "requires_confirmation": [
                step for step in steps if step["requires_confirmation"]
            ],
            "effects_legend": {
                "provider_generation": "Creates external provider tasks such as RunningHub workflows.",
                "llm_script": "Calls the configured LLM to produce script content.",
                "llm_draft": "Creates script-review draft content through the configured LLM.",
                "local_generation": "Submits local/API generation tasks after draft confirmation.",
                "upload_media": "Uploads generated media to configured storage.",
                "buffer_post": "Creates or queues a real Buffer post.",
            },
            "recommended_first_command": steps[0]["command"] if steps else None,
        },
    )


def build_streamlit_completion_gap(
    check_name: str,
    *,
    status: str,
    detail: str | None = None,
) -> dict[str, Any]:
    metadata = STREAMLIT_COMPLETION_CHECK_DETAILS.get(check_name, {})
    gap = {
        "check": check_name,
        "status": status,
        "capability": metadata.get("capability", check_name),
        "phase": metadata.get("phase", "unknown"),
        "command": metadata.get("command"),
        "requires_confirmation": bool(metadata.get("requires_confirmation")),
    }
    if detail:
        gap["detail"] = detail
    return gap


def _safe_json_text(value: str) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return None


def validate_settings_config_payload(payload: dict[str, Any]) -> bool:
    config = payload.get("config")
    if "configured" not in payload or not isinstance(config, dict):
        return False
    return not missing_dict_paths(config, STREAMLIT_SETTINGS_CONFIG_PATHS)


def validate_settings_diagnostics_payload(payload: dict[str, Any]) -> bool:
    checks = payload.get("checks")
    if "ok" not in payload or not isinstance(checks, list):
        return False
    diagnostic_ids = {
        check.get("id")
        for check in checks
        if isinstance(check, dict)
    }
    return all(
        diagnostic_id in diagnostic_ids
        for diagnostic_id in STREAMLIT_SETTINGS_DIAGNOSTIC_IDS
    )


def missing_dict_paths(payload: dict[str, Any], paths: list[str]) -> list[str]:
    missing: list[str] = []
    for path in paths:
        current: Any = payload
        for segment in path.split("."):
            if not isinstance(current, dict) or segment not in current:
                missing.append(path)
                break
            current = current[segment]
    return missing


def _read_shape(client: httpx.Client, name: str, path: str, validator) -> dict[str, Any]:
    try:
        response = client.get(path)
    except Exception as exc:
        return {"name": name, "ok": False, "detail": str(exc)}

    payload = _safe_response_json(response)
    if response.status_code != 200:
        return {
            "name": name,
            "ok": False,
            "detail": f"HTTP {response.status_code}",
            "data": payload,
        }

    try:
        shape_ok = isinstance(payload, dict) and bool(validator(payload))
    except Exception as exc:
        return {"name": name, "ok": False, "detail": str(exc), "data": payload}

    return {
        "name": name,
        "ok": shape_ok,
        "detail": "shape ok" if shape_ok else "unexpected response shape",
        "data": payload if not shape_ok else {},
    }


def poll_generation_batch(
    client: httpx.Client,
    *,
    name: str,
    batch_id: str,
    timeout_seconds: int,
    poll_interval: float,
    extra_data: dict[str, Any] | None = None,
    cancel_on_timeout: bool = True,
) -> Check:
    deadline = time.monotonic() + timeout_seconds
    last_batch: dict[str, Any] = {}
    while time.monotonic() < deadline:
        batch_response = client.get(f"/api/generation/batches/{batch_id}")
        if batch_response.status_code != 200:
            return Check(
                name,
                False,
                f"batch HTTP {batch_response.status_code}",
                {"batch_id": batch_id, "response": _safe_response_json(batch_response)},
            )

        last_batch = batch_response.json()
        items = last_batch.get("items") or []
        statuses = {item.get("status") for item in items}
        if statuses and statuses <= {"completed"}:
            result_checks = []
            for item in items:
                task_id = item.get("task_id")
                if not task_id:
                    result_checks.append({"task_id": None, "ok": False})
                    continue
                result_response = client.get(f"/api/generation/tasks/{task_id}/result")
                result_payload = _safe_response_json(result_response)
                result_checks.append(
                    {
                        "task_id": task_id,
                        "ok": result_response.status_code == 200
                        and bool(
                            (isinstance(result_payload, dict) and result_payload.get("primary_video"))
                            or (
                                isinstance(result_payload, dict)
                                and result_payload.get("artifacts")
                            )
                        ),
                        "status_code": result_response.status_code,
                    }
                )
            all_results_ok = all(result["ok"] for result in result_checks)
            return Check(
                name,
                all_results_ok,
                f"batch completed; results_ok={all_results_ok}",
                {
                    "batch_id": batch_id,
                    "result_checks": result_checks,
                    **(extra_data or {}),
                },
            )

        if statuses & {"failed", "cancelled"}:
            return Check(
                name,
                False,
                f"terminal item statuses={sorted(str(status) for status in statuses)}",
                {"batch_id": batch_id, "batch": last_batch, **(extra_data or {})},
            )

        time.sleep(poll_interval)

    if cancel_on_timeout:
        cancel_batch_tasks(client, last_batch)
    blocker = classify_batch_blocker(last_batch)
    timeout_action = "submitted tasks cancelled" if cancel_on_timeout else "submitted tasks left running"
    return Check(
        name,
        False,
        f"timed out after {timeout_seconds}s; {timeout_action}; blocker={blocker}",
        {
            "batch_id": batch_id,
            "blocker": blocker,
            "cancelled_on_timeout": cancel_on_timeout,
            "last_batch": last_batch,
            **(extra_data or {}),
        },
    )


def cancel_batch_tasks(client: httpx.Client, batch: dict[str, Any]) -> None:
    for item in batch.get("items") or []:
        task_id = item.get("task_id")
        status = item.get("status")
        if task_id and status not in {"completed", "failed", "cancelled"}:
            client.delete(f"/api/generation/tasks/{task_id}")


def classify_task_blocker(task: dict[str, Any]) -> str:
    progress = task.get("progress") or {}
    detail = progress.get("detail") or {}
    provider_status = str(detail.get("provider_status") or "").upper()
    if (
        detail.get("provider_task_id")
        and provider_status in {"SUCCESS", "COMPLETED"}
        and progress.get("stage") in {"frame_step", "execute_workflow"}
    ):
        return "local_result_continuation_or_composition"
    if progress.get("stage") == "frame_step" and detail.get("action") == "media":
        return "provider_runtime_queue_or_timeout"
    if progress.get("stage") == "execute_workflow":
        return "provider_runtime_queue_or_timeout"
    if task.get("error"):
        return str((task.get("error") or {}).get("layer") or "runtime_error")
    return "timeout"


def classify_batch_blocker(batch: dict[str, Any]) -> str:
    blockers = {
        classify_task_blocker({"progress": item.get("progress"), "error": item.get("error")})
        for item in batch.get("items") or []
        if item.get("status") not in {"completed", "failed", "cancelled"}
    }
    if not blockers:
        blockers = {
            classify_task_blocker({"progress": item.get("progress"), "error": item.get("error")})
            for item in batch.get("items") or []
        }
    if len(blockers) == 1:
        return next(iter(blockers))
    return ",".join(sorted(blockers)) if blockers else "timeout"


def run_real_generation_check(
    client: httpx.Client,
    *,
    timeout_seconds: int,
    poll_interval: float,
    cancel_on_timeout: bool = True,
) -> Check:
    return run_real_template_check(
        client,
        template_id="petwoods_xhs_daily_v1",
        asset_paths=prepare_real_generation_assets(
            image_path="",
            reference_video_path="",
            needs_reference_video=False,
        ),
        timeout_seconds=timeout_seconds,
        poll_interval=poll_interval,
        cancel_on_timeout=cancel_on_timeout,
    )


def _safe_response_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return response.text


def _dedupe_preserving_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


if __name__ == "__main__":
    sys.exit(main())
