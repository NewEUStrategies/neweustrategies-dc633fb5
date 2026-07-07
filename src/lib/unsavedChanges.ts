// Global store for the unsaved-changes leave-confirmation dialog.
// The blocker hook calls `requestLeaveConfirmation()` which returns a
// promise resolved when the user picks an option in the shared dialog
// rendered by <UnsavedChangesGuardHost /> (mounted once at app root).
//
// Using a module-level store keeps `useUnsavedChangesGuard` a void hook
// (drop-in replacement for the previous window.confirm() version) while
// letting the dialog live in the React tree with full app styling.

type Resolver = (leave: boolean) => void;

type State = {
  pending: Resolver | null;
};

const state: State = { pending: null };
const listeners = new Set<(pending: Resolver | null) => void>();

function emit() {
  for (const l of listeners) l(state.pending);
}

/** Called by consumers/host to subscribe to pending prompt state. */
export function subscribeLeaveConfirmation(cb: (pending: Resolver | null) => void): () => void {
  listeners.add(cb);
  cb(state.pending);
  return () => {
    listeners.delete(cb);
  };
}

/** Called by useUnsavedChangesGuard when TanStack blocker fires. */
export function requestLeaveConfirmation(): Promise<boolean> {
  // If a prompt is already pending (rare - two blockers racing), reject the
  // previous one as "stay" so we do not leak resolvers.
  if (state.pending) {
    state.pending(false);
    state.pending = null;
  }
  return new Promise<boolean>((resolve) => {
    state.pending = (leave: boolean) => {
      state.pending = null;
      emit();
      resolve(leave);
    };
    emit();
  });
}

/** Manual resolver used by the host dialog buttons. */
export function resolveLeaveConfirmation(leave: boolean): void {
  state.pending?.(leave);
}
