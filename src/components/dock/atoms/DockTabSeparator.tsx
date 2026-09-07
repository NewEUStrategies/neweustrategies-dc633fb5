// Atom: pionowy separator 6px od grup zakładek (jak w rozwijanych zakładkach).
//
// Wyciągnięty z `WorkspaceDock.tsx` razem z pozostałymi warstwami paska.
// `aria-hidden`, bo to znak podziału wizualnego - hierarchię dla czytnika
// ekranu niosą etykiety obu grup (`nav aria-label` i `role="toolbar"`),
// a nie ta kreska.
export function DockTabSeparator() {
  return <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-border/80" />;
}
