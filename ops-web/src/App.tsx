import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageCircle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createChannelAccount,
  getCurrent,
  listProjectCycles,
  listProjects,
  updateChannelAccount,
} from "./api";
import {
  LOOP_STEPS,
  buildCodexPrompt,
  firstExperiment,
  hasMockEvidence,
  latestEvent,
  missingEvents,
  nextActionLabel,
  previewContentItem,
  stageSummary,
  stageTitle,
  stepForNextAction,
  stepState,
  summarizeEvidence,
  summarizeValue,
  type StepKey,
} from "./opsModel";
import type {
  ChannelAccount,
  ContentItem,
  CurrentResponse,
  CycleView,
  ExperimentView,
  JsonObject,
  JsonValue,
  NextAction,
  OpsEvent,
  OpsProject,
  ProjectCyclesResponse,
  ProjectsResponse,
} from "./types";

const VIDEO_BASE = (import.meta.env.VITE_PIXELLE_VIDEO_BASE || "http://localhost:8501").replace(/\/$/, "");

type Screen = "ops" | "projects";

interface LoadState {
  projects?: ProjectsResponse;
  current?: CurrentResponse;
  cycles?: ProjectCyclesResponse;
  loading: boolean;
  error: string | null;
}

const initialState: LoadState = {
  loading: true,
  error: null,
};

export function App() {
  const [screen, setScreen] = useState<Screen>("ops");
  const [state, setState] = useState<LoadState>(initialState);
  const [selectedProjectId, setSelectedProjectId] = useStoredState("pixelle.ops.projectId", "");
  const [selectedAccountId, setSelectedAccountId] = useStoredState("pixelle.ops.accountId", "");
  const [selectedCycleId, setSelectedCycleId] = useStoredState("pixelle.ops.cycleId", "");
  const [selectedStep, setSelectedStep] = useState<StepKey>("prediction");
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");

  const projects = state.projects?.projects || [];
  const selectedProject = useMemo(() => {
    const storedProject = projects.find((project) => project.id === selectedProjectId);
    if (storedProject) return storedProject;
    return projects.length === 1 ? projects[0] : null;
  }, [projects, selectedProjectId]);
  const accounts = selectedProject?.channel_accounts || [];
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || (accounts.length === 1 ? accounts[0] : null),
    [accounts, selectedAccountId],
  );
  const cycles = state.cycles?.cycles || [];
  const selectedCycle = useMemo(
    () => cycles.find((cycle) => cycle.cycle.id === selectedCycleId) || cycles[0] || null,
    [cycles, selectedCycleId],
  );
  const selectedExperiment = firstExperiment(selectedCycle);
  const nextAction = selectedExperiment?.next_action || selectedCycle?.next_action || state.current?.next_action;
  const activeStep = LOOP_STEPS.find((step) => step.key === selectedStep) || LOOP_STEPS[0];

  async function refresh(projectId = selectedProject?.id || selectedProjectId, accountId = selectedAccount?.id || selectedAccountId) {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const projectsResponse = await listProjects();
      const nextProject =
        projectsResponse.projects.find((project) => project.id === projectId)
        || (projectsResponse.projects.length === 1 ? projectsResponse.projects[0] : null);
      const nextAccounts = nextProject?.channel_accounts || [];
      const nextAccount =
        nextAccounts.find((account) => account.id === accountId) || (nextAccounts.length === 1 ? nextAccounts[0] : null);
      const [currentResponse, cyclesResponse] = nextProject
        ? await Promise.all([
            getCurrent(nextProject.id, nextAccount?.id),
            listProjectCycles(nextProject.id),
          ])
        : [undefined, undefined];

      if (nextProject && nextProject.id !== selectedProjectId) setSelectedProjectId(nextProject.id);
      if (!nextProject && selectedProjectId) setSelectedProjectId("");
      if (nextAccount && nextAccount.id !== selectedAccountId) setSelectedAccountId(nextAccount.id);
      setState({
        projects: projectsResponse,
        current: currentResponse,
        cycles: cyclesResponse,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Ops API 连接失败。",
      }));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!selectedProject && selectedProjectId) setSelectedProjectId("");
    if (selectedProject && selectedProject.id !== selectedProjectId) setSelectedProjectId(selectedProject.id);
  }, [selectedProject, selectedProjectId, setSelectedProjectId]);

  useEffect(() => {
    if (!selectedProject) return;
    if (accounts.length === 1 && selectedAccountId !== accounts[0].id) {
      setSelectedAccountId(accounts[0].id);
      return;
    }
    if (selectedAccountId && !accounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId("");
    }
  }, [accounts, selectedAccountId, selectedProject, setSelectedAccountId]);

  useEffect(() => {
    if (selectedCycle && selectedCycle.cycle.id !== selectedCycleId) setSelectedCycleId(selectedCycle.cycle.id);
  }, [selectedCycle, selectedCycleId, setSelectedCycleId]);

  useEffect(() => {
    setSelectedStep(stepForNextAction(nextAction));
  }, [selectedExperiment?.experiment.id, nextAction?.kind]);

  async function handleProjectChange(projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedAccountId("");
    setSelectedCycleId("");
    await refresh(projectId, "");
  }

  async function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
    await refresh(selectedProject?.id || selectedProjectId, accountId);
  }

  async function copyPrompt() {
    const prompt = buildCodexPrompt({
      project: selectedProject,
      account: selectedAccount,
      cycle: selectedCycle,
      experiment: selectedExperiment,
      nextAction,
    });
    const copied = await copyText(prompt);
    setCopyState(copied ? "done" : "error");
    window.setTimeout(() => setCopyState("idle"), 1300);
  }

  return (
    <div className="app-shell">
      <Sidebar screen={screen} onScreenChange={setScreen} />
      <main className="main">
        {state.loading && !state.projects ? <LoadingScreen /> : null}
        {state.error ? <ErrorScreen error={state.error} onRetry={() => void refresh()} /> : null}
        {!state.loading && !state.error && !projects.length ? <NoProjects /> : null}
        {!state.error && projects.length ? (
          <>
            <Topbar
              projects={projects}
              selectedProject={selectedProject}
              accounts={accounts}
              selectedAccount={selectedAccount}
              selectedCycle={selectedCycle}
              selectedExperiment={selectedExperiment}
              nextAction={nextAction}
              hasMock={hasMockEvidence(selectedExperiment)}
              onProjectChange={(id) => void handleProjectChange(id)}
              onAccountChange={(id) => void handleAccountChange(id)}
              onCopy={() => void copyPrompt()}
              onRefresh={() => void refresh()}
              copyState={copyState}
            />
            {screen === "ops" ? (
              <OpsScreen
                selectedProject={selectedProject}
                selectedAccount={selectedAccount}
                cycles={cycles}
                selectedCycle={selectedCycle}
                selectedExperiment={selectedExperiment}
                selectedStep={selectedStep}
                nextAction={nextAction}
                onConfigureAccounts={() => setScreen("projects")}
                onCopyPrompt={() => void copyPrompt()}
                onSelectCycle={setSelectedCycleId}
                onSelectStep={setSelectedStep}
              />
            ) : (
              <ProjectsScreen
                project={selectedProject}
                accounts={accounts}
                onSaved={(accountId) => {
                  setSelectedAccountId(accountId);
                  void refresh(selectedProject?.id, accountId);
                }}
              />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}

function Sidebar({ screen, onScreenChange }: { screen: Screen; onScreenChange: (screen: Screen) => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">P</div>
        <div>
          <div className="brand-title">Pixelle Ops</div>
          <div className="brand-subtitle">Codex-first content loop</div>
        </div>
      </div>
      <nav className="nav">
        <button className={screen === "ops" ? "active" : ""} onClick={() => onScreenChange("ops")} type="button">
          <span>Ops</span>
          <span>轮次闭环</span>
        </button>
        <button className={screen === "projects" ? "active" : ""} onClick={() => onScreenChange("projects")} type="button">
          <span>Projects</span>
          <span>账号配置</span>
        </button>
        <a href={VIDEO_BASE} rel="noreferrer">
          <span>Create</span>
          <span>视频沙盒</span>
        </a>
        <a href={`${VIDEO_BASE}/History`} rel="noreferrer">
          <span>History</span>
          <span>生成记录</span>
        </a>
        <a href={`${VIDEO_BASE}/Settings`} rel="noreferrer">
          <span>Settings</span>
          <span>Integrations</span>
        </a>
      </nav>
      <div className="sidebar-footer">选题、文案、生成、发布登记仍通过 Codex + pixelle-ops 执行。</div>
    </aside>
  );
}

function Topbar({
  projects,
  selectedProject,
  accounts,
  selectedAccount,
  selectedCycle,
  selectedExperiment,
  nextAction,
  hasMock,
  copyState,
  onProjectChange,
  onAccountChange,
  onCopy,
  onRefresh,
}: {
  projects: OpsProject[];
  selectedProject: OpsProject | null;
  accounts: ChannelAccount[];
  selectedAccount: ChannelAccount | null;
  selectedCycle?: CycleView | null;
  selectedExperiment?: ExperimentView | null;
  nextAction?: NextAction | null;
  hasMock: boolean;
  copyState: "idle" | "done" | "error";
  onProjectChange: (id: string) => void;
  onAccountChange: (id: string) => void;
  onCopy: () => void;
  onRefresh: () => void;
}) {
  const technicalContext = [
    { label: "project_id", value: selectedProject?.id },
    { label: "channel_account_id", value: selectedAccount?.id },
    { label: "cycle_id", value: selectedCycle?.cycle.id },
    { label: "experiment_id", value: selectedExperiment?.experiment.id },
    { label: "next_action", value: nextAction?.kind },
  ].filter((item) => item.value);

  return (
    <header className="topbar">
      <div>
        <div className="project-line">
          <h1 className="project-title">{selectedProject?.name || "Pixelle Ops"}</h1>
          <span className="pill strong">Codex 主路径</span>
          {hasMock ? <span className="pill mock">Mock 证据</span> : null}
        </div>
        <CodexPrimaryCallout nextAction={nextAction} />
        <div className="context-grid">
          <ContextItem label="项目" value={selectedProject?.name || "未选择"} meta={selectedProject?.id} warn={!selectedProject} />
          <ContextItem
            label="平台账号"
            value={selectedAccount ? `${selectedAccount.account_name} / ${selectedAccount.platform}` : "未选择"}
            meta={selectedAccount?.id}
            warn={!selectedAccount}
          />
          <ContextItem label="选中轮次" value={selectedCycle?.cycle.name || "未创建"} meta={selectedCycle?.cycle.id} warn={!selectedCycle} />
          <ContextItem
            label="当前实验"
            value={selectedExperiment?.experiment.title || "未创建"}
            meta={selectedExperiment?.experiment.id}
            warn={!selectedExperiment}
          />
          <ContextItem label="下一步" value={nextActionLabel(nextAction)} meta={nextAction?.kind} warn={Boolean(nextAction?.blocked)} />
        </div>
        {projects.length > 1 || accounts.length > 1 ? (
          <div className="context-warning">
            {projects.length > 1 ? "当前有多个项目，" : ""}
            {accounts.length > 1 ? "当前项目有多个平台账号，" : ""}
            直接问 Codex 时插件会先让你选择；复制兜底上下文只用于新对话或历史轮次定位。
          </div>
        ) : null}
        {technicalContext.length ? (
          <details className="technical-context">
            <summary>查看兜底上下文 ID</summary>
            <div>
              {technicalContext.map((item) => (
                <code key={item.label}>{item.label}: {item.value}</code>
              ))}
            </div>
          </details>
        ) : null}
        <div className="selectors">
          {projects.length > 1 ? (
            <label>
              项目
              <select value={selectedProject?.id || ""} onChange={(event) => onProjectChange(event.target.value)}>
                <option value="">请选择项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {accounts.length > 1 ? (
            <label>
              平台账号
              <select value={selectedAccount?.id || ""} onChange={(event) => onAccountChange(event.target.value)}>
                <option value="">请选择平台账号</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.platform} / {account.account_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      <div className="actions">
        <button className="button primary" onClick={onRefresh} type="button">
          <RefreshCw size={16} />
          刷新状态
        </button>
        <button className="button quiet" onClick={onCopy} type="button">
          {copyState === "done" ? <CheckCircle2 size={16} /> : <Copy size={16} />}
          {copyState === "done" ? "已复制上下文" : copyState === "error" ? "复制失败" : "复制兜底上下文"}
        </button>
      </div>
    </header>
  );
}

function CodexPrimaryCallout({ nextAction }: { nextAction?: NextAction | null }) {
  return (
    <section className="codex-primary" aria-label="Codex 主路径">
      <MessageCircle size={18} />
      <div>
        <span>日常直接在 Codex 里问</span>
        <strong>使用 @pixelle-ops，下一步做什么？</strong>
        <p>插件会先读能力和状态；多项目或多账号时会先让你选择，不需要手动复制长指令。</p>
      </div>
      <em>{nextActionLabel(nextAction)}</em>
    </section>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function ContextItem({ label, value, meta, warn }: { label: string; value: string; meta?: string; warn?: boolean }) {
  return (
    <div className={`context-item ${warn ? "warn" : ""}`} title={meta ? `${label}: ${value}\n${meta}` : `${label}: ${value}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OpsScreen({
  selectedProject,
  selectedAccount,
  cycles,
  selectedCycle,
  selectedExperiment,
  selectedStep,
  nextAction,
  onConfigureAccounts,
  onCopyPrompt,
  onSelectCycle,
  onSelectStep,
}: {
  selectedProject: OpsProject | null;
  selectedAccount: ChannelAccount | null;
  cycles: CycleView[];
  selectedCycle: CycleView | null;
  selectedExperiment: ExperimentView | null;
  selectedStep: StepKey;
  nextAction?: NextAction | null;
  onConfigureAccounts: () => void;
  onCopyPrompt: () => void;
  onSelectCycle: (cycleId: string) => void;
  onSelectStep: (step: StepKey) => void;
}) {
  if (!selectedProject) {
    return (
      <div className="single-panel">
        <EmptyState title="请选择项目" body="当前存在多个运营项目，先选择一个项目再查看运营闭环。" action="使用顶部项目选择器" />
      </div>
    );
  }
  if (!selectedAccount) {
    return (
      <div className="single-panel">
        <EmptyState
          title={selectedProject.channel_accounts?.length ? "请选择平台账号" : "该项目还没有平台账号"}
          body={selectedProject.channel_accounts?.length ? "当前项目有多个平台账号，先选择一个账号再查看运营闭环。" : "先到 Projects 绑定平台账号；这不会写入运营事实。"}
          action="进入 Projects"
          onAction={selectedProject.channel_accounts?.length ? undefined : onConfigureAccounts}
        />
      </div>
    );
  }
  if (!cycles.length) {
    return (
      <div className="single-panel">
        <EmptyState
          title="还没有运营轮次"
          body="日常直接在 Codex 里问：使用 @pixelle-ops，继续当前运营闭环。复制只用于新对话里精确带上项目和账号。"
          action="复制兜底上下文"
          onAction={onCopyPrompt}
        />
      </div>
    );
  }

  const activeStep = LOOP_STEPS.find((step) => step.key === selectedStep) || LOOP_STEPS[0];
  return (
    <>
      <section className="ops-layout">
        <CycleRail
          cycles={cycles}
          selectedCycle={selectedCycle}
          selectedExperiment={selectedExperiment}
          selectedStep={selectedStep}
          nextAction={nextAction}
          onSelectCycle={onSelectCycle}
          onSelectStep={onSelectStep}
        />
        <StepWorkspace step={activeStep} experiment={selectedExperiment} nextAction={nextAction} />
      </section>
      <EvidenceDrawer step={activeStep} experiment={selectedExperiment} />
    </>
  );
}

function CycleRail({
  cycles,
  selectedCycle,
  selectedExperiment,
  selectedStep,
  nextAction,
  onSelectCycle,
  onSelectStep,
}: {
  cycles: CycleView[];
  selectedCycle: CycleView | null;
  selectedExperiment: ExperimentView | null;
  selectedStep: StepKey;
  nextAction?: NextAction | null;
  onSelectCycle: (cycleId: string) => void;
  onSelectStep: (step: StepKey) => void;
}) {
  return (
    <aside className="rail panel">
      <div className="section-heading">
        <h2>轮次轨道</h2>
        <p>当前轮在最上方，历史轮按最近运营顺序排列。</p>
      </div>
      <div className="cycle-list">
        {cycles.map((cycle, index) => {
          const experiment = firstExperiment(cycle);
          const active = cycle.cycle.id === selectedCycle?.cycle.id;
          return (
            <button
              className={`cycle-card ${active ? "active" : ""}`}
              key={cycle.cycle.id}
              onClick={() => onSelectCycle(cycle.cycle.id)}
              type="button"
            >
              <span className="round-index">R{cycles.length - index}</span>
              <span>
                <strong>{experiment?.experiment.title || cycle.cycle.name}</strong>
                <small>{active ? "当前" : "历史"} · {nextActionLabel(experiment?.next_action || cycle.next_action)}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="loop-list">
        <h3>本轮 6 步闭环</h3>
        {LOOP_STEPS.map((step, index) => {
          const state = stepState(selectedExperiment, step, nextAction);
          return (
            <button
              className={`step-row ${state} ${selectedStep === step.key ? "active" : ""}`}
              key={step.key}
              onClick={() => onSelectStep(step.key)}
              type="button"
            >
              <span className="step-index">{index + 1}</span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.body}</small>
              </span>
              <em>{state === "done" ? "完成" : state === "current" ? "当前" : "缺失"}</em>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function StepWorkspace({
  step,
  experiment,
  nextAction,
}: {
  step: (typeof LOOP_STEPS)[number];
  experiment: ExperimentView | null;
  nextAction?: NextAction | null;
}) {
  const missing = missingEvents(step, experiment);
  return (
    <section className="workspace panel">
      <div className="workspace-head">
        <div>
          <p className="current-marker">当前轮 · 步骤 {LOOP_STEPS.findIndex((item) => item.key === step.key) + 1} · {step.label}</p>
          <h2>{stageTitle(step, experiment)}</h2>
          <p>{stageSummary(step, experiment)}</p>
        </div>
      </div>
      <div className="next-callout">
        <div>
          <span>当前卡点</span>
          <strong>{nextActionLabel(nextAction)}</strong>
        </div>
        <span className="action-kind">{nextAction?.kind || "unknown"}</span>
      </div>
      <div className="workspace-grid">
        <section className="detail-card">
          <StepDetail stepKey={step.key} experiment={experiment} />
        </section>
        <section className="inspector-card">
          <h3>本步骤检查</h3>
          <div className="inspect-row">
            <span>通过标准</span>
            <strong>{step.successText}</strong>
          </div>
          <div className="inspect-row">
            <span>本步骤缺失</span>
            <strong>{missing}</strong>
          </div>
          <div className="inspect-row">
            <span>阻塞下一步</span>
            <strong>{nextAction?.blocked ? "是" : "否"}</strong>
          </div>
        </section>
      </div>
    </section>
  );
}

function StepDetail({ stepKey, experiment }: { stepKey: StepKey; experiment: ExperimentView | null }) {
  if (!experiment) return <EmptyDetail title="还没有内容实验" body="先回 Codex 创建本轮内容实验。" />;
  if (stepKey === "prediction") return <PredictionDetail experiment={experiment} />;
  if (stepKey === "draft") return <DraftDetail experiment={experiment} />;
  if (stepKey === "review") return <ReviewDetail experiment={experiment} />;
  if (stepKey === "asset") return <AssetDetail experiment={experiment} />;
  if (stepKey === "publish") return <PublishDetail experiment={experiment} />;
  return <RetroDetail experiment={experiment} />;
}

function PredictionDetail({ experiment }: { experiment: ExperimentView }) {
  const event = latestEvent(experiment.events, "prediction_locked");
  const prediction = objectValue(event?.payload.prediction);
  if (!prediction) {
    return <EmptyDetail title="还没有锁定预测" body="这一轮还缺少选题依据和结果前判断。" />;
  }
  const risks = textList(prediction.risk_notes);
  return (
    <div className="step-detail">
      <div className="detail-heading">
        <span>本轮判断</span>
        <h3>{textValue(prediction.topic) || experiment.experiment.title}</h3>
      </div>
      <p className="detail-lead">{textValue(prediction.rationale) || experiment.experiment.hypothesis}</p>
      <MetricGrid
        items={[
          ["主指标", textValue(prediction.primary_metric)],
          ["预期档位", textValue(prediction.expected_bucket)],
          ["预期时长", secondsValue(prediction.expected_duration_seconds)],
          ["内容形式", textValue(prediction.content_format)],
        ]}
      />
      <InfoBlock title="成功条件" value={textValue(prediction.success_condition)} />
      <InfoBlock title="校准备注" value={textValue(prediction.calibration_note)} />
      {risks.length ? <BulletBlock title="风险边界" items={risks} /> : null}
    </div>
  );
}

function DraftDetail({ experiment }: { experiment: ExperimentView }) {
  const event = latestEvent(experiment.events, "generation_drafted") || latestEvent(experiment.events, "generation_requested");
  if (!event) return <EmptyDetail title="还没有生成草稿" body="需要先在 Codex 提交最终上屏字幕或口播稿。" />;
  const params = objectValue(event.payload.generation_params);
  return (
    <div className="step-detail">
      <div className="detail-heading">
        <span>待审文案</span>
        <h3>{textValue(event.payload.title) || experiment.experiment.title}</h3>
      </div>
      <ScriptBlock text={textValue(event.payload.text)} />
      <MetricGrid
        items={[
          ["Pipeline", textValue(event.payload.pipeline) || "standard"],
          ["模式", textValue(params?.mode)],
          ["目标时长", secondsValue(params?.duration_seconds)],
          ["平台", textList(params?.platforms).join(" / ")],
        ]}
      />
    </div>
  );
}

function ReviewDetail({ experiment }: { experiment: ExperimentView }) {
  const approval = latestEvent(experiment.events, "generation_draft_approved");
  const draft = approval ? findEventById(experiment.events, textValue(approval.payload.draft_id)) : null;
  if (!approval) return <EmptyDetail title="草稿还没审核" body="文案必须由用户确认，不能由系统自动跳过。" />;
  return (
    <div className="step-detail">
      <StatusBanner tone="good" title="文案已人工审核通过" body="后续生成必须使用这版已确认草稿。" />
      <MetricGrid
        items={[
          ["批准事件", approval.id],
          ["草稿事件", textValue(approval.payload.draft_id)],
          ["来源", textValue(approval.source?.kind)],
          ["审核时间", formatDateTime(approval.created_at)],
        ]}
      />
      <InfoBlock title="已确认草稿摘要" value={textValue(draft?.payload.text)} limit={520} />
    </div>
  );
}

function AssetDetail({ experiment }: { experiment: ExperimentView }) {
  const previewItem = previewContentItem(experiment);
  const item = previewItem || experiment.content_items[experiment.content_items.length - 1] || null;
  const assetCheck = latestEvent(experiment.events, "asset_checked");
  const failed = latestEvent(experiment.events, "generation_failed");
  const checks = objectValue(assetCheck?.payload.checks);
  return (
    <div className="step-detail">
      <div className="detail-heading">
        <span>生成资产</span>
        <h3>{item?.title || experiment.experiment.title}</h3>
      </div>
      <AssetPreview item={previewItem} />
      {failed ? <StatusBanner tone="warn" title="曾出现生成失败" body={textValue(failed.payload.error_message)} /> : null}
      <MetricGrid
        items={[
          ["资产状态", item?.status],
          ["时长", secondsValue(item?.asset_ref?.duration ?? checks?.duration_seconds)],
          ["文件大小", fileSizeValue(item?.asset_ref?.file_size ?? checks?.local_file_size)],
          ["资产检查", textValue(assetCheck?.payload.status) || "未记录"],
        ]}
      />
      <CheckList
        items={[
          ["生成完成事件", Boolean(checks?.generation_completed_event_present)],
          ["资产引用存在", Boolean(checks?.asset_reference_present)],
          ["本地文件存在", Boolean(checks?.local_file_exists)],
          ["草稿文本干净", Boolean(checks?.draft_text_clean)],
        ]}
      />
    </div>
  );
}

function PublishDetail({ experiment }: { experiment: ExperimentView }) {
  const event = latestEvent(experiment.events, "publish_recorded");
  const evidence = objectValue(event?.payload.evidence);
  if (!event || !evidence) {
    return <EmptyDetail title="还没有发布证据" body="生成资产不等于已发布。需要登记平台 URL、post id、Buffer id 或 mock 发布证据。" />;
  }
  const isMock = Boolean(evidence.mock);
  const postUrl = textValue(evidence.platform_url || evidence.url || evidence.post_url);
  return (
    <div className="step-detail">
      <StatusBanner
        tone={isMock ? "warn" : "good"}
        title={isMock ? "Mock 发布证据" : "真实发布证据"}
        body={isMock ? "这只验证闭环，不代表内容已经真实发到平台。" : "已有可追溯的平台发布证据。"}
      />
      <MetricGrid
        items={[
          ["平台", textValue(evidence.platform)],
          ["发布时间", formatDateTime(textValue(evidence.published_at))],
          ["平台 post id", textValue(evidence.platform_post_id || evidence.post_id)],
          ["Buffer id", textValue(evidence.buffer_post_id)],
        ]}
      />
      {postUrl ? (
        <a className="evidence-link" href={postUrl} rel="noreferrer" target="_blank">
          打开发布链接
        </a>
      ) : null}
      <InfoBlock title="说明" value={textValue(evidence.mock_label || evidence.note || evidence.reason)} />
    </div>
  );
}

function RetroDetail({ experiment }: { experiment: ExperimentView }) {
  const metrics = objectValue(latestEvent(experiment.events, "metrics_recorded")?.payload.metrics);
  const retro = objectValue(latestEvent(experiment.events, "retro_written")?.payload.retro);
  const observation = latestEvent(experiment.events, "observation_written")?.payload.observation;
  const memory = objectValue(latestEvent(experiment.events, "memory_written")?.payload.memory);
  if (!metrics && !retro && !observation && !memory) {
    return <EmptyDetail title="还没有复盘" body="发布和指标确认后，才能写正式复盘；没有发布证据只能写 observation。" />;
  }
  return (
    <div className="step-detail">
      {metrics ? (
        <>
          <StatusBanner
            tone={metrics.mock ? "warn" : "good"}
            title={metrics.mock ? "Mock 指标" : "真实指标"}
            body={textValue(metrics.note || metrics.interpretation || metrics.metrics_source)}
          />
          <MetricGrid
            items={[
              ["浏览", numberValue(metrics.views)],
              ["点赞", numberValue(metrics.likes)],
              ["收藏", numberValue(metrics.saves)],
              ["评论", numberValue(metrics.comments)],
              ["完播率", percentValue(metrics.completion_rate)],
              ["收藏率", percentValue(metrics.save_rate)],
            ]}
          />
        </>
      ) : null}
      <InfoBlock title="复盘结论" value={textValue(retro?.summary || retro?.decision || retro?.prediction_result)} limit={520} />
      <BulletBlock title="有效做法" items={textList(retro?.what_worked)} />
      <BulletBlock title="下一步改进" items={textList(retro?.what_to_improve || retro?.issues_found)} />
      <InfoBlock title="观察记录" value={summarizeValue(observation, 520)} />
      <InfoBlock title="写入记忆" value={textValue(memory?.learning || memory?.content_learning)} limit={520} />
    </div>
  );
}

function AssetPreview({ item }: { item: ContentItem | null }) {
  if (!item) return null;
  const canPreview = item.asset_media_type === "video" && item.asset_url && item.asset_preview_available;
  if (!canPreview) {
    return (
      <div className="asset-preview-empty">
        <strong>当前资产不能直接预览</strong>
        <span>资产记录存在，但 API 没有找到可安全访问的本地视频文件。</span>
      </div>
    );
  }
  return (
    <div className="asset-preview">
      <video controls playsInline preload="metadata" src={item.asset_url} />
      <div>
        <strong>{item.title}</strong>
        <a href={item.asset_url} rel="noreferrer" target="_blank">
          打开原视频
        </a>
      </div>
    </div>
  );
}

function EmptyDetail({ title, body }: { title: string; body: string }) {
  return (
    <div className="inline-empty">
      <AlertTriangle size={18} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function StatusBanner({ tone, title, body }: { tone: "good" | "warn"; title: string; body?: string }) {
  return (
    <div className={`status-banner ${tone}`}>
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
    </div>
  );
}

function MetricGrid({ items }: { items: Array<[string, string | number | null | undefined]> }) {
  const visibleItems = items
    .map(([label, value]) => [label, displayValue(value)] as const)
    .filter(([, value]) => value !== "-");
  if (!visibleItems.length) return null;
  return (
    <div className="metric-grid">
      {visibleItems.map(([label, value]) => (
        <div className="metric-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function InfoBlock({ title, value, limit = 300 }: { title: string; value?: string; limit?: number }) {
  const text = summarizeValue(value, limit);
  if (text === "-") return null;
  return (
    <section className="info-block">
      <h4>{title}</h4>
      <p>{text}</p>
    </section>
  );
}

function BulletBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="info-block">
      <h4>{title}</h4>
      <ul className="compact-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function ScriptBlock({ text }: { text?: string }) {
  const script = textValue(text);
  if (!script) return <EmptyDetail title="草稿正文缺失" body="当前事件没有可展示的最终字幕或口播稿。" />;
  return <pre className="script-block">{script}</pre>;
}

function CheckList({ items }: { items: Array<[string, boolean]> }) {
  return (
    <div className="check-list">
      {items.map(([label, passed]) => (
        <div className={passed ? "passed" : "failed"} key={label}>
          <span>{passed ? "通过" : "缺失"}</span>
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}

function EvidenceDrawer({ step, experiment }: { step: (typeof LOOP_STEPS)[number]; experiment: ExperimentView | null }) {
  const evidence = summarizeEvidence(step, experiment);
  return (
    <details className="evidence panel">
      <summary>证据记录 · {step.label}</summary>
      {evidence.length ? (
        <div className="evidence-list">
          {evidence.map((event) => (
            <article className="event-card" key={event.id}>
              <div>
                <strong>{event.event_type}</strong>
                <span>{event.source?.kind ? String(event.source.kind) : "unknown"}</span>
              </div>
              <pre>{JSON.stringify(event.payload, null, 2)}</pre>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">当前步骤暂无证据。</p>
      )}
    </details>
  );
}

function findEventById(events: OpsEvent[], eventId: string): OpsEvent | null {
  return events.find((event) => event.id === eventId) || null;
}

function objectValue(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function textValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "string" ? value.trim() : summarizeValue(value as JsonValue, 320);
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => textValue(item)).filter(Boolean);
  }
  const text = textValue(value);
  return text ? [text] : [];
}

function displayValue(value: string | number | null | undefined): string {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function secondsValue(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(number % 1 === 0 ? 0 : 1)}s` : "";
}

function fileSizeValue(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number < 1024 * 1024) return `${Math.round(number / 1024)} KB`;
  return `${(number / 1024 / 1024).toFixed(1)} MB`;
}

function percentValue(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "";
}

function numberValue(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "";
}

function formatDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ProjectsScreen({
  project,
  accounts,
  onSaved,
}: {
  project: OpsProject | null;
  accounts: ChannelAccount[];
  onSaved: (accountId: string) => void;
}) {
  const [editingAccountId, setEditingAccountId] = useState("");
  const editingAccount = accounts.find((account) => account.id === editingAccountId) || null;
  useEffect(() => {
    if (editingAccountId && !accounts.some((account) => account.id === editingAccountId)) {
      setEditingAccountId("");
    }
  }, [accounts, editingAccountId]);
  if (!project) {
    return (
      <div className="single-panel">
        <EmptyState title="请选择项目" body="先选择一个项目，再配置该项目下的平台账号。" action="使用顶部项目选择器" />
      </div>
    );
  }
  return (
    <section className="projects-grid">
      <div className="panel project-panel">
        <div className="section-heading">
          <h2>项目配置</h2>
          <p>这里只维护项目下的平台账号，不写选题、生成、发布或复盘事实。</p>
        </div>
        <div className="project-context">
          <ContextItem label="项目" value={project.name} meta={project.id} />
          <ContextItem label="产品" value={project.product} />
          <ContextItem label="默认渠道" value={project.channel} />
        </div>
        <div className="account-list-head">
          <div>
            <h3>平台账号</h3>
            <p>同一项目可配置多个平台账号，发布证据和后续数据按账号归属。</p>
          </div>
          <button className="button" onClick={() => setEditingAccountId("")} type="button">
            新增账号
          </button>
        </div>
        <div className="account-list">
          {accounts.length ? (
            accounts.map((account) => (
              <button
                className={`account-card ${editingAccount?.id === account.id ? "active" : ""}`}
                key={account.id}
                onClick={() => setEditingAccountId(account.id)}
                type="button"
              >
                <div>
                  <strong>{account.account_name}</strong>
                  <span>{account.platform} · {account.account_handle || account.external_account_id || "未记录 handle"}</span>
                </div>
                <span className="pill">{account.status}</span>
              </button>
            ))
          ) : (
            <p className="muted">该项目还没有平台账号。</p>
          )}
        </div>
      </div>
      <AccountForm account={editingAccount} key={editingAccount?.id || "new-account"} projectId={project.id} onSaved={onSaved} />
    </section>
  );
}

function AccountForm({
  projectId,
  account,
  onSaved,
}: {
  projectId: string;
  account: ChannelAccount | null;
  onSaved: (accountId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const credentialRef = account?.credential_ref || {};
  const mode = account ? "edit" : "create";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(event.currentTarget);
    const accountName = String(formData.get("account_name") || "").trim();
    if (!accountName) {
      setError("请填写账号名称。");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    const credentialRefPayload: JsonObject = {};
    const provider = String(formData.get("credential_provider") || "").trim();
    const key = String(formData.get("credential_key") || "").trim();
    if (provider) credentialRefPayload.provider = provider;
    if (key) credentialRefPayload.key = key;
    try {
      const payload = {
        platform: String(formData.get("platform") || "xiaohongshu"),
        account_name: accountName,
        account_handle: String(formData.get("account_handle") || "").trim() || null,
        external_account_id: String(formData.get("external_account_id") || "").trim() || null,
        status: String(formData.get("status") || "configured"),
        credential_ref: credentialRefPayload,
        buffer_channel_id: String(formData.get("buffer_channel_id") || "").trim() || null,
      };
      const result = account ? await updateChannelAccount(account.id, payload) : await createChannelAccount(projectId, payload);
      setSuccess(true);
      if (!account) form.reset();
      onSaved(result.channel_account.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "平台账号保存失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="panel account-form" onSubmit={submit}>
      <div className="section-heading">
        <h2>{mode === "edit" ? "编辑平台账号" : "新增平台账号"}</h2>
        <p>只保存引用，不保存平台密码或明文 token。</p>
      </div>
      <div className="form-grid">
        <label>
          平台
          <select name="platform" defaultValue={account?.platform || "xiaohongshu"}>
            <option value="xiaohongshu">小红书</option>
            <option value="douyin">抖音</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label>
          账号名称
          <input defaultValue={account?.account_name || ""} name="account_name" placeholder="PetWoods 宠物森友会" />
        </label>
        <label>
          Handle
          <input defaultValue={account?.account_handle || ""} name="account_handle" placeholder="petwoods" />
        </label>
        <label>
          外部账号 ID
          <input defaultValue={account?.external_account_id || ""} name="external_account_id" />
        </label>
        <label>
          状态
          <select name="status" defaultValue={account?.status || "configured"}>
            <option value="configured">configured</option>
            <option value="connected">connected</option>
            <option value="needs_auth">needs_auth</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
        <label>
          Credential provider
          <input defaultValue={String(credentialRef.provider || "manual")} name="credential_provider" />
        </label>
        <label>
          Credential key
          <input defaultValue={String(credentialRef.key || "")} name="credential_key" placeholder="pixelle/petwoods/xhs" />
        </label>
        <label>
          Buffer channel ID
          <input defaultValue={String(credentialRef.buffer_channel_id || "")} name="buffer_channel_id" />
        </label>
      </div>
      {error ? <div className="form-message error">{error}</div> : null}
      {success ? <div className="form-message success">{mode === "edit" ? "平台账号已更新。" : "平台账号已保存。"}</div> : null}
      <button className="button primary" disabled={submitting} type="submit">
        <Settings2 size={16} />
        {submitting ? "保存中" : mode === "edit" ? "更新平台账号" : "保存平台账号"}
      </button>
    </form>
  );
}

function LoadingScreen() {
  return (
    <div className="center-state">
      <Loader2 className="spin" size={24} />
      <strong>正在读取 Ops 状态</strong>
    </div>
  );
}

function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="center-state error-state">
      <AlertTriangle size={24} />
      <strong>Ops API 连接失败</strong>
      <p>{error}</p>
      <button className="button" onClick={onRetry} type="button">
        重试
      </button>
    </div>
  );
}

function NoProjects() {
  return (
    <div className="center-state">
      <strong>还没有运营项目</strong>
      <p>请先在 Codex 中创建运营项目。</p>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-card">
      <AlertTriangle size={22} />
      <h2>{title}</h2>
      <p>{body}</p>
      {onAction ? (
        <button className="button primary" onClick={onAction} type="button">
          {action}
        </button>
      ) : (
        <span>{action}</span>
      )}
    </div>
  );
}

function useStoredState(key: string, initialValue: string) {
  const [value, setValue] = useState(() => window.localStorage.getItem(key) || initialValue);
  const setStoredValue = (nextValue: string) => {
    setValue(nextValue);
    if (nextValue) window.localStorage.setItem(key, nextValue);
    else window.localStorage.removeItem(key);
  };
  return [value, setStoredValue] as const;
}
