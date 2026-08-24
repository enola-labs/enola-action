import { Verdict } from "../core/types.js";
import { actionOf, hostPath, identityOf, oneLine, placements, policyOf, reasonOf, ruleOf, excuseOf } from "./findings.js";

// SARIF 2.1.0, rendered from the verdict this run already has.
//
// Enola can write SARIF itself (`enola check -format sarif`), but a run emits ONE format,
// and the action needs the JSON verdict for its outputs and summary. Asking for SARIF
// too would mean a second `check` — a second snapshot of the whole repository — to
// re-render numbers already in hand. So this writer is a port of the engine's
// (`pkg/check/sarif.go`), down to the fingerprint scheme, and reads the same verdict.
//
// A rule per distinct rule id with the team's reason as its description, a result per
// finding in every bucket, the region from the evidence the explainer measured, and the
// finding's identity as a partial fingerprint so a host can follow one finding across
// builds. Resolved findings carry no region: the position they had is on the baseline
// side and the tree may no longer have that line.

const SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const VERSION = "2.1.0";
// Names the identity scheme, so a reader that stores fingerprints can tell this one from
// a later scheme that replaces it.
const FINGERPRINT_KEY = "enola/v1";

interface SarifRegion {
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: string;
  message: { text: string };
  locations?: { physicalLocation: { artifactLocation: { uri: string }; region?: SarifRegion } }[];
  partialFingerprints: Record<string, string>;
  suppressions?: { kind: string; justification: string }[];
  properties: {
    bucket: string;
    confidence: number;
    policy: string;
    source: string;
    suggestedAction?: string;
  };
}

export function toSarif(verdict: Verdict, enolaVersion: string, root?: string): string {
  const places = placements(verdict);

  const reasons = new Map<string, string>();
  for (const placement of places) {
    const id = ruleOf(placement.finding);
    if (!reasons.has(id)) reasons.set(id, reasonOf(placement.finding));
  }
  const ids = [...reasons.keys()].sort();
  const index = new Map(ids.map((id, i) => [id, i]));
  const rules = ids.map((id) => ({ id, shortDescription: { text: reasons.get(id) || "" } }));

  const results: SarifResult[] = places.map((placement) => {
    const id = ruleOf(placement.finding);
    const result: SarifResult = {
      ruleId: id,
      ruleIndex: index.get(id) ?? 0,
      level: placement.bucket.level,
      message: { text: oneLine(placement.finding.title) },
      partialFingerprints: { [FINGERPRINT_KEY]: placement.identity },
      properties: {
        bucket: placement.bucket.name,
        confidence: placement.finding.confidence,
        policy: policyOf(verdict, placement.finding),
        source: placement.finding.source || "",
      },
    };
    const action = actionOf(placement.finding);
    if (action) result.properties.suggestedAction = action;
    const at = placement.at;
    if (placement.located && at?.file && at.line && placement.bucket.name !== "resolved") {
      const region: SarifRegion = { startLine: at.line };
      if (at.column) region.startColumn = at.column;
      if (at.end_line) region.endLine = at.end_line;
      if (at.end_column) region.endColumn = at.end_column;
      result.locations = [
        { physicalLocation: { artifactLocation: { uri: hostPath(at.file, root) }, region } },
      ];
    }
    const excuse = excuseOf(verdict, placement.bucket.name, placement.finding);
    if (excuse) result.suppressions = [{ kind: "external", justification: excuse }];
    return result;
  });

  return JSON.stringify(
    {
      $schema: SCHEMA,
      version: VERSION,
      runs: [
        {
          tool: {
            driver: {
              name: "enola",
              version: enolaVersion.replace(/^v/, ""),
              informationUri: "https://github.com/enola-labs/enola",
              rules,
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  );
}
