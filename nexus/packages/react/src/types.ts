import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

/* ============================================================================
   @nexus/react — types
   ========================================================================== */

export type GlyphShape = "circle" | "hexagon" | "diamond" | "ring" | "square" | "triangle";
export type Corner = "tl" | "tr" | "bl" | "br";

/** A CSS colour. Prefer `tone()` from @nexus/tokens over a literal. */
export type Colour = string;

export interface PaletteItem {
  id: string | number;
  label: string;
  /** Short class code shown on the right of a result row. */
  code?: string;
  shape?: GlyphShape;
  colour?: Colour;
  /** Tie-breaker when text scores match. Higher sorts first. */
  weight?: number;
}

export interface LegendGroup {
  title: string;
  rows: React.ReactNode;
}

/* ============================================================================
   HOOKS
   ========================================================================== */

/**
 * Marks every DOM branch outside `dialogNode`'s own ancestor chain (up to
 * but not including `<body>`) as `aria-hidden` + `inert`, walking one
 * parent at a time so only true siblings of that chain — never the chain
 * itself — get hidden. A focus trap alone stops `Tab` from *leaving* the
 * dialog, but a screen reader's browse mode ignores tab order entirely and
 * can still read/activate background content unless it's actually hidden
 * from the accessibility tree. Returns the exact restorer: each node gets
 * back whichever aria-hidden/inert state it actually had before, not a
 * blanket "remove everything."
 */
function hideOthers(dialogNode: Element): () => void {
  const restore: Array<() => void> = [];
  let node: Element | null = dialogNode;

  while (node && node !== document.body) {
    const parent: Element | null = node.parentElement;
    if (parent) {
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node) continue;
        const el = sibling as HTMLElement;
        const hadAriaHidden = el.getAttribute("aria-hidden");
        const hadInert = el.inert;
        el.setAttribute("aria-hidden", "true");
        el.inert = true;
        restore.push(() => {
          if (hadAriaHidden === null) el.removeAttribute("aria-hidden");
          else el.setAttribute("aria-hidden", hadAriaHidden);
          el.inert = hadInert;
        });
      }
    }
    node = parent;
  }

  return () => restore.forEach((fn) => fn());
}

/**
 * Focus trap, focus restoration and Escape dismissal for a modal surface —
 * optionally background hiding too, for a surface that actually blocks the
 * rest of the page rather than docking alongside it (see `hideBackground`).
 *
 * This is the single most-often-botched part of a design system, so both
 * Drawer and CommandPalette share this one implementation rather than each
 * growing their own. Returns a ref to spread onto the modal container.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  onDismiss?: () => void,
  // Off by default: Drawer is a docked side panel, deliberately built to let
  // the surface behind it (the graph canvas, its own dock) stay clickable
  // while it's open (Nexus's DetailsDrawer, e.g., stays open across
  // consecutive node selections) — inert-ing that surface would silently
  // break every click that isn't on the drawer itself. CommandPalette is a
  // true full-screen modal (a scrim over everything, nothing meant to stay
  // reachable underneath) and opts in explicitly.
  hideBackground = false,
): RefObject<T> {
  const ref = useRef<T>(null);
  const restoreTo = useRef<Element | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return undefined;
    restoreTo.current = document.activeElement;

    const node = ref.current;
    const SEL =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
      'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    const focusables = (): HTMLElement[] =>
      Array.from(node?.querySelectorAll<HTMLElement>(SEL) ?? [])
        .filter((el) => el.offsetParent !== null);

    (focusables()[0] ?? node)?.focus?.();

    const unhideOthers = hideBackground && node ? hideOthers(node) : undefined;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismissRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) { e.preventDefault(); return; }
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        list[list.length - 1]?.focus();
      } else if (!e.shiftKey && i === list.length - 1) {
        e.preventDefault();
        list[0]?.focus();
      }
    };

    node?.addEventListener("keydown", onKey);
    return () => {
      node?.removeEventListener("keydown", onKey);
      unhideOthers?.();
      const el = restoreTo.current as HTMLElement | null;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, [active, hideBackground]);

  return ref;
}

/**
 * Global shortcut. `"mod+k"` maps to Cmd on macOS and Ctrl elsewhere.
 * Unmodified keys are ignored while the user is typing in a field, so `/`
 * can open a palette without hijacking every text input on the page.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void): void {
  const cb = useCallback(handler, [handler]);

  useEffect(() => {
    const parts = combo.toLowerCase().split("+");
    const key = parts[parts.length - 1] ?? "";
    const wantMod = parts.includes("mod");
    const wantShift = parts.includes("shift");

    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (wantMod !== mod) return;
      if (wantShift !== e.shiftKey) return;
      if (typing) return;
      if (e.key.toLowerCase() !== key) return;
      e.preventDefault();
      cb(e);
    };

    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [combo, cb]);
}

/**
 * Ranked search. Deliberately not fuzzy: in a structured corpus you usually
 * know the beginning of what you want, and fuzzy matching mostly produces
 * confident nonsense. Order: exact, prefix, word-start, contains, code.
 */
export function rankItems<T extends PaletteItem>(items: readonly T[], query: string, limit = 40): T[] {
  const needle = query.trim().toLowerCase();
  const scored: Array<[number, T]> = [];

  for (const it of items) {
    const name = String(it.label).toLowerCase();
    let score: number;
    if (!needle) score = 40;
    else if (name === needle) score = 100;
    else if (name.startsWith(needle)) score = 80;
    else if (name.includes(`_${needle}`) || name.includes(`#${needle}`) || name.includes(` ${needle}`)) score = 65;
    else if (name.includes(needle)) score = 50;
    else if (String(it.code ?? "").toLowerCase().startsWith(needle)) score = 45;
    else continue;
    scored.push([score * 1000 + (it.weight ?? 0), it]);
  }

  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, it]) => it);
}
