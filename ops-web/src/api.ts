import type {
  CreateChannelAccountInput,
  CreateChannelAccountResponse,
  ContextExportResponse,
  CurrentResponse,
  IntegrationsResponse,
  ProjectCyclesResponse,
  ProjectsResponse,
  UpdateChannelAccountInput,
  UpdateChannelAccountResponse,
  WritebackDraftsResponse,
} from "./types";

const API_BASE = (import.meta.env.VITE_PIXELLE_API_BASE || "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = body?.detail?.error?.message || body?.detail || message;
    } catch {
      // Keep the HTTP status message when the backend does not return JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export function listProjects(): Promise<ProjectsResponse> {
  return request<ProjectsResponse>("/api/ops/projects");
}

export function listIntegrations(): Promise<IntegrationsResponse> {
  return request<IntegrationsResponse>("/api/ops/integrations");
}

export function listProjectCycles(projectId: string): Promise<ProjectCyclesResponse> {
  return request<ProjectCyclesResponse>(`/api/ops/projects/${encodeURIComponent(projectId)}/cycles`);
}

export function getCurrent(projectId?: string, channelAccountId?: string): Promise<CurrentResponse> {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId);
  if (channelAccountId) params.set("channel_account_id", channelAccountId);
  const query = params.toString();
  return request<CurrentResponse>(`/api/ops/current${query ? `?${query}` : ""}`);
}

export function getContextExport(projectId?: string, channelAccountId?: string): Promise<ContextExportResponse> {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId);
  if (channelAccountId) params.set("channel_account_id", channelAccountId);
  const query = params.toString();
  return request<ContextExportResponse>(`/api/ops/context-export${query ? `?${query}` : ""}`);
}

export function listWritebackDrafts(): Promise<WritebackDraftsResponse> {
  return request<WritebackDraftsResponse>("/api/ops/writeback-drafts");
}

export function createChannelAccount(
  projectId: string,
  input: CreateChannelAccountInput,
): Promise<CreateChannelAccountResponse> {
  return request<CreateChannelAccountResponse>(
    `/api/ops/projects/${encodeURIComponent(projectId)}/channel-accounts`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function updateChannelAccount(
  channelAccountId: string,
  input: UpdateChannelAccountInput,
): Promise<UpdateChannelAccountResponse> {
  return request<UpdateChannelAccountResponse>(
    `/api/ops/channel-accounts/${encodeURIComponent(channelAccountId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}
