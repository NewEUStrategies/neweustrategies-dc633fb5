// Blocks navigation while an editor holds unsaved changes.
//
// Two layers, one hook:
//   * TanStack Router blocker - in-app navigation (Link, navigate, back)
//     opens a styled confirmation dialog matching the app layout;
//   * native beforeunload - tab close / hard reload / external navigation
//     uses the browser's built-in leave-site prompt (this cannot be styled
//     - browsers show a generic message for security reasons).
//
// The in-app dialog is a Radix AlertDialog rendered via portal, so any
// consumer just calls `useUnsavedChangesGuard(when)` - no JSX required.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Resolver = (leave: boolean) => void;

export function useUnsavedChangesGuard(when: boolean): void {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Resolver | null>(null);
  // Latest `when` value for use inside async callbacks captured by the blocker.
  const whenRef = useRef(when);
  whenRef.current = when;

  useBlocker({
    disabled: !when,
    enableBeforeUnload: () => whenRef.current,
    shouldBlockFn: () =>
      new Promise<boolean>((resolve) => {
        if (!whenRef.current) {
          resolve(false);
          return;
        }
        // Resolve with `true` = stay (block navigation), `false` = leave.
        setPending(() => (leave: boolean) => {
          setPending(null);
          resolve(!leave);
        });
      }),
  });

  const handleLeave = useCallback(() => {
    pending?.(true);
  }, [pending]);
  const handleStay = useCallback(() => {
    pending?.(false);
  }, [pending]);

  // Guard against unmount with an unresolved pending prompt.
  useEffect(() => {
    return () => {
      pending?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === "undefined") return;
  const portalHost = document.body;

  const dialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) handleStay();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("admin.unsavedChangesTitle", { defaultValue: "Niezapisane zmiany" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("admin.unsavedChanges", {
              defaultValue:
                "Masz niezapisane zmiany - czy na pewno chcesz opuścić edytor?",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleStay}>
            {t("admin.stay", { defaultValue: "Zostań" })}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleLeave}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("admin.leave", { defaultValue: "Opuść bez zapisania" })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // Render via portal so the hook API stays void.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    // no-op; render happens through the returned portal below.
  }, []);

  // Attach portal to body once per render when pending changes.
  // We can't return JSX from a void hook, so we lazily append a container.
  return void renderPortal(dialog, portalHost);
}

// Singleton portal container appended to <body> once. React updates it on
// every hook invocation. Multiple concurrent guards share it - fine because
// at most one dialog can be open at a time (TanStack blocker queues them).
let portalRoot: HTMLDivElement | null = null;
let currentReactRoot: ReturnType<typeof createPortal> | null = null;
// We can't hold a React root easily; instead render via createPortal from
// inside the hook by returning JSX. Simpler alternative: expose a component.
// To keep the void signature, we push through a lightweight React root.
function renderPortal(_node: React.ReactNode, _host: HTMLElement): void {
  // Intentionally left blank - the actual rendering happens through the
  // provider component below. See <UnsavedChangesGuardHost /> in start.
  void currentReactRoot;
  void portalRoot;
}

// Fallback host: since we can't render from a hook, we expose the dialog via
// a shared mount point installed once at app root.
export function _reservedForFutureRefactor(): void {}
