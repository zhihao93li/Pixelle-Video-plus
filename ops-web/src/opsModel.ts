import type {
  ChannelAccount,
  ContentItem,
  CycleView,
  ExperimentView,
  JsonObject,
  JsonValue,
  NextAction,
  OpsEvent,
  OpsProject,
  WritebackDraft,
} from "./types";

export type StepKey = "prediction" | "draft" | "review" | "asset" | "publish" | "retro";

export interface LoopStep {
  key: StepKey;
  label: string;
  shortLabel: string;
  body: string;
  events: string[];
  successText: string;
  missingText: string;
}

export const LOOP_STEPS: LoopStep[] = [
  {
    key: "prediction",
    label: "复盘与选题判断",
    shortLabel: "选题判断",
    body: "引用历史结论，锁定本轮方向。",
    events: ["prediction_locked"],
    successText: "已锁定本轮选题依据。",
    missingText: "还没有锁定预测。",
  },
  {
    key: "draft",
    label: "生成/提交内容草稿",
    shortLabel: "内容草稿",
    body: "生成或提交待审字幕草稿。",
    events: ["generation_drafted"],
    successText: "已有可审核草稿。",
    missingText: "还没有提交生成草稿。",
  },
  {
    key: "review",
    label: "人工审核定稿",
    shortLabel: "审核定稿",
    body: "人工确认文案，不允许系统绕过。",
    events: ["generation_draft_approved"],
    successText: "文案已人工审核通过。",
    missingText: "草稿还没有人工批准。",
  },
  {
    key: "asset",
    label: "生成并检查资产",
    shortLabel: "资产检查",
    body: "用已审文案生成视频资产。",
    events: ["generation_requested", "generation_completed", "generation_failed", "asset_checked"],
    successText: "资产已生成并完成检查。",
    missingText: "还没有完成资产检查。",
  },
  {
    key: "publish",
    label: "发布准备与证据",
    shortLabel: "发布准备",
    body: "准备发布包，发布后登记真实证据。",
    events: ["publish_recorded"],
    successText: "已有发布证据。",
    missingText: "发布包待使用，缺真实发布证据。",
  },
  {
    key: "retro",
    label: "观测数据并复盘沉淀",
    shortLabel: "复盘沉淀",
    body: "记录指标，把结论沉淀回项目记忆。",
    events: ["metrics_recorded", "retro_written", "observation_written", "memory_written"],
    successText: "已有复盘或记忆记录。",
    missingText: "还没有完成观测复盘。",
  },
];

export const NEXT_ACTION_LABELS: Record<string, string> = {
  select_project: "请选择项目",
  select_channel_account: "请选择平台账号",
  create_project: "回 Codex 创建项目",
  create_cycle: "回 Codex 创建运营周期",
  create_experiment: "回 Codex 创建内容实验",
  lock_prediction: "在 Codex 锁定预测",
  submit_generation_draft: "在 Codex 提交生成草稿",
  approve_generation_draft: "审核并批准文案",
  request_generation: "在 Codex 生成内容",
  check_generation_status: "检查生成状态",
  check_generation_asset: "检查生成资产",
  resolve_asset_issue: "处理生成资产问题",
  record_publish: "准备发布并登记证据",
  record_metrics: "登记指标",
  write_retro: "写复盘",
  write_memory: "写入项目记忆",
  done: "当前闭环已收口",
};

export const NEXT_ACTION_TO_STEP: Record<string, StepKey> = {
  lock_prediction: "prediction",
  submit_generation_draft: "draft",
  approve_generation_draft: "review",
  request_generation: "asset",
  check_generation_status: "asset",
  check_generation_asset: "asset",
  resolve_asset_issue: "asset",
  record_publish: "publish",
  record_metrics: "retro",
  write_retro: "retro",
  write_memory: "retro",
  done: "retro",
};

export const WRITEBACK_OPERATION_TO_STEP: Record<string, StepKey> = {
  lock_content_prediction: "prediction",
  submit_generation_draft: "draft",
  record_publish_evidence: "publish",
  record_metrics_snapshot: "retro",
  record_retro_observation: "retro",
  write_project_memory_event: "retro",
};

export function nextActionLabel(nextAction?: NextAction | null): string {
  const kind = nextAction?.kind;
  return kind ? NEXT_ACTION_LABELS[kind] || "回 Codex 查看下一步" : "回 Codex 查看下一步";
}

export function stepForNextAction(nextAction?: NextAction | null): StepKey {
  const kind = nextAction?.kind;
  return kind ? NEXT_ACTION_TO_STEP[kind] || "prediction" : "prediction";
}

export function stepForWritebackOperation(operation: string): StepKey {
  return WRITEBACK_OPERATION_TO_STEP[operation] || "prediction";
}

export function firstExperiment(cycle?: CycleView | null): ExperimentView | null {
  return cycle?.experiments?.[0] || null;
}

export function latestEvent(events: OpsEvent[], eventType: string): OpsEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].event_type === eventType) return events[index];
  }
  return null;
}

export function stepEvents(experiment: ExperimentView | null, step: LoopStep): OpsEvent[] {
  if (!experiment) return [];
  return experiment.events.filter((event) => step.events.includes(event.event_type));
}

export function hasStepEvidence(experiment: ExperimentView | null, step: LoopStep): boolean {
  return stepEvents(experiment, step).length > 0;
}

export function hasStepRequiredEvidence(experiment: ExperimentView | null, step: LoopStep): boolean {
  if (!experiment) return false;
  const events = experiment.events;
  if (step.key === "prediction") return Boolean(latestEvent(events, "prediction_locked"));
  if (step.key === "draft") return Boolean(latestEvent(events, "generation_drafted"));
  if (step.key === "review") return Boolean(latestEvent(events, "generation_draft_approved"));
  if (step.key === "asset") return Boolean(latestEvent(events, "asset_checked"));
  if (step.key === "publish") return Boolean(latestEvent(events, "publish_recorded"));
  return Boolean(
    latestEvent(events, "retro_written")
      || latestEvent(events, "memory_written")
      || latestEvent(events, "observation_written"),
  );
}

export function stepState(
  experiment: ExperimentView | null,
  step: LoopStep,
  nextAction?: NextAction | null,
): "done" | "current" | "missing" {
  const isCurrentStep = step.key === stepForNextAction(nextAction);
  if (isCurrentStep && nextAction?.kind !== "done") return "current";
  if (hasStepRequiredEvidence(experiment, step)) return "done";
  return isCurrentStep ? "current" : "missing";
}

export function hasMockEvidence(experiment: ExperimentView | null): boolean {
  return Boolean(experiment?.events.some(eventHasMock));
}

export function writebackDraftsForExperiment(
  drafts: WritebackDraft[],
  experiment: ExperimentView | null,
): WritebackDraft[] {
  if (!experiment) return [];
  return drafts.filter((draft) => draft.target?.experiment_id === experiment.experiment.id);
}

export function pendingWritebackDraftsForExperiment(
  drafts: WritebackDraft[],
  experiment: ExperimentView | null,
): WritebackDraft[] {
  return writebackDraftsForExperiment(drafts, experiment).filter((draft) => !["applied", "rejected"].includes(draft.status));
}

export function writebackDraftsForStep(
  drafts: WritebackDraft[],
  experiment: ExperimentView | null,
  stepKey: StepKey,
): WritebackDraft[] {
  return writebackDraftsForExperiment(drafts, experiment).filter(
    (draft) => stepForWritebackOperation(draft.operation) === stepKey,
  );
}

export function eventHasMock(event: OpsEvent): boolean {
  const payload = event.payload || {};
  const evidence = asObject(payload.evidence);
  const metrics = asObject(payload.metrics);
  return Boolean(payload.mock || payload.mock_label || evidence?.mock || evidence?.mock_label || metrics?.mock || metrics?.mock_label);
}

export function buildCodexPrompt(args: {
  project?: OpsProject | null;
  account?: ChannelAccount | null;
  cycle?: CycleView | null;
  experiment?: ExperimentView | null;
  nextAction?: NextAction | null;
}): string {
  const cycle = args.cycle?.cycle;
  const experiment = args.experiment?.experiment;
  return [
    "使用 @pixelle-ops，继续当前运营闭环。",
    "",
    "这是 Pixelle UI 复制的兜底上下文。日常应先让插件读取能力和状态；只有多项目、多账号、新对话或历史轮次定位不清时，才使用下面这些字段避免写错对象。",
    "",
    "UI 当前选择：",
    `项目：${args.project?.name || "未选择"}`,
    `项目 ID：${args.project?.id || "-"}`,
    `平台账号：${args.account?.account_name || "未选择"}`,
    `平台：${args.account?.platform || "-"}`,
    `平台账号 ID：${args.account?.id || "-"}`,
    `当前轮次：${cycle?.name || "未创建"}`,
    `当前轮次 ID：${cycle?.id || "-"}`,
    `当前实验：${experiment?.title || "未创建"}`,
    `当前实验 ID：${experiment?.id || "-"}`,
    "",
    `下一步：${nextActionLabel(args.nextAction)}`,
    "",
    "要求：先按 pixelle-ops 正常流程读取能力和状态；只操作上述项目、平台账号、轮次和实验；如果上下文不完整或与实时状态冲突，先让我确认，不要自动切换到其他项目或账号。",
  ].join("\n");
}

export function stageTitle(step: LoopStep, experiment: ExperimentView | null): string {
  if (!experiment) return "当前轮还没有内容实验";
  if (step.key === "publish") return `《${experiment.experiment.title}》的发布准备与证据`;
  if (step.key === "draft") return `《${experiment.experiment.title}》的待审草稿`;
  if (step.key === "review") return `《${experiment.experiment.title}》的文案审核`;
  if (step.key === "asset") return `《${experiment.experiment.title}》的内容资产`;
  if (step.key === "retro") return `《${experiment.experiment.title}》的观测复盘`;
  return `《${experiment.experiment.title}》`;
}

export function stageSummary(step: LoopStep, experiment: ExperimentView | null): string {
  if (!experiment) return "需要先回 Codex 创建本轮内容实验。";
  if (step.key === "prediction") return experiment.experiment.hypothesis || step.body;
  if (hasStepRequiredEvidence(experiment, step)) return step.successText;
  if (step.key === "asset" && latestEvent(experiment.events, "generation_completed")) {
    return "视频资产已生成，但还缺少 asset check。";
  }
  if (step.key === "publish" && latestEvent(experiment.events, "asset_checked")) {
    return "发布包可准备，缺真实发布证据。";
  }
  if (step.key === "retro" && latestEvent(experiment.events, "metrics_recorded")) {
    return "已有指标记录，但还缺少复盘或记忆写入。";
  }
  return step.missingText;
}

export interface DetailRow {
  label: string;
  value: string;
  tone?: "normal" | "warn" | "good";
}

export function detailRows(step: LoopStep, experiment: ExperimentView | null): DetailRow[] {
  if (!experiment) return [{ label: "状态", value: "当前轮还没有内容实验", tone: "warn" }];
  const events = experiment.events;
  if (step.key === "prediction") {
    const event = latestEvent(events, "prediction_locked");
    return event
      ? [{ label: "预测依据", value: summarizeValue(event.payload.prediction ?? event.payload) }]
      : [{ label: "预测", value: "缺失", tone: "warn" }];
  }
  if (step.key === "draft") {
    const event = latestEvent(events, "generation_drafted");
    return event
      ? [
          { label: "上屏字幕", value: summarizeValue(event.payload.text, 420) },
          { label: "Pipeline", value: summarizeValue(event.payload.pipeline || "standard") },
        ]
      : [{ label: "草稿", value: "缺失", tone: "warn" }];
  }
  if (step.key === "review") {
    const event = latestEvent(events, "generation_draft_approved");
    return event
      ? [
          { label: "审核结果", value: "已人工批准", tone: "good" },
          { label: "草稿 ID", value: summarizeValue(event.payload.draft_id) },
        ]
      : [{ label: "审核", value: "缺失", tone: "warn" }];
  }
  if (step.key === "asset") return assetRows(experiment);
  if (step.key === "publish") return publishRows(events);
  return retroRows(events);
}

export function previewContentItem(experiment: ExperimentView | null): ContentItem | null {
  if (!experiment) return null;
  if (experiment.content_item?.asset_media_type === "video" && experiment.content_item.asset_url) {
    return experiment.content_item;
  }
  for (let index = experiment.content_items.length - 1; index >= 0; index -= 1) {
    const item = experiment.content_items[index];
    if (item.asset_media_type === "video" && item.asset_url) return item;
  }
  if (experiment.content_item) return experiment.content_item;
  return experiment.content_items[experiment.content_items.length - 1] || null;
}

function assetRows(experiment: ExperimentView): DetailRow[] {
  const item = experiment.content_item || experiment.content_items[experiment.content_items.length - 1];
  const assetCheck = experiment.asset_check || latestEvent(experiment.events, "asset_checked");
  if (!item && !assetCheck) return [{ label: "资产", value: "缺失", tone: "warn" }];
  const payload = assetCheck?.payload || {};
  return [
    item ? { label: "资产状态", value: item.status } : null,
    item
      ? {
          label: "预览",
          value: item.asset_preview_available ? "可直接预览" : "暂无可预览文件",
          tone: item.asset_preview_available ? "good" : "warn",
        }
      : null,
    assetCheck ? { label: "检查结果", value: summarizeAssetCheck(payload), tone: payload.status === "passed" ? "good" : "warn" } : null,
  ].filter(Boolean) as DetailRow[];
}

function publishRows(events: OpsEvent[]): DetailRow[] {
  const event = latestEvent(events, "publish_recorded");
  if (!event) return [{ label: "发布证据", value: "缺失", tone: "warn" }];
  const evidence = asObject(event.payload.evidence) || {};
  return [
    { label: "证据性质", value: evidence.mock ? "Mock 发布，只验证流程" : "真实发布证据", tone: evidence.mock ? "warn" : "good" },
    {
      label: "平台链接",
      value: summarizeValue(
        evidence.platform_url
          || evidence.url
          || evidence.post_url
          || evidence.platform_post_id
          || evidence.post_id
          || evidence.external_id
          || "未记录",
      ),
    },
    { label: "说明", value: summarizeValue(evidence.mock_label || evidence.note || "已记录发布事件") },
  ];
}

function retroRows(events: OpsEvent[]): DetailRow[] {
  const metrics = asObject(latestEvent(events, "metrics_recorded")?.payload.metrics);
  const retro = latestEvent(events, "retro_written")?.payload.retro;
  const observation = latestEvent(events, "observation_written")?.payload.observation;
  const memory = latestEvent(events, "memory_written")?.payload.memory;
  const rows: DetailRow[] = [];
  if (metrics) {
    rows.push({
      label: "数据性质",
      value: metrics.mock ? "Mock 指标，仅验证闭环" : "真实指标",
      tone: metrics.mock ? "warn" : "good",
    });
    rows.push({ label: "核心指标", value: summarizeMetrics(metrics) });
  }
  if (retro) rows.push({ label: "复盘结论", value: summarizeRetro(retro) });
  if (observation) rows.push({ label: "观察记录", value: summarizeValue(observation, 360) });
  if (memory) rows.push({ label: "记忆写入", value: summarizeRetro(memory) });
  return rows.length ? rows : [{ label: "复盘", value: "缺失", tone: "warn" }];
}

export function missingEvents(step: LoopStep, experiment: ExperimentView | null): string {
  const required = requiredEventsForStep(step.key);
  if (!experiment) return required.join("、");
  const existing = new Set(experiment.events.map((event) => event.event_type));
  const missing = required.filter((eventType) => !existing.has(eventType));
  return missing.length ? missing.join("、") : "无";
}

function requiredEventsForStep(stepKey: StepKey): string[] {
  if (stepKey === "asset") return ["generation_completed", "asset_checked"];
  if (stepKey === "retro") return ["metrics_recorded", "retro_written"];
  return LOOP_STEPS.find((step) => step.key === stepKey)?.events || [];
}

export function summarizeEvidence(step: LoopStep, experiment: ExperimentView | null): OpsEvent[] {
  return stepEvents(experiment, step);
}

export function summarizeValue(value: JsonValue | unknown, limit = 180): string {
  if (value === undefined || value === null || value === "") return "-";
  const text = typeof value === "object" ? compactObject(value as JsonObject) : String(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function compactObject(value: JsonObject | unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return String(value ?? "-");
  return Object.entries(value as JsonObject)
    .filter(([, item]) => item !== undefined && item !== null && item !== "")
    .map(([key, item]) => `${key}: ${typeof item === "object" ? summarizeValue(item, 120) : String(item)}`)
    .join(" · ");
}

function summarizeAssetCheck(payload: JsonObject): string {
  const parts = [
    payload.status ? `状态 ${payload.status}` : "",
    payload.duration_seconds ? `时长 ${payload.duration_seconds}s` : "",
    payload.exists !== undefined ? `文件${payload.exists ? "存在" : "缺失"}` : "",
    payload.note || payload.message ? summarizeValue(payload.note || payload.message, 120) : "",
  ].filter(Boolean);
  return parts.join(" · ") || summarizeValue(payload);
}

function summarizeMetrics(metrics: JsonObject): string {
  const parts = [
    metrics.views !== undefined ? `浏览 ${metrics.views}` : "",
    metrics.saves !== undefined ? `收藏 ${metrics.saves}` : "",
    metrics.comments !== undefined ? `评论 ${metrics.comments}` : "",
    metrics.save_rate !== undefined ? `收藏率 ${formatPercent(metrics.save_rate)}` : "",
    metrics.comment_rate !== undefined ? `评论率 ${formatPercent(metrics.comment_rate)}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || summarizeValue(metrics);
}

function summarizeRetro(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return summarizeValue(value, 360);
  const object = value as JsonObject;
  return compactObject({
    conclusion: object.conclusion || object.summary || object.decision,
    issues: Array.isArray(object.issues_found) ? object.issues_found.join("；") : object.issues_found,
    next_action: object.next_action || object.recommendation || object.follow_up,
    status: object.status || object.result,
  });
}

function formatPercent(value: JsonValue | undefined): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : summarizeValue(value);
}

function asObject(value: JsonValue | undefined): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}
