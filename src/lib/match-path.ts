/**
 * The Worker and client share this small public route set. `/` is a real
 * entrance, `/play` is the task shelf, `/benchmark` is the cross-task record,
 * and every task owns its detail, blind comparison and named build state.
 */
const TASK_HTML = /^\/task\/[a-z0-9-]{1,32}(?:\/compare|\/review|\/build\/[a-f0-9]{12})?$/;

/**
 * HTML documents the site actually publishes. Assets and `/api` are not
 * listed here; unknown HTML paths must 404 instead of falling through to
 * the SPA shell.
 */
export function knownHtmlPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (
    path === "/"
    || path === "/play"
    || path === "/benchmark"
    || path === "/method"
  ) {
    return true;
  }
  return TASK_HTML.test(path);
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}
