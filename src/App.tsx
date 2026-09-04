import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaIcon } from "./components/ArenaIcon";
import { GameBrowser } from "./components/GameBrowser";
import { GitHubMark } from "./components/GitHubMark";
import { HomeView } from "./components/HomeView";
import { MethodView } from "./components/MethodView";
import { PlayList } from "./components/PlayList";
import { SelectedReview } from "./components/SelectedReview";
import { TaskIntro } from "./components/TaskIntro";
import { WebMcpProbe } from "./components/WebMcpProbe";
import { GameDetail } from "./components/benchmark/GameDetail";
import { ResultsView } from "./components/benchmark/ResultsView";
import { readArtifactAccessReady, requestArtifactAccess } from "./lib/access";
import { useComparison } from "./hooks/useComparison";
import { useArenaWebMcpTools } from "./hooks/useArenaWebMcpTools";
import { useTheme } from "./hooks/useTheme";
import { nextUnjudgedGame } from "./lib/blind";
import {
  BENCHMARK_CHART_COMBINED,
  benchmarkOverviewQueryString,
  normalizeBenchmarkOverviewState,
  parseBenchmarkOverviewSearchParams,
  type BenchmarkOverviewState,
} from "./lib/benchmark-view";
import { configurationParts } from "./lib/configurations";
import { checkLabel } from "./lib/format";
import { knownHtmlPath } from "./lib/match-path";
import { buildBySlug, buildSlug, comparePath, reviewPath, taskPath } from "./lib/paths";
import {
  normalizeTaskComparisonState,
  parseTaskComparisonSearchParams,
  serializeTaskComparisonSearchParams,
  type TaskComparisonState,
} from "./lib/task-comparison";
import { blindRelease, games as tasks, publication, taskManifests } from "./lib/publication";
import type { PublicBuild, PublicRelease } from "./public-types";
import type { ArenaToolRoute } from "./lib/arena-tools";
import type {
  ArenaBenchmarkController,
  BenchmarkFocusRequest,
  TaskComparisonFocusRequest,
  TaskComparisonFocusTarget,
} from "./lib/benchmark-controller";

const navItems = [
  { id: "play", label: "Play" },
  { id: "benchmark", label: "Benchmark" },
];

interface Location {
  route: string;
  /** A task slug on its detail, comparison or named-build state. */
  slug: string | null;
  buildSlug: string | null;
}

function locationPath(location: Location): string {
  if (location.route === "home") return "/";
  if (location.route === "task" && location.slug) return taskPath(location.slug);
  if (location.route === "compare" && location.slug) return comparePath(location.slug);
  if (location.route === "review" && location.slug) return reviewPath(location.slug);
  if (location.route === "build" && location.slug && location.buildSlug) {
    return `${taskPath(location.slug)}/build/${location.buildSlug}`;
  }
  return `/${location.route}`;
}

function readLocation(): Location {
  // Unknown paths stay on the URL the reader typed. Do not replaceState
  // them onto /benchmark: that is the soft-404 that made junk look like
  // the record.
  if (!knownHtmlPath(window.location.pathname)) {
    return { route: "not-found", slug: null, buildSlug: null };
  }
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { route: "home", slug: null, buildSlug: null };
  const segments = path.replace(/^\/+/, "").split("/");
  if (["play", "benchmark", "method"].includes(segments[0] ?? "") && segments.length === 1) {
    return { route: segments[0]!, slug: null, buildSlug: null };
  }
  if (segments[0] !== "task" || !tasks.some((task) => task.slug === segments[1])) {
    return { route: "not-found", slug: null, buildSlug: null };
  }
  const route = segments.length === 2 ? "task"
    : segments[2] === "compare" && segments.length === 3 ? "compare"
    : segments[2] === "review" && segments.length === 3 ? "review"
    : segments[2] === "build" && segments.length === 4 ? "build"
    : "not-found";
  const location = {
    route,
    slug: route === "not-found" ? null : segments[1]!,
    buildSlug: route === "build" ? segments[3]! : null,
  };
  const canonicalPath = locationPath(location);
  if (window.location.pathname !== canonicalPath || window.location.hash) {
    window.history.replaceState(null, "", `${canonicalPath}${window.location.search}`);
  }
  return location;
}

export function App() {
  // Restore the Access return path before reading the location. The
  // handshake lands on a fixed callback; replaceState does not emit
  // popstate, so a later restore would leave React on the wrong room.
  const [artifactAccessReady] = useState(() => {
    const ready = readArtifactAccessReady();
    if (!ready) requestArtifactAccess(`${window.location.pathname}${window.location.search}`);
    return ready;
  });
  const [location, setLocation] = useState(readLocation);
  const route = location.route;
  const { theme, toggleTheme } = useTheme();
  const { comparison, assignmentFor, battlesRemaining, nextBattle, saveChoice, revealWithoutPlaying } = useComparison(blindRelease);
  const [namedRelease, setNamedRelease] = useState<PublicRelease | null>(null);
  const [browseRequestedTask, setBrowseRequestedTask] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [benchmarkState, setBenchmarkState] = useState<BenchmarkOverviewState>({
    taskIds: [],
    harnesses: [],
    models: [],
    efforts: [],
    playableOnly: false,
    chartTaskId: BENCHMARK_CHART_COMBINED,
  });
  const [taskComparisonState, setTaskComparisonState] = useState<TaskComparisonState>({
    buildIds: [],
    harnesses: [],
    models: [],
    efforts: [],
    check: { ids: [], categories: [], groups: [], outcomes: [], blockingOnly: false, differencesOnly: false },
  });
  const [benchmarkFocusRequest, setBenchmarkFocusRequest] = useState<BenchmarkFocusRequest | null>(null);
  const [taskFocusRequest, setTaskFocusRequest] = useState<TaskComparisonFocusRequest | null>(null);
  const focusSequence = useRef(0);
  const webMcpProbe = (import.meta.env.DEV || import.meta.env.VITE_WEBMCP_PROBE === "true")
    && new URLSearchParams(window.location.search).get("webmcp-probe") === "1";

  useEffect(() => {
    const onPopState = () => {
      setLocation(readLocation());
      setHistoryRevision((current) => current + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const slugTask = useMemo(
    () => tasks.find((task) => task.slug === location.slug) ?? null,
    [location.slug],
  );
  const slugTaskManifest = useMemo(
    () => taskManifests.find((manifest) => manifest.taskId === slugTask?.id) ?? null,
    [slugTask?.id],
  );
  const namedBuild = useMemo(
    () => slugTask && namedRelease ? buildBySlug(namedRelease, slugTask.id, location.buildSlug) : null,
    [slugTask, location.buildSlug, namedRelease],
  );
  const needsNamedRelease = route === "benchmark"
    || route === "build"
    || route === "review"
    || (route === "task" && slugTask != null && Boolean(comparison.previews[slugTask.id] || comparison.choices[slugTask.id]))
    || (route === "compare" && slugTask != null && Boolean(comparison.choices[slugTask.id]));

  useEffect(() => {
    if (!needsNamedRelease || namedRelease) return undefined;
    let current = true;
    void import("./lib/release").then((module) => {
      if (current) setNamedRelease(module.release);
    });
    return () => { current = false; };
  }, [needsNamedRelease, namedRelease]);

  useEffect(() => {
    if (route !== "benchmark" || !namedRelease) return;
    setBenchmarkState(parseBenchmarkOverviewSearchParams(window.location.search, namedRelease, tasks));
  }, [historyRevision, namedRelease, route]);

  useEffect(() => {
    if (!["task", "build", "review"].includes(route) || !namedRelease || !slugTask) return;
    setTaskComparisonState(parseTaskComparisonSearchParams(window.location.search, namedRelease, slugTask.id));
  }, [historyRevision, namedRelease, route, slugTask]);

  const updateBenchmarkState = useCallback((next: BenchmarkOverviewState) => {
    if (!namedRelease || route !== "benchmark") return;
    setBenchmarkFocusRequest(null);
    const normalized = normalizeBenchmarkOverviewState(next, namedRelease, tasks);
    const query = benchmarkOverviewQueryString(normalized, namedRelease, tasks);
    window.history.replaceState(null, "", `${locationPath(location)}${query ? `?${query}` : ""}`);
    setBenchmarkState(normalized);
  }, [location, namedRelease, route]);

  const updateTaskComparisonState = useCallback((next: TaskComparisonState) => {
    if (!namedRelease || !slugTask || !["task", "build"].includes(route)) return;
    setTaskFocusRequest(null);
    const normalized = normalizeTaskComparisonState(next, namedRelease, slugTask.id);
    const query = serializeTaskComparisonSearchParams(normalized, namedRelease, slugTask.id).toString();
    window.history.replaceState(null, "", `${locationPath(location)}${query ? `?${query}` : ""}`);
    setTaskComparisonState(normalized);
  }, [location, namedRelease, route, slugTask]);

  const requestBenchmarkFocus = useCallback(() => {
    focusSequence.current += 1;
    setBenchmarkFocusRequest({ sequence: focusSequence.current, target: "filters" });
  }, []);

  const requestTaskFocus = useCallback((taskId: string, target: TaskComparisonFocusTarget, checkIds: readonly string[] = []) => {
    focusSequence.current += 1;
    setTaskFocusRequest({ sequence: focusSequence.current, taskId, target, checkIds: [...checkIds] });
  }, []);

  // The global record names every configuration. Preserve that provenance so
  // a later comparison is playable but cannot be recorded as a blind choice.
  useEffect(() => {
    if (route !== "benchmark" || !namedRelease) return;
    for (const task of tasks) {
      if (!comparison.previews[task.id]) revealWithoutPlaying(task.id);
    }
  }, [comparison.previews, namedRelease, revealWithoutPlaying, route]);

  // The Worker stamps the shared/first-load title; this keeps the tab title
  // honest across client-side navigation and names a directly shared build.
  useEffect(() => {
    const buildName = namedBuild
      ? configurationParts(namedRelease?.configurations.find((configuration) => configuration.id === namedBuild.configurationId)).name
      : null;
    const page = route === "home" ? "Playable Arena"
      : route === "benchmark" ? "Benchmark"
      : route === "method" ? "How we evaluate"
      : route === "not-found" ? "Not found"
      : route === "build" && slugTask && buildName ? `${slugTask.name} by ${buildName}`
      : route === "compare" && slugTask ? `${slugTask.name} blind comparison`
      : route === "review" && slugTask ? `${slugTask.name} selected review`
      : slugTask?.name ?? "Play";
    document.title = page === "Playable Arena" ? page : `${page} · Playable Arena`;
  }, [route, slugTask, namedBuild, namedRelease]);

  const navigate = useCallback((route: string, taskId?: string, trial?: PublicBuild | null) => {
    setBenchmarkFocusRequest(null);
    setTaskFocusRequest(null);
    const slug = taskId
      ? tasks.find((task) => task.id === taskId)?.slug ?? null
      : null;
    const target = {
      route,
      slug,
      buildSlug: trial ? buildSlug(trial) : null,
    };
    const preserveTaskSearch = ["task", "build", "review"].includes(route)
      && ["task", "build", "review"].includes(location.route)
      && location.slug === slug;
    window.history.pushState(null, "", `${locationPath(target)}${preserveTaskSearch ? window.location.search : ""}`);
    setLocation(target);
    window.scrollTo(0, 0);
  }, [location]);

  const openTask = (taskId: string) => navigate("task", taskId);
  const openCompare = (taskId: string) => navigate("compare", taskId);
  const openBuild = (taskId: string, trial: PublicBuild | null) => navigate(trial ? "build" : "task", taskId, trial);
  const browseResults = (taskId: string) => {
    setBrowseRequestedTask(taskId);
    revealWithoutPlaying(taskId);
  };

  const identityAvailable = Boolean(namedRelease && (
    route === "benchmark"
    || route === "build"
    || (route === "task" && slugTask && (comparison.previews[slugTask.id] || comparison.choices[slugTask.id]))
    || (route === "compare" && slugTask && comparison.choices[slugTask.id])
  ));
  const activeToolTaskId = ["task", "build", "compare", "review"].includes(route) ? slugTask?.id ?? null : null;
  const toolAuthorizationKey = `${webMcpProbe ? "probe" : route}:${activeToolTaskId ?? "all"}:${identityAvailable}:${namedRelease?.releaseId ?? ""}`;
  const toolAuthorizationRef = useRef(toolAuthorizationKey);
  toolAuthorizationRef.current = toolAuthorizationKey;
  const benchmarkController = useMemo<ArenaBenchmarkController>(() => ({
    overview: {
      state: benchmarkState,
      setState: updateBenchmarkState,
      focusRequest: benchmarkFocusRequest,
      requestFocus: requestBenchmarkFocus,
    },
    task: {
      state: taskComparisonState,
      setState: updateTaskComparisonState,
      focusRequest: taskFocusRequest,
      requestFocus: requestTaskFocus,
    },
  }), [benchmarkFocusRequest, benchmarkState, requestBenchmarkFocus, requestTaskFocus, taskComparisonState, taskFocusRequest, updateBenchmarkState, updateTaskComparisonState]);
  const arenaToolContext = useMemo(() => ({
    route: (webMcpProbe ? "not-found" : route) as ArenaToolRoute,
    activeTaskId: activeToolTaskId,
    identityAvailable,
    games: tasks,
    taskManifests,
    release: namedRelease,
    benchmarkController,
    openTask: (taskId: string, view: "results" | "blind" | "review") => navigate(view === "blind" ? "compare" : view === "review" ? "review" : "task", taskId),
    openBuild: (taskId: string, buildId: string) => {
      const build = namedRelease?.builds.find((candidate) => candidate.id === buildId && candidate.taskId === taskId);
      if (!build) throw new Error("public build not found");
      navigate("build", taskId, build);
    },
    authorized: () => toolAuthorizationRef.current === toolAuthorizationKey,
  }), [activeToolTaskId, benchmarkController, identityAvailable, namedRelease, navigate, route, toolAuthorizationKey, webMcpProbe]);
  useArenaWebMcpTools(arenaToolContext, toolAuthorizationKey);

  if (!artifactAccessReady) {
    return (
      <main className="bridge" aria-live="polite">
        <h1>Playable Arena</h1>
        <p>Just a moment.</p>
      </main>
    );
  }

  if (webMcpProbe) return <WebMcpProbe />;

  return (
    <div
      className="app-shell"
      data-match={route === "compare" && slugTask && !comparison.choices[slugTask.id] ? "" : undefined}
    >
      <header className="masthead">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("home"); }}>
          <svg aria-hidden="true" className="brand__mark" fill="currentColor" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1h14v2H1zm0 12h14v2H1zM1 3h2v10H1zm12 0h2v10h-2zM5 9h4v4H5z" />
          </svg>
          Arena
        </a>
        <nav className="nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a
              aria-current={route === item.id ? "page" : undefined}
              className={route === item.id ? "nav__link is-active" : "nav__link"}
              href={`/${item.id}`}
              key={item.id}
              onClick={(event) => { event.preventDefault(); navigate(item.id); }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="masthead__end">
          <a
            aria-label="Arena on GitHub"
            className="btn-icon"
            href="https://github.com/gotalab/arena"
            rel="noreferrer"
            target="_blank"
            title="Arena on GitHub"
          >
            <GitHubMark />
          </a>
          <NavMenu
            onNavigate={navigate}
            route={route}
            theme={theme}
            toggleTheme={toggleTheme}
          />
          <button
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            className="theme-text"
            onClick={toggleTheme}
            type="button"
          >
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </header>

      <main>
        {route === "home" && (
          <HomeView
            configurationCount={publication.configurationCount}
            firstComparisonBlind={!tasks[0] || !comparison.previews[tasks[0].id]}
            onBrowse={() => navigate("play")}
            onCompare={openCompare}
            onOpenTask={openTask}
            tasks={tasks}
          />
        )}
        {route === "play" && (
          <PlayList onOpenGame={openTask} tasks={tasks} />
        )}
        {route === "compare" && slugTask && (
          <GameBrowser
            assignmentFor={assignmentFor}
            battlesRemaining={battlesRemaining(slugTask.id)}
            choice={comparison.choices[slugTask.id]}
            gameToolsManifest={slugTaskManifest}
            identitySeen={Boolean(comparison.previews[slugTask.id])}
            nextTask={nextUnjudgedGame(tasks, slugTask.id, comparison.choices)}
            onChoice={saveChoice}
            onCloseStage={() => openTask(slugTask.id)}
            onNextBattle={() => nextBattle(slugTask.id)}
            onOpenBenchmark={openTask}
            onOpenStage={openCompare}
            release={blindRelease}
            revealRelease={namedRelease}
            selectedTask={slugTask}
          />
        )}
        {route === "task" && slugTask && !namedRelease && (
          <section className="doc bench" aria-labelledby="game-detail-heading">
            <TaskIntro
              onBrowse={() => browseResults(slugTask.id)}
              onCompare={() => openCompare(slugTask.id)}
              task={slugTask}
            />
          </section>
        )}
        {(route === "task" || route === "build") && slugTask && namedRelease && (route !== "build" || namedBuild) && (
          <GameDetail
            comparison={comparison}
            focusRequest={benchmarkController.task.focusRequest}
            gameToolsManifest={slugTaskManifest}
            initialBuild={namedBuild}
            initialBrowse={browseRequestedTask === slugTask.id}
            key={`${route}:${location.buildSlug ?? "task"}`}
            onBrowseHandled={() => setBrowseRequestedTask(null)}
            onCompare={() => openCompare(slugTask.id)}
            onOpenBenchmark={() => navigate("benchmark")}
            onOpenBuild={(trial) => openBuild(slugTask.id, trial)}
            onReveal={revealWithoutPlaying}
            onStateChange={benchmarkController.task.setState}
            release={namedRelease}
            state={benchmarkController.task.state}
            task={slugTask}
          />
        )}
        {route === "review" && slugTask && namedRelease && (() => {
          const selectedBuilds = taskComparisonState.buildIds
            .map((buildId) => namedRelease.builds.find((build) => build.id === buildId && build.taskId === slugTask.id))
            .filter((build): build is PublicBuild => Boolean(build && build.playability === "playable"));
          const validSelection = selectedBuilds.length === taskComparisonState.buildIds.length
            && selectedBuilds.length >= 2
            && selectedBuilds.length <= 4;
          if (!validSelection) {
            return (
              <section className="doc" aria-labelledby="review-recovery-heading">
                <p className="doc__eyebrow">Selected review</p>
                <h1 className="doc__title" id="review-recovery-heading">Choose 2–4 playable Builds first</h1>
                <p className="doc__lede">Return to the task results, select a shortlist, then ask WebMCP to open the review.</p>
                <button className="btn-primary btn-primary--inline" onClick={() => navigate("task", slugTask.id)} type="button">Back to {slugTask.name} results</button>
              </section>
            );
          }
          const checks = new Map(namedRelease.builds
            .filter((build) => build.taskId === slugTask.id)
            .flatMap((build) => build.checks.map((check) => [check.id, checkLabel(check)] as const)));
          const selectedCriteria = taskComparisonState.check.ids.map((id) => checks.get(id) ?? checkLabel(id));
          const totalBuilds = namedRelease.builds.filter((build) => build.taskId === slugTask.id).length;
          return (
            <SelectedReview
              builds={selectedBuilds}
              gameToolsManifest={slugTaskManifest}
              onClose={() => navigate("task", slugTask.id)}
              release={namedRelease}
              selectedCriteria={selectedCriteria}
              task={slugTask}
              totalBuilds={totalBuilds}
            />
          );
        })()}
        {route === "benchmark" && namedRelease && (
          <ResultsView
            focusRequest={benchmarkController.overview.focusRequest}
            onOpenGame={openTask}
            onStateChange={benchmarkController.overview.setState}
            release={namedRelease}
            state={benchmarkController.overview.state}
            tasks={tasks}
          />
        )}
        {needsNamedRelease && !namedRelease && route !== "task" && (
          <section className="doc"><p className="doc__lede">Loading published results.</p></section>
        )}
        {route === "build" && namedRelease && !namedBuild && (
          <section className="doc" aria-labelledby="not-found-heading"><h1 className="doc__title" id="not-found-heading">Not found</h1></section>
        )}
        {route === "method" && <MethodView />}
        {route === "not-found" && (
          <section className="doc" aria-labelledby="not-found-heading">
            <h1 className="doc__title" id="not-found-heading">Not found</h1>
            <p className="doc__lede">This page does not exist.</p>
          </section>
        )}
      </main>

      <footer className="colophon">
        {"Playable Arena · "}
        <a href="/method" onClick={(event) => { event.preventDefault(); navigate("method"); }}>How we evaluate</a>
        {" · by gotalab"}
      </footer>
    </div>
  );
}

/**
 * Phone site nav is one hamburger: destinations plus a theme row. Desktop
 * keeps the inline Play / Benchmark row; theme there is a labeled
 * Dark mode / Light mode word, never a moon. This control stays hidden
 * on a wide screen. A kebab would mean page actions.
 */
function NavMenu({
  onNavigate,
  route,
  theme,
  toggleTheme,
}: {
  onNavigate: (next: string) => void;
  route: string;
  theme: "light" | "dark";
  toggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    document.documentElement.dataset.navOpen = "";
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const first = rootRef.current?.querySelector<HTMLElement>(".nav-menu__list a, .nav-menu__theme");
    first?.focus();
    return () => {
      delete document.documentElement.dataset.navOpen;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={open ? "nav-menu is-open" : "nav-menu"} ref={rootRef}>
      <button
        aria-controls="site-nav-menu"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? "Close site menu" : "Open site menu"}
        className="btn-icon nav-menu__trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <ArenaIcon name={open ? "close" : "menu"} />
      </button>
      {open ? (
        <div className="nav-menu__list" id="site-nav-menu">
          <nav aria-label="Primary navigation">
            {navItems.map((item) => (
              <a
                aria-current={route === item.id ? "page" : undefined}
                className={route === item.id ? "is-active" : undefined}
                href={`/${item.id}`}
                key={item.id}
                onClick={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  onNavigate(item.id);
                }}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <button
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            className="nav-menu__theme"
            onClick={toggleTheme}
            type="button"
          >
            <span>Theme</span>
            <span className="nav-menu__state">{theme === "dark" ? "Dark mode" : "Light mode"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
