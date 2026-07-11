// Global store for app-styled confirm/prompt dialogs - the drop-in
// replacement for native window.confirm()/window.prompt(). Same pattern as
// lib/unsavedChanges.ts: callers await a promise, the dialog itself is
// rendered once by <AppDialogHost /> (mounted in __root.tsx) with full app
// styling, focus management and keyboard support.

export type ConfirmDialogRequest = {
  kind: "confirm";
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red). */
  destructive?: boolean;
};

export type PromptDialogRequest = {
  kind: "prompt";
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type DialogRequest = ConfirmDialogRequest | PromptDialogRequest;

export type PendingDialog = {
  request: DialogRequest;
  /** confirm: boolean; prompt: string | null (null = cancelled). */
  resolve: (value: boolean | string | null) => void;
};

let pending: PendingDialog | null = null;
const listeners = new Set<(p: PendingDialog | null) => void>();

function emit(): void {
  for (const l of listeners) l(pending);
}

export function subscribeAppDialog(cb: (p: PendingDialog | null) => void): () => void {
  listeners.add(cb);
  cb(pending);
  return () => {
    listeners.delete(cb);
  };
}

function request(req: DialogRequest): Promise<boolean | string | null> {
  // Two dialogs racing is a caller bug; resolve the older one as cancelled
  // instead of leaking its resolver.
  if (pending) {
    const prev = pending;
    pending = null;
    prev.resolve(prev.request.kind === "confirm" ? false : null);
  }
  return new Promise((resolve) => {
    pending = {
      request: req,
      resolve: (value) => {
        pending = null;
        emit();
        resolve(value);
      },
    };
    emit();
  });
}

/** App-styled confirm; resolves true when the user confirms. */
export function confirmDialog(opts: Omit<ConfirmDialogRequest, "kind">): Promise<boolean> {
  return request({ kind: "confirm", ...opts }) as Promise<boolean>;
}

/** App-styled prompt; resolves the entered string, or null when cancelled. */
export function promptDialog(opts: Omit<PromptDialogRequest, "kind">): Promise<string | null> {
  return request({ kind: "prompt", ...opts }) as Promise<string | null>;
}
