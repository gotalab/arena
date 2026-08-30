import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useWebMcpGameTools } from "../hooks/useWebMcpGameTools";
import { probeArtifact, type PaneStatus } from "../lib/artifact-frame";
import type { PublicGameTaskManifest } from "../lib/game-tools";
import type { PublicTaskPresentation as TaskPresentation } from "../public-types";

/**
 * The one place a sealed build appears on screen. Every surface that shows a
 * game — the blind matchup, the benchmark page's single-build player, the
 * open comparison — renders this component, so the stage grammar (all panes
 * stay mounted, switching never reloads a run, fullscreen, keyboard focus
 * handed to the active frame) is written once and polished once.
 *
 * Inactive panes stay mounted with `visibility: hidden`, never `display:
 * none`. A sandboxed canvas that boots while hidden often never paints, so
 * a pane's iframe `src` is attached only after that pane has been selected
 * — then kept for the rest of the session so a switch does not reset the
 * run. Load, 404 and network failure surface as a loader or retry; a blank
 * floor is not treated as a playable side.
 */

export interface StagePane {
  id: string;
  src: string;
  /** iframe title for assistive tech. */
  title: string;
  /** Tab text when more than one pane shares the stage. */
  tabLabel: ReactNode;
}

interface StageProps {
  panes: StagePane[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Bar content shown instead of tabs when a single pane needs a name. */
  barLabel?: ReactNode;
  /** Extra bar controls (previous/next, close), right of the tabs. */
  barExtra?: ReactNode;
  /** Fires whenever a pane's load state changes, so a vote can wait on paint. */
  onPaneStatus?: (id: string, status: PaneStatus) => void;
  /** Task-owned comparison frame; historical releases default to 390x780. */
  presentation?: TaskPresentation;
  /** Optional trusted contract for the active frame. Generated HTML never supplies this. */
  gameToolsManifest?: PublicGameTaskManifest;
}

export type { PaneStatus };

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
  webkitFullscreenEnabled?: boolean;
};

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

function fullscreenElement(): Element | null {
  const doc = document as FsDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function fullscreenEnabled(): boolean {
  const doc = document as FsDocument;
  return Boolean(document.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

function preferViewportFullscreen(): boolean {
  return Math.min(window.innerWidth, window.innerHeight) <= 480;
}

async function requestStageFullscreen(node: HTMLElement): Promise<void> {
  if (typeof node.requestFullscreen === "function") {
    await node.requestFullscreen();
    return;
  }
  const webkit = (node as FsElement).webkitRequestFullscreen;
  if (webkit) await webkit.call(node);
}

async function exitStageFullscreen(): Promise<void> {
  if (typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return;
  }
  const webkit = (document as FsDocument).webkitExitFullscreen;
  if (webkit) await webkit.call(document);
}

function setStageFullscreenFlag(active: boolean) {
  if (active) document.documentElement.dataset.stageFullscreen = "";
  else delete document.documentElement.dataset.stageFullscreen;
}

const LOAD_TIMEOUT_MS = 20_000;

interface FrameProps {
  pane: StagePane;
  active: boolean;
  onStatus: (status: PaneStatus) => void;
  onReadyFocus: () => void;
  onRetry: () => void;
  onFrameElement: (frame: HTMLIFrameElement | null) => void;
}

/**
 * One sealed document: probe, then frame. Remount (via `key`) to retry.
 */
function Frame({ pane, active, onStatus, onReadyFocus, onRetry, onFrameElement }: FrameProps) {
  const [phase, setPhase] = useState<"wait" | "frame" | "missing" | "failed">("wait");
  const [ready, setReady] = useState(false);
  const settled = useRef(false);
  const onStatusRef = useRef(onStatus);
  const onFrameElementRef = useRef(onFrameElement);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  onStatusRef.current = onStatus;
  onFrameElementRef.current = onFrameElement;

  useEffect(() => {
    let cancelled = false;
    settled.current = false;
    setReady(false);
    onStatusRef.current("loading");
    setPhase("wait");

    const fail = (status: "missing" | "error") => {
      if (cancelled || settled.current) return;
      settled.current = true;
      setPhase(status === "missing" ? "missing" : "failed");
      onStatusRef.current(status);
    };

    void (async () => {
      const probe = await probeArtifact(pane.src);
      if (cancelled) return;
      switch (probe) {
        case "missing":
          fail("missing");
          return;
        case "error":
          fail("error");
          return;
        case "ok":
        case "unknown":
          setPhase("frame");
          return;
        default: {
          const _exhaustive: never = probe;
          return _exhaustive;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pane.src]);

  useEffect(() => {
    if (phase !== "frame") return undefined;
    const timer = window.setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      setPhase("failed");
      onStatusRef.current("error");
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => () => onFrameElementRef.current(null), []);

  const onFrameLoad = () => {
    if (settled.current) return;
    settled.current = true;
    setReady(true);
    onFrameElementRef.current(frameRef.current);
    onStatus("ready");
    if (active) onReadyFocus();
  };

  const onFrameError = () => {
    if (settled.current) return;
    settled.current = true;
    setPhase("failed");
    onStatus("error");
  };

  const showLoader = phase === "wait" || (phase === "frame" && !ready);
  const showFail = phase === "missing" || phase === "failed";

  return (
    <>
      {showLoader ? (
        <div className="deck__status" data-state="loading" role="status">
          <p>Loading this game…</p>
        </div>
      ) : null}
      {showFail ? (
        <div className="deck__status" data-state="error" role="alert">
          <p>{phase === "missing" ? "This game is missing." : "This game did not load."}</p>
          <button className="btn-quiet deck__retry" onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {phase === "frame" ? (
        <iframe
          onError={onFrameError}
          onLoad={onFrameLoad}
          ref={frameRef}
          sandbox="allow-scripts"
          src={pane.src}
          tabIndex={active ? 0 : -1}
          title={pane.title}
        />
      ) : null}
    </>
  );
}

const DEFAULT_VIEWPORT = { width: 390, height: 780 } as const;

export function Stage({ panes, activeIndex, onSelect, barLabel, barExtra, onPaneStatus, presentation, gameToolsManifest }: StageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [fullscreenMode, setFullscreenMode] = useState<"none" | "native" | "viewport">("none");
  const isFullscreen = fullscreenMode !== "none";
  const stageViewport = presentation?.canonicalViewport ?? DEFAULT_VIEWPORT;
  const stageOrientation = stageViewport.width > stageViewport.height ? "landscape" : "portrait";
  const stageStyle = {
    "--stage-w": String(stageViewport.width),
    "--stage-h": String(stageViewport.height),
  } as CSSProperties;
  const [started, setStarted] = useState<ReadonlySet<string>>(() => {
    const id = panes[activeIndex]?.id;
    return id ? new Set([id]) : new Set();
  });
  const [retryKey, setRetryKey] = useState<Readonly<Record<string, number>>>({});
  const [readyFrames, setReadyFrames] = useState<Readonly<Record<string, HTMLIFrameElement>>>({});
  const [gameGeneration, setGameGeneration] = useState(0);
  const onPaneStatusRef = useRef(onPaneStatus);
  onPaneStatusRef.current = onPaneStatus;
  const activePaneId = panes[activeIndex]?.id ?? null;
  const activeFrame = activePaneId ? readyFrames[activePaneId] ?? null : null;
  const webMcpStatus = useWebMcpGameTools({
    frame: activeFrame,
    generation: gameGeneration,
    manifest: gameToolsManifest ?? null,
  });

  const rememberFrame = useCallback((id: string, frame: HTMLIFrameElement | null) => {
    setReadyFrames((current) => {
      if (frame && current[id] === frame) return current;
      if (!frame && !(id in current)) return current;
      const next = { ...current };
      if (frame) next[id] = frame;
      else delete next[id];
      return next;
    });
  }, []);

  const focusActiveFrame = (index: number) => {
    requestAnimationFrame(() => {
      const pane = rootRef.current?.querySelectorAll(".deck__pane")[index];
      pane?.querySelector("iframe")?.focus();
    });
  };

  useEffect(() => {
    const id = panes[activeIndex]?.id;
    if (!id) return;
    setStarted((current) => (current.has(id) ? current : new Set([...current, id])));
  }, [activeIndex, panes[activeIndex]?.id]);

  useEffect(() => {
    setGameGeneration((current) => current + 1);
  }, [activePaneId, retryKey[activePaneId ?? ""]]);

  useEffect(() => {
    focusActiveFrame(activeIndex);
  }, [activeIndex, panes.length, panes[activeIndex]?.id]);

  useEffect(() => {
    const sync = () => {
      const active = fullscreenElement() === rootRef.current;
      setFullscreenMode((current) => active ? "native" : current === "native" ? "none" : current);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync as EventListener);
      if (rootRef.current !== null && fullscreenElement() === rootRef.current) void exitStageFullscreen();
    };
  }, []);

  useEffect(() => {
    setStageFullscreenFlag(isFullscreen);
    focusActiveFrame(activeIndex);
    return () => setStageFullscreenFlag(false);
  }, [isFullscreen, activeIndex]);

  const toggleFullscreen = async () => {
    if (fullscreenMode === "viewport") {
      setFullscreenMode("none");
      return;
    }
    try {
      if (fullscreenElement()) await exitStageFullscreen();
      else if (
        rootRef.current
        && !preferViewportFullscreen()
        && fullscreenEnabled()
        && (typeof rootRef.current.requestFullscreen === "function"
          || typeof (rootRef.current as FsElement).webkitRequestFullscreen === "function")
      ) {
        await requestStageFullscreen(rootRef.current);
      } else {
        setFullscreenMode("viewport");
      }
    } catch {
      setFullscreenMode(fullscreenElement() === rootRef.current ? "native" : "viewport");
    }
  };

  const select = (index: number) => {
    onSelect(index);
    focusActiveFrame(index);
  };

  /** Roving-tab keyboard model, the same one the other tab strips use. */
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = panes.length;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let next: number | null = step ? (index + step + count) % count : null;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  const reportStatus = (id: string, status: PaneStatus) => {
    onPaneStatusRef.current?.(id, status);
  };

  const retry = (id: string) => {
    setRetryKey((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    onPaneStatusRef.current?.(id, "loading");
  };

  return (
    <div
      className={`deck${isFullscreen ? " is-fullscreen" : ""}${fullscreenMode === "viewport" ? " is-viewport-fullscreen" : ""}`}
      data-stage-orientation={stageOrientation}
      data-webmcp={gameToolsManifest ? webMcpStatus : undefined}
      ref={rootRef}
      style={stageStyle}
    >
      <div className="deck__bar">
        {panes.length > 1 ? (
          <div aria-label="A or B" className="tabs deck__switch" role="tablist">
            {panes.map((pane, index) => (
              <button
                aria-controls={`stage-panel-${index}`}
                aria-selected={activeIndex === index}
                className={activeIndex === index ? "is-active" : undefined}
                id={`stage-tab-${index}`}
                key={pane.id}
                onClick={() => select(index)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                ref={(node) => { tabRefs.current[index] = node; }}
                role="tab"
                tabIndex={activeIndex === index ? 0 : -1}
                type="button"
              >
                {pane.tabLabel}
              </button>
            ))}
          </div>
        ) : (
          <div className="deck__label">{barLabel}</div>
        )}
        <div className="deck__tools">
          {barExtra}
          <button
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-pressed={isFullscreen}
            className="deck__fs"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            type="button"
          >
            {isFullscreen ? (
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
            ) : (
              <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
            )}
          </button>
        </div>
      </div>

      <div className="deck__slot">
        <div
          className="deck__frame"
          data-testid="artifact-stage"
          onPointerDown={() => focusActiveFrame(activeIndex)}
        >
          {/* Panes stack in one grid cell. A pane's iframe is created only
              after that pane is selected, so a canvas does not boot hidden;
              once created it stays mounted so a switch never resets the run. */}
          {panes.map((pane, index) => {
            const hidden = activeIndex !== index;
            const live = started.has(pane.id);
            return (
              <div
                aria-hidden={hidden || undefined}
                aria-labelledby={panes.length > 1 ? `stage-tab-${index}` : undefined}
                className="deck__pane"
                data-inactive={hidden ? "true" : undefined}
                id={`stage-panel-${index}`}
                inert={hidden || undefined}
                key={pane.id}
                role={panes.length > 1 ? "tabpanel" : undefined}
              >
                {live ? (
                  <Frame
                    active={!hidden}
                    key={`${pane.id}:${retryKey[pane.id] ?? 0}`}
                    onReadyFocus={() => focusActiveFrame(index)}
                    onFrameElement={(frame) => rememberFrame(pane.id, frame)}
                    onRetry={() => retry(pane.id)}
                    onStatus={(next) => reportStatus(pane.id, next)}
                    pane={pane}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
