// Przeciagnij-i-upusc uczestnika na miejsce planu sali - rozstrzygniecie celu.
//
// JEDEN CEL UPUSZCZENIA NA CALE PLOTNO (`SEAT_CANVAS_DROP_ID`), a konkretne
// miejsce wskazuje element SVG pod wskaznikiem w chwili puszczenia
// (`data-seat-id`). Po jednym `useDroppable` na krzeslo dawaloby tysiace
// obserwatorow kolizji przy kazdym ruchu myszy.
//
// Punkt puszczenia = punkt chwycenia + przesuniecie z dnd-kit; bez wspolrzednych
// wskaznika (zdarzenie klawiatury) nie zgadujemy miejsca - klawiatura ma swoja,
// jawna droge ("Wskaz miejsce" + Enter na plotnie).

/** Minimalny ksztalt `DragEndEvent`, ktory czytamy - bez zaleznosci od dnd-kit. */
export interface SeatDropEvent {
  over: { id: string | number } | null;
  delta: { x: number; y: number };
  activatorEvent: Event;
  active: { data: { current?: Record<string, unknown> | undefined } };
}

export interface SeatDropTarget {
  seatId: string;
  registrationId: string;
  name: string;
}

export function seatDropTarget(
  event: SeatDropEvent,
  canvasId: string,
  doc: Pick<Document, "elementFromPoint">,
): SeatDropTarget | null {
  if (event.over === null || event.over.id !== canvasId) return null;
  const data = event.active.data.current ?? {};
  const registrationId = typeof data.registrationId === "string" ? data.registrationId : null;
  if (registrationId === null) return null;
  const start = event.activatorEvent as Partial<MouseEvent>;
  if (typeof start.clientX !== "number" || typeof start.clientY !== "number") return null;
  const element = doc.elementFromPoint(
    start.clientX + event.delta.x,
    start.clientY + event.delta.y,
  );
  const seatId = element?.closest("[data-seat-id]")?.getAttribute("data-seat-id") ?? null;
  if (seatId === null) return null;
  return { seatId, registrationId, name: typeof data.name === "string" ? data.name : "" };
}
