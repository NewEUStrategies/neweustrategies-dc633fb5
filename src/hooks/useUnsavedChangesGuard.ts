// Blocks navigation while an editor holds unsaved changes.
//
// Two layers, one hook:
//   * TanStack Router blocker - in-app navigation (Link, navigate, back)
//     opens the styled confirmation dialog rendered by
//     <UnsavedChangesGuardHost /> (mounted once in __root.tsx);
//   * native beforeunload - tab close / hard reload / external navigation
//     uses the browser's built-in leave-site prompt (browsers intentionally
//     render a generic non-styleable message here for security reasons).
//
// The in-app dialog matches the app design system (Radix AlertDialog +
// design tokens) instead of the previous window.confirm().
import { useBlocker } from "@tanstack/react-router";
import { useRef } from "react";
import { requestLeaveConfirmation } from "@/lib/unsavedChanges";

export function useUnsavedChangesGuard(when: boolean): void {
  // Latest `when` inside async blocker callbacks.
  const whenRef = useRef(when);
  whenRef.current = when;

  useBlocker({
    disabled: !when,
    enableBeforeUnload: () => whenRef.current,
    shouldBlockFn: async () => {
      if (!whenRef.current) return false;
      // Dialog resolves with `leave=true` when user chose to discard.
      const leave = await requestLeaveConfirmation();
      // Returning `true` blocks navigation ("stay").
      return !leave;
    },
  });
}
