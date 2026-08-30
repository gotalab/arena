import { createElement } from "react";
import { arenaRunes, type ArenaIconName } from "../lib/runes";

interface ArenaIconProps {
  className?: string;
  name: ArenaIconName;
  size?: number;
  strokeWidth?: number;
  title?: string;
}

export function ArenaIcon({ className, name, size = 20, strokeWidth = 1.25, title }: ArenaIconProps) {
  const icon = arenaRunes[name];
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={className}
      fill="none"
      focusable="false"
      height={size}
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {title ? <title>{title}</title> : null}
      {icon.nodes.map(([tag, props], index) => createElement(tag, { ...props, key: index }))}
    </svg>
  );
}
