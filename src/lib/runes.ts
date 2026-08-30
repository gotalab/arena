export const RUNES_PROVENANCE = {
  package: "runes-icons",
  version: "0.2.0",
  commit: "35e39b6084df60181133c40a04f2da4bc6c16014",
  subsetSha256: "2e77a1c83a0742885aedeb85affeca855bd89a286ba541385558afd545c50bf4",
} as const;

export const RUNES_UI_ALLOWLIST = [
  "menu",
  "close",
  "back",
  "previous",
  "next",
  "play",
  "share",
  "copy",
] as const;

export const RUNES_METHOD_ALLOWLIST = [
  "task",
  "configuration",
  "trial",
  "artifact",
  "evaluation",
  "evidence",
  "result",
] as const;

type RuneNode = readonly [
  "path" | "circle" | "line" | "rect" | "polyline",
  Readonly<Record<string, string | number>>,
  ("primary" | "secondary" | "tertiary")?,
];

interface RuneDefinition {
  sourceSlug: string;
  nodes: readonly RuneNode[];
}

/**
 * Generated monochrome subset from the pinned Runes revision above. Arena has
 * no runtime, package, checkout, or symlink dependency on the sibling repo.
 */
export const arenaRunes = {
  menu: {
    sourceSlug: "menu",
    nodes: [
      ["line", { x1: 5, y1: 7, x2: 19, y2: 7 }],
      ["line", { x1: 5, y1: 12, x2: 19, y2: 12 }],
      ["line", { x1: 5, y1: 17, x2: 19, y2: 17 }],
      ["path", { d: "m2.5 12 .75-.75.75.75-.75.75Z" }],
    ],
  },
  close: {
    sourceSlug: "x",
    nodes: [
      ["line", { x1: 6, y1: 6, x2: 18, y2: 18 }],
      ["line", { x1: 18, y1: 6, x2: 6, y2: 18 }],
    ],
  },
  back: {
    sourceSlug: "arrow-left",
    nodes: [
      ["path", { d: "M19 12H5" }],
      ["polyline", { points: "10 7 5 12 10 17" }],
    ],
  },
  previous: { sourceSlug: "chevron-left", nodes: [["polyline", { points: "15 6 9 12 15 18" }]] },
  next: { sourceSlug: "chevron-right", nodes: [["polyline", { points: "9 6 15 12 9 18" }]] },
  play: { sourceSlug: "play", nodes: [["path", { d: "M8 5 19 12 8 19Z" }]] },
  share: {
    sourceSlug: "share",
    nodes: [
      ["circle", { cx: 5, cy: 12, r: 1.5 }],
      ["circle", { cx: 18, cy: 6, r: 1.5 }],
      ["circle", { cx: 18, cy: 18, r: 1.5 }],
      ["line", { x1: 6.5, y1: 11.3, x2: 16.5, y2: 6.7 }],
      ["line", { x1: 6.5, y1: 12.7, x2: 16.5, y2: 17.3 }],
    ],
  },
  copy: {
    sourceSlug: "copy",
    nodes: [
      ["rect", { x: 8, y: 8, width: 12, height: 12, rx: 2 }],
      ["path", { d: "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h.5" }],
    ],
  },
  task: {
    sourceSlug: "instruction",
    nodes: [
      ["rect", { x: 4, y: 3, width: 16, height: 18, rx: 2 }],
      ["path", { d: "m12 5 2 2-2 2-2-2 2-2Z" }],
      ["line", { x1: 8, y1: 12, x2: 16, y2: 12 }],
      ["line", { x1: 8, y1: 15, x2: 16, y2: 15 }],
      ["line", { x1: 8, y1: 18, x2: 13, y2: 18 }],
    ],
  },
  configuration: {
    sourceSlug: "settings",
    nodes: [
      ["path", { d: "M9.283 5.440L9.982 2.973L14.018 2.973L14.717 5.440L14.717 5.440L16.956 4.190L19.810 7.044L18.560 9.283L18.560 9.283L21.027 9.982L21.027 14.018L18.560 14.717L18.560 14.717L19.810 16.956L16.956 19.810L14.717 18.560L14.717 18.560L14.018 21.027L9.982 21.027L9.283 18.560L9.283 18.560L7.044 19.810L4.190 16.956L5.440 14.717L5.440 14.717L2.973 14.018L2.973 9.982L5.440 9.283L5.440 9.283L4.190 7.044L7.044 4.190L9.283 5.440Z" }],
      ["path", { d: "M12 8.75 15.25 12 12 15.25 8.75 12Z" }],
    ],
  },
  trial: {
    sourceSlug: "eval-case",
    nodes: [
      ["rect", { x: 4, y: 4, width: 16, height: 16, rx: 2 }, "secondary"],
      ["circle", { cx: 8, cy: 12, r: 1.25 }],
      ["line", { x1: 10.5, y1: 12, x2: 13, y2: 12 }],
      ["path", { d: "M15.75 10.5 17.25 12 15.75 13.5 14.25 12Z" }],
    ],
  },
  artifact: {
    sourceSlug: "artifact",
    nodes: [
      ["path", { d: "m5 19 7.5-7.5" }],
      ["path", { d: "m13 7 2-4 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" }],
      ["path", { d: "M4 20 2.5 18.5 5 16l3 3-2.5 2.5Z" }],
    ],
  },
  evaluation: {
    sourceSlug: "evaluate",
    nodes: [
      ["circle", { cx: 10, cy: 10, r: 6 }],
      ["line", { x1: 14.5, y1: 14.5, x2: 20.5, y2: 20.5 }],
      ["path", { d: "m7 10 2 2 4-4" }],
    ],
  },
  evidence: {
    sourceSlug: "evidence",
    nodes: [
      ["path", { d: "M5 2.5h9l5 5v14H5Z" }],
      ["path", { d: "M14 2.5v5h5" }],
      ["circle", { cx: 12, cy: 14, r: 3 }],
      ["path", { d: "m10.5 14 1 1 2-2" }],
    ],
  },
  result: {
    sourceSlug: "pass-fail",
    nodes: [
      ["circle", { cx: 12, cy: 12, r: 9 }, "secondary"],
      ["line", { x1: 12, y1: 6, x2: 12, y2: 18 }, "secondary"],
      ["polyline", { points: "5.75 12 7.25 13.5 9.25 10" }],
      ["path", { d: "M14.75 9.75l3 4.5M17.75 9.75l-3 4.5" }],
    ],
  },
} as const satisfies Record<string, RuneDefinition>;

export type ArenaIconName = keyof typeof arenaRunes;
