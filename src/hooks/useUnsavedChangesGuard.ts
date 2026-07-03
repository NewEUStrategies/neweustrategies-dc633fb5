// Blocks navigation while an editor holds unsaved changes.
//
// Two layers, one hook:
//   * TanStack Router blocker - in-app navigation (Link, navigate, back)
//     asks for confirmation while `when` is true;
//   * native beforeunload - tab close / hard reload / external navigation
//     shows the browser's leave-site prompt.
//
// Pair it with useAutosave's `isDirty`: the prompt only appears in the
// window between the last edit and the debounced save completing.
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function useUnsavedChangesGuard(when: boolean): void {
  const { t } = useTranslation();
  useBlocker({
    disabled: !when,
    enableBeforeUnload: () => when,
    shouldBlockFn: () => {
      if (!when) return false;
      if (typeof window === "undefined") return false;
      const stay = !window.confirm(t("admin.unsavedChanges"));
      return stay;
    },
  });
}
