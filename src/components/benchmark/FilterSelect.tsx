import { useEffect, useRef, useState } from "react";

/**
 * One filter dimension as a dropdown of checkboxes, shared by the chart and
 * the build table so filtering feels identical everywhere. The trigger names
 * the dimension and, when narrowed, how many values are selected — the list
 * itself scales to any roster because it scrolls instead of wrapping.
 * Professional dropdown manners are handled here once: a click outside or
 * Escape closes the menu, and Escape hands focus back to the trigger.
 */
export interface FilterSelectOption {
  value: string;
  label: string;
}

export function FilterSelect({ label, options, selected, onToggle }: {
  label: string;
  options: Array<string | FilterSelectOption>;
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
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
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={open ? "select select--open" : "select"} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className="select__trigger"
        onClick={() => setOpen(!open)}
        ref={triggerRef}
        type="button"
      >
        {label}
        {selected.size > 0 ? <span className="select__count">{selected.size}</span> : null}
      </button>
      {open ? (
        <div className="select__menu">
          {options.map((option) => {
            const value = typeof option === "string" ? option : option.value;
            const optionLabel = typeof option === "string" ? option : option.label;
            return (
            <label className="select__option" key={value}>
              <input
                checked={selected.has(value)}
                onChange={() => onToggle(value)}
                type="checkbox"
              />
              {optionLabel}
            </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Toggle one value in a read-only selection set; an empty set means "no filter". */
export function toggleFilter(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
