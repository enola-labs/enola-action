export type VerdictStatus = "clean" | "regression" | "usage_error" | "incomparable";

export interface Location {
  repo?: string;
  file: string;
  line?: number;
  end_line?: number;
}

export interface Evidence {
  file?: string;
  symbol?: string;
  fact?: string;
  detail?: string;
}

export interface Finding {
  title: string;
  source?: string;
  description?: string;
  confidence: number;
  location?: Location;
  evidence?: Evidence[];
}

export interface Verdict {
  schema_version?: number;
  tool?: { name: string; version: string };
  status: VerdictStatus;
  failures?: Finding[];
  advisories?: Finding[];
  resolved?: Finding[];
  comparability_warnings?: string[];
  blocking_kinds?: string[];
  edges_added: number;
  edges_removed: number;
  facts_added: number;
  facts_removed: number;
  facts_changed?: number;
  added_by_kind?: Record<string, number>;
  removed_by_kind?: Record<string, number>;
  edge_kinds_added?: Record<string, number>;
  edge_kinds_removed?: Record<string, number>;
}

export interface Inputs {
  version: string;
  binary?: string;
  config?: string;
  failOn?: string;
  minConfidence?: string;
  warnOnly: boolean;
  focus?: string;
  detail: boolean;
  target?: string;
  expected?: string;
  maxSpillover?: string;
  baseSha?: string;
  annotations: boolean;
  summary: boolean;
  workingDirectory: string;
  token?: string;
}

export interface RevisionContext {
  baseSha: string;
  headSha: string;
  eventName: string;
}

export interface WebhookPayload {
  pull_request?: { base?: { sha?: string } };
  before?: string;
  merge_group?: { base_sha?: string };
}
