import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

/**
 * Globalny skrót palety poleceń (Cmd/Ctrl+K, `/`, Escape).
 *
 * `open` i `setOpen` trzymamy w REFERENCJACH, a efekt zależy wyłącznie od
 * `enabled`. Wcześniej `open` siedziało w zależnościach, więc KAŻDE otwarcie i
 * zamknięcie palety zdejmowało i zakładało od nowa nasłuch `keydown` na oknie
 * - praca w oknie mierzonym jako INP tego właśnie naciśnięcia. `setOpen` też
 * nie ma prawa przepinać nasłuchu: `CommandPalette` podaje tu albo setter
 * Reacta, albo `onOpenChange` z propsów, który wołający może tworzyć na nowo
 * przy każdym renderze.
 */
export function useCommandPaletteShortcut(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
  enabled = true,
) {
  const openRef = useRef(open);
  openRef.current = open;
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const isOpen = openRef.current;
      const set = setOpenRef.current;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        set((value) => !value);
      } else if (event.key === "Escape" && isOpen) {
        // The shell listens before the lazy dialog mounts its own effects.
        set(false);
      } else if (event.key === "/" && !isOpen) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (
          !target?.isContentEditable &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")
        ) {
          event.preventDefault();
          set(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
