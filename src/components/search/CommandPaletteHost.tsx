import { lazy, Suspense, useState } from "react";
import { useCommandPaletteShortcut } from "./useCommandPaletteShortcut";

const CommandPalette = lazy(() =>
  import("./CommandPalette").then((m) => ({ default: m.CommandPalette })),
);

export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  useCommandPaletteShortcut(open, setOpen);
  return open ? (
    <Suspense fallback={null}>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </Suspense>
  ) : null;
}
