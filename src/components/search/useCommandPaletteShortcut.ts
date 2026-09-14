import { useEffect, type Dispatch, type SetStateAction } from "react";

export function useCommandPaletteShortcut(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape" && open) {
        // The shell listens before the lazy dialog mounts its own effects.
        setOpen(false);
      } else if (event.key === "/" && !open) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (
          !target?.isContentEditable &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")
        ) {
          event.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, open, setOpen]);
}
