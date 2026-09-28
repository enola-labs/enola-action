import { PackageMetric, PackageMetricRow, PackageMetricsDelta } from "../core/types.js";
import { plural } from "./findings.js";

// How many packages the section lists before counting the rest.
const PACKAGE_LIMIT = 25;

// Go's %.2f on the value Enola rounded to three places. 0.625 prints 0.62 in Enola's own
// verdict; toFixed would print 0.63, and the two surfaces would disagree about one number.
function fixed2(value: number): string {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const rest = scaled - floor;
  const rounded = rest > 0.5 ? floor + 1 : rest < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  return (rounded / 100).toFixed(2);
}

function moved(before: string, after: string): string {
  return before === after ? after : `${before} → ${after}`;
}

// What the section lists by default: packages added or removed, and packages whose D or
// zone moved. A package whose Ca or Ce moved without moving either is listed only with
// `detail`, because on its own it says nothing about the package's health.
function headline(row: PackageMetricRow): boolean {
  if (!row.before || !row.after) return true;
  return fixed2(row.before.distance) !== fixed2(row.after.distance) || row.zone_before !== row.zone_after;
}

function cells(b: PackageMetric | undefined, a: PackageMetric | undefined): string[] {
  const pick = (m: PackageMetric | undefined, f: (m: PackageMetric) => string) => (m ? f(m) : "");
  const col = (f: (m: PackageMetric) => string) => {
    if (!b || !a) return pick(a || b, f);
    return moved(f(b), f(a));
  };
  return [
    col((m) => String(m.afferent_couplings)),
    col((m) => String(m.efferent_couplings)),
    col((m) => fixed2(m.instability)),
    col((m) => fixed2(m.abstractness)),
    col((m) => fixed2(m.distance)),
  ];
}

function zoneCell(row: PackageMetricRow): string {
  if (!row.before) return `added (${row.zone_after})`;
  if (!row.after) return `removed (${row.zone_before})`;
  const zone = moved(row.zone_before || "", row.zone_after || "");
  return row.zone_incidental ? `${zone} ¹` : zone;
}

function rowLine(row: PackageMetricRow): string {
  return `| \`${row.package}\` | ${cells(row.before, row.after).join(" | ")} | ${zoneCell(row)} |`;
}

// What the change did to the package metrics. Silent when nothing moved and when the
// verdict carries no delta at all, as one from an older Enola does not, so a job summary
// under that Enola is exactly what it was.
export function packageMetricsMarkdown(delta?: PackageMetricsDelta | null, detail = false): string {
  const rows = delta?.packages || [];
  if (!delta || !rows.length) return "";
  const { before, after } = delta;
  let markdown = `## Package metrics\n\n`;
  markdown += `avg D ${moved(fixed2(before.avg_distance), fixed2(after.avg_distance))} · ` +
    `avg I ${moved(fixed2(before.avg_instability), fixed2(after.avg_instability))} · ` +
    `off main sequence ${moved(String(before.off_main_sequence), String(after.off_main_sequence))} · ` +
    `${delta.worsened} worse, ${delta.improved} better. Reported, never graded.\n\n`;

  // In Enola's order: packages entering or leaving a zone first, then by the size of
  // the D change. Filtering keeps it.
  const listed = detail ? rows : rows.filter(headline);
  const unlisted = rows.length - listed.length;
  if (listed.length) {
    markdown += "| Package | Ca | Ce | I | A | D | Zone |\n|---|---:|---:|---:|---:|---:|---|\n";
    for (const row of listed.slice(0, PACKAGE_LIMIT)) markdown += `${rowLine(row)}\n`;
    markdown += "\n";
    if (listed.length > PACKAGE_LIMIT) {
      markdown += `…and ${listed.length - PACKAGE_LIMIT} more, in the \`verdict-file\` output.\n\n`;
    }
    if (listed.some((row) => row.zone_incidental)) {
      markdown += "¹ The package's own numbers did not change; the population's rigid floor moved.\n\n";
    }
  }
  if (unlisted > 0) {
    markdown += `${plural(unlisted, "more package", "more packages")} moved without a change in D or zone. ` +
      "Set `detail: true` to list them.\n\n";
  }
  return markdown;
}
