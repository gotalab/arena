/**
 * The WebMCP registration surface differs by host: the ChatGPT desktop
 * in-app browser exposes `document.modelContext` (proven by the 2026-08-30
 * probe), while Chrome's origin trial exposes `navigator.modelContext`.
 * Registration must work in both, so resolve whichever the host provides.
 * The API is an experimental draft; absence means "no agent host", not an
 * error.
 */
export function resolveModelContext(): WebModelContext | undefined {
  return document.modelContext ?? navigator.modelContext;
}
