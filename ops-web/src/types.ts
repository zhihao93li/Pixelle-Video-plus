export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, JsonValue>;

export interface ChannelAccount {
  id: string;
  project_id: string;
  platform: string;
  account_name: string;
  account_handle?: string | null;
  external_account_id?: string | null;
  status: string;
  credential_ref?: JsonObject;
  source?: JsonObject;
  created_at?: string;
}

export interface OpsProject {
  id: string;
  name: string;
  product: string;
  channel: string;
  description?: string | null;
  channel_accounts?: ChannelAccount[];
  social_accounts?: ChannelAccount[];
  created_at?: string;
}

export interface OperationCycle {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  starts_on?: string | null;
  ends_on?: string | null;
  created_at?: string;
}

export interface ContentExperiment {
  id: string;
  project_id: string;
  cycle_id: string;
  title: string;
  hypothesis: string;
  stage: string;
  created_at?: string;
  updated_at?: string;
}

export interface ContentItem {
  id: string;
  project_id: string;
  cycle_id: string;
  experiment_id: string;
  kind: string;
  title: string;
  status: string;
  asset_ref?: JsonObject;
  asset_url?: string;
  asset_media_type?: "video" | "audio" | "image" | "file";
  asset_preview_available?: boolean;
  created_at?: string;
}

export interface OpsEvent {
  id: string;
  operating_project_id: string;
  operation_cycle_id: string;
  content_experiment_id: string;
  content_item_id?: string | null;
  event_type: string;
  payload: JsonObject;
  source?: JsonObject;
  created_at?: string;
}

export interface NextAction {
  kind: string;
  blocked?: boolean;
  reason?: string;
  [key: string]: JsonValue | undefined;
}

export interface ExperimentView {
  experiment: ContentExperiment;
  content_items: ContentItem[];
  events: OpsEvent[];
  next_action: NextAction;
}

export interface CycleView {
  cycle: OperationCycle;
  experiments: ExperimentView[];
  next_action: NextAction;
}

export interface ProjectsResponse {
  status: string;
  projects: OpsProject[];
  next_action: NextAction;
}

export interface ProjectCyclesResponse {
  status: string;
  project: OpsProject;
  cycles: CycleView[];
  next_action: NextAction;
}

export interface CurrentResponse {
  project: OpsProject | null;
  cycle: OperationCycle | null;
  experiment: ContentExperiment | null;
  channel_accounts: ChannelAccount[];
  selected_channel_account: ChannelAccount | null;
  social_accounts: ChannelAccount[];
  selected_social_account: ChannelAccount | null;
  context: JsonObject;
  content_items: ContentItem[];
  events: OpsEvent[];
  next_action: NextAction;
}

export interface IntegrationSafeField {
  label: string;
  value: string;
}

export interface IntegrationSecretRef {
  label: string;
  configured: boolean;
  source: string;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  group: "generation" | "publish" | string;
  status: "configured" | "partial" | "missing" | string;
  description: string;
  owner: string;
  missing_fields: string[];
  safe_fields: IntegrationSafeField[];
  secret_refs: IntegrationSecretRef[];
}

export interface IntegrationsResponse {
  status: string;
  config_source: JsonObject;
  integrations: IntegrationStatus[];
  capabilities: JsonObject;
  next_action: NextAction;
}

export interface CreateChannelAccountInput {
  platform: string;
  account_name: string;
  account_handle?: string | null;
  external_account_id?: string | null;
  status: string;
  credential_ref: JsonObject;
  buffer_channel_id?: string | null;
}

export interface CreateChannelAccountResponse {
  status: string;
  channel_account: ChannelAccount;
  next_action: NextAction;
}

export type UpdateChannelAccountInput = CreateChannelAccountInput;

export type UpdateChannelAccountResponse = CreateChannelAccountResponse;

export interface ApiErrorShape {
  detail?: {
    error?: {
      code?: string;
      message?: string;
    };
  };
}
