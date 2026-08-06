import { Inputs, RevisionContext, WebhookPayload } from "./types.js";

const ZERO_SHA = /^0+$/;

export function resolveRevisionContext(
  inputs: Inputs,
  eventName: string,
  payload: WebhookPayload,
  sha: string,
): RevisionContext {
  let baseSha = inputs.baseSha;

  if (!baseSha && eventName === "pull_request") {
    baseSha = payload.pull_request?.base?.sha;
  } else if (!baseSha && eventName === "push") {
    baseSha = payload.before;
  } else if (!baseSha && eventName === "merge_group") {
    baseSha = payload.merge_group?.base_sha;
  }

  if (!baseSha || ZERO_SHA.test(baseSha)) {
    throw new Error(
      `No usable base commit for ${eventName || "this event"}. Set the base-sha input explicitly.`,
    );
  }
  if (!sha) throw new Error("GitHub did not provide a current commit SHA.");

  return { baseSha, headSha: sha, eventName };
}
