// The statuses Enola can report, and the only list of them.
//
// `partial_clean` / `partial_regression` are what a run becomes when the two snapshots
// were produced by DIFFERENT producer sets — a pull request that adds the first file in
// a language, or a provider that ran on one side only. Enola used to decline those
// outright (exit 3); since fact providers it grades the intersection of the producers
// both sides have and says so. Exit codes stay 0/1, so a consumer that does not know
// the names sees a normal pass or fail — except one that validates the name, which is
// exactly what this action does, and why omitting them here failed clean pull requests
// with "Unknown Enola status: partial_clean".
export type VerdictStatus =
  | "clean"
  | "partial_clean"
  | "regression"
  | "partial_regression"
  | "usage_error"
  | "incomparable";

export interface Location {
  repo?: string;
  file: string;
  line?: number;
  end_line?: number;
}

// Evidence links a finding back to concrete facts/files/symbols. The span is the
// position the EXTRACTOR measured — never derived from a name — and it is what puts an
// annotation on the line that caused the finding rather than at the top of the file.
export interface Evidence {
  file?: string;
  symbol?: string;
  fact?: string;
  detail?: string;
  line?: number;
  end_line?: number;
  column?: number;
  end_column?: number;
}

export interface Finding {
  title: string;
  source?: string;
  description?: string;
  confidence: number;
  // Not emitted by any current Enola — findings carry their position on evidence. Kept
  // because a caller supplying a verdict from an older or wrapping engine may still set
  // it, and reading it costs nothing.
  location?: Location;
  evidence?: Evidence[];
  suggested_actions?: string[];
  informational?: boolean;
}

// A count the policy can gate on that no finding carries — spillover packages, today.
// A fatal breach makes the status a regression exactly as a failing finding does, which
// is why anything that counts regressions has to count these too.
export interface Measurement {
  name: string;
  label: string;
  count: number;
}

export interface Breach {
  measurement: Measurement;
  fatal?: boolean;
}

// One entry of the committed suppression ledger, as the verdict reports it back. Carried
// so a suppressed finding can name the excuse that kept it out of the gate.
export interface Suppression {
  finding_title_prefix?: string;
  rule?: string;
  owner?: string;
  reason?: string;
  date?: string;
}

// The policy Enola actually enforced, as it reports it back — not what the workflow
// asked for. Reading it from the verdict is what lets the action say "nothing was
// enforced" without re-deriving the rule from inputs and getting it wrong.
export interface Policy {
  fail_explainers?: string[] | null;
  min_confidence?: number;
  warn_only?: boolean;
  thresholds?: unknown[];
  suppressions?: Suppression[] | null;
}

export interface CensusCause {
  cause: string;
  count: number;
}

export interface ProviderSkip {
  name: string;
  reason?: string;
  causes?: CensusCause[];
}

export interface ProviderOverlapLine {
  name: string;
  already_resolved: number;
  respelled: number;
  conflict: number;
}

// What the run could not see, reported on every outcome including a pass. A pass over a
// graph that skipped the files the change touched must not read like one that resolved
// them.
export interface Census {
  recorded: boolean;
  files_excluded_by_ignore: number;
  dirs_excluded_by_ignore: number;
  provider_skips?: ProviderSkip[];
  outside_graph?: Record<string, number>;
  dead_exemptions: number;
  unused_suppressions: number;
  dynamic_feature_classes: number;
  provider_overlap?: ProviderOverlapLine[];
}

// A producer present on one side only, with what its exclusion cost the grading.
export interface ExcludedProducer {
  name: string;
  kind: string; // "extractor" | "provider"
  lacked_by: string; // "baseline" | "current"
  baseline_facts_excluded: number;
  current_facts_excluded: number;
  baseline_findings_excluded: number;
  current_findings_excluded: number;
}

export interface IntersectionGrading {
  shared_extractors: string[];
  shared_providers?: string[];
  excluded: ExcludedProducer[];
}

export interface Verdict {
  schema_version?: number;
  tool?: { name: string; version: string };
  status: VerdictStatus;
  policy?: Policy;
  census?: Census | null;
  // What the change introduced, by bucket. Failures and advisories are the two the gate
  // is about; the rest exist because Enola refuses to fold them into either — a rule
  // that was newly DECLARED over code nobody touched is not a regression this change
  // introduced, and a breach that stopped being reported because its rule was deleted is
  // not a fix. Reading only failures/advisories silently drops all of it.
  failures?: Finding[];
  advisories?: Finding[];
  declared?: Finding[];
  descriptive?: Finding[];
  incidental?: Finding[];
  suppressed?: Finding[];
  exempted?: Finding[];
  silenced?: Finding[];
  undeclared?: Finding[];
  unattributed?: Finding[];
  resolved?: Finding[];
  measurements?: Measurement[];
  breaches?: Breach[];
  intersection_grading?: IntersectionGrading | null;
  guidance?: unknown[];
  comparability_warnings?: string[];
  blocking_kinds?: string[];
  advisory_kinds?: string[];
  edges_added: number;
  edges_removed: number;
  facts_added: number;
  facts_removed: number;
  facts_changed?: number;
  added_by_kind?: Record<string, number>;
  removed_by_kind?: Record<string, number>;
  edge_kinds_added?: Record<string, number>;
  edge_kinds_removed?: Record<string, number>;
  findings_changed?: unknown[];
  diff?: SnapshotDiff | null;
}

// The delta itself, embedded in every JSON verdict. Only the parts the summary renders
// are typed; the document carries more.
export interface SnapshotDiff {
  facts_added?: Fact[];
  facts_removed?: Fact[];
  edges_added?: Edge[];
  edges_removed?: Edge[];
}

export interface Fact {
  kind: string;
  name: string;
  file?: string;
  line?: number;
  repo?: string;
}

export interface Edge {
  source: string;
  kind: string;
  target: string;
  repo?: string;
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
  sarif: boolean;
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
