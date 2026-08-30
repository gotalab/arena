/**
 * The blind-choice API: one session handshake, then CSRF-protected writes.
 *
 * Locally there is no server to write to, so the caller keeps the choice in
 * local storage only. Everything here is network, nothing is state.
 */

import { usesRuntimeApi } from "../platform/env";

interface Session {
  csrfToken: string;
}

let session: Session | null = null;

async function ensureSession(): Promise<Session> {
  if (session) return session;
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not start a secure comparison session.");
  session = (await response.json()) as Session;
  return session;
}

/** Plain Vite development skips the write; the local full runtime exercises
 * the same API path as production. */
export async function postBlindChoice({ assignmentId, choice }: { assignmentId: string; choice: string }): Promise<void> {
  if (!usesRuntimeApi()) return;
  const current = await ensureSession();
  const response = await fetch("/api/blind-choices", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Arena-CSRF": current.csrfToken,
    },
    body: JSON.stringify({ assignmentId, choice }),
  });
  if (!response.ok) throw new Error("Your choice could not be saved. Please try again.");
}
