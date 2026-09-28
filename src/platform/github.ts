// The pull request comment, over the REST API. Plain fetch, like the release lookup, so
// the bundle takes on no client library for four requests.

export interface CommentTarget {
  apiUrl: string;
  token: string;
  repository: string; // owner/name
  issueNumber: number;
}

export interface CommentResult {
  action: "created" | "updated" | "skipped";
  url?: string;
}

interface IssueComment {
  id: number;
  body?: string;
  html_url: string;
}

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;

async function request(target: CommentTarget, method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${target.apiUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${target.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const hint =
      response.status === 403 || response.status === 404
        ? " The token cannot write to this pull request: grant `pull-requests: write`. A pull request from a fork gets a read-only token."
        : "";
    throw new Error(`GitHub API ${method} ${path} returned HTTP ${response.status}.${hint}`);
  }
  return response.status === 204 ? undefined : response.json();
}

async function findComment(target: CommentTarget, marker: string): Promise<IssueComment | undefined> {
  const base = `/repos/${target.repository}/issues/${target.issueNumber}/comments`;
  for (let page = 1; ; page++) {
    const comments = (await request(target, "GET", `${base}?per_page=${PAGE_SIZE}&page=${page}`)) as IssueComment[];
    const found = comments.find((comment) => comment.body?.startsWith(marker));
    if (found) return found;
    if (comments.length < PAGE_SIZE) return undefined;
  }
}

// Edits the comment carrying the marker, or creates one when create is set. A run that
// does not earn a comment still edits an existing one, so it never goes stale.
export async function upsertComment(
  target: CommentTarget,
  marker: string,
  body: string,
  create: boolean,
): Promise<CommentResult> {
  const existing = await findComment(target, marker);
  if (existing) {
    const updated = (await request(target, "PATCH", `/repos/${target.repository}/issues/comments/${existing.id}`, {
      body,
    })) as IssueComment;
    return { action: "updated", url: updated.html_url };
  }
  if (!create) return { action: "skipped" };
  const created = (await request(target, "POST", `/repos/${target.repository}/issues/${target.issueNumber}/comments`, {
    body,
  })) as IssueComment;
  return { action: "created", url: created.html_url };
}
