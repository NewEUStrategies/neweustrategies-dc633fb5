// Auto-przydzial miejsc na sali - czysta, DETERMINISTYCZNA propozycja.
//
// PLANER PROPONUJE, BAZA ROZSTRZYGA. Wynik idzie do podgladu w dialogu, a po
// zatwierdzeniu do `admin_event_seat_assign_batch`, ktora sprawdza kazda
// pozycje jeszcze raz (rezerwacje, kategorie, zajetosc pod blokada planu).
// Pozycja odrzucona przez baze wraca do organizatora z kodem - planer nie
// udaje, ze jest jedynym arbitrem.
//
// REGULY (w tej kolejnosci):
//   1. Rezerwacje najpierw (`holdsFirst`): osoba firmy, dla ktorej trzymamy
//      miejsca (wprost albo przez sponsora - wolajacy podaje firme sponsora),
//      albo osoba z zamowienia pakietowego siada w SWOIM bloku.
//   2. Od przodu (`fill front`): wolne miejsca w kolejnosci sekcji i `sort_key`
//      (rzad * 1000 + pozycja), czyli od pierwszego rzedu, od lewej.
//   3. Zespoly razem (`keepTogether`): osoby jednego zapisu grupowego
//      (`party_key` = prowadzacy grupy) dostaja ciagly odcinek w JEDNYM rzedzie
//      albo przy jednym stole; gdy takiego odcinka nie ma - siadaja pojedynczo.
//      Zespoly jednej firmy ida po sobie, wiec koledzy laduja obok siebie.
//   4. Kategoria vs bilet: miejsce kategorii z lista biletow przyjmuje tylko te
//      bilety (reczny przydzial moze to obejsc przez `force`, planer nigdy).
//   5. Miejsca zarezerwowane dla innych, zablokowane i zajete sa nietykalne.
//
// DETERMINIZM: ta sama lista wejsciowa daje ten sam wynik - bez losowania i bez
// zaleznosci od kolejnosci obiektow w mapach (sortujemy jawnie).
import type { SeatingCandidateRow, SeatMapDetail, SeatStatus } from "@/lib/events/seatingApi";

export interface PlannerSeat {
  id: string;
  sectionId: string;
  sectionOrder: number;
  sortKey: number;
  status: SeatStatus;
  /** Kategoria EFEKTYWNA (nadpisanie miejsca albo kategoria sekcji). */
  categoryId: string | null;
  /** Firma rezerwujaca - wprost albo firma sponsora rezerwujacego. */
  holdCompanyId: string | null;
  holdPackageOrderId: string | null;
  occupied: boolean;
}

export interface PlannerCandidate {
  registrationId: string;
  partyKey: string;
  /** Klucz firmy do grupowania: identyfikator z CRM albo znormalizowany tekst. */
  companyKey: string | null;
  companyId: string | null;
  packageOrderId: string | null;
  ticketTypeId: string | null;
  seated: boolean;
}

export interface PlannerOptions {
  /** Kategoria -> dozwolone typy biletow (pusta lista = kazdy bilet). */
  categoryTickets: Readonly<Record<string, readonly string[]>>;
  keepTogether: boolean;
  holdsFirst: boolean;
  /** Ograniczenie do wybranych biletow; `null` = wszyscy. */
  ticketTypeIds: readonly string[] | null;
}

export type PlannerUnplacedReason = "no_seat" | "no_allowed_seat";

export interface PlannerProposal {
  seatId: string;
  registrationId: string;
}

export interface PlannerResult {
  proposals: PlannerProposal[];
  unplaced: { registrationId: string; reason: PlannerUnplacedReason }[];
}

/** Klucz firmy: identyfikator CRM wygrywa, potem tekst bez wielkosci liter i spacji. */
export function companyKeyOf(companyId: string | null, company: string | null): string | null {
  if (companyId !== null) return `id:${companyId}`;
  const normalized = (company ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalized === "" ? null : `text:${normalized}`;
}

function categoryAllows(
  options: PlannerOptions,
  seat: PlannerSeat,
  ticket: string | null,
): boolean {
  if (seat.categoryId === null) return true;
  const allowed = options.categoryTickets[seat.categoryId] ?? [];
  return allowed.length === 0 || (ticket !== null && allowed.includes(ticket));
}

function holdMatches(seat: PlannerSeat, candidate: PlannerCandidate): boolean {
  return (
    (seat.holdCompanyId !== null && seat.holdCompanyId === candidate.companyId) ||
    (seat.holdPackageOrderId !== null && seat.holdPackageOrderId === candidate.packageOrderId)
  );
}

/** Zespoly bez firmy na koniec - firmy nazwane siadaja razem od przodu. */
function compareCompany(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function rowOf(seat: PlannerSeat): string {
  return `${seat.sectionId}:${Math.floor(seat.sortKey / 1000)}`;
}

export function planSeating(
  seats: readonly PlannerSeat[],
  candidates: readonly PlannerCandidate[],
  options: PlannerOptions,
): PlannerResult {
  const ordered = [...seats].sort(
    (a, b) => a.sectionOrder - b.sectionOrder || a.sortKey - b.sortKey || a.id.localeCompare(b.id),
  );
  const free = ordered.filter((seat) => !seat.occupied && seat.status !== "blocked");
  const taken = new Set<string>();
  const proposals: PlannerProposal[] = [];
  const unplaced: PlannerResult["unplaced"] = [];

  const pending = candidates.filter(
    (candidate) =>
      !candidate.seated &&
      (options.ticketTypeIds === null ||
        (candidate.ticketTypeId !== null &&
          options.ticketTypeIds.includes(candidate.ticketTypeId))),
  );

  // Zespoly: po `party_key` (albo pojedynczo), potem jawne sortowanie po firmie.
  const clusters = new Map<string, PlannerCandidate[]>();
  for (const candidate of pending) {
    const key = options.keepTogether ? candidate.partyKey : candidate.registrationId;
    const members = clusters.get(key);
    if (members === undefined) clusters.set(key, [candidate]);
    else members.push(candidate);
  }
  const clusterList = [...clusters.entries()]
    .map(([key, members]) => ({ key, members, company: members[0].companyKey }))
    .sort((a, b) => compareCompany(a.company, b.company) || a.key.localeCompare(b.key));

  const place = (seat: PlannerSeat, candidate: PlannerCandidate) => {
    taken.add(seat.id);
    proposals.push({ seatId: seat.id, registrationId: candidate.registrationId });
  };

  const openFor = (candidate: PlannerCandidate, held: boolean) =>
    free.filter(
      (seat) =>
        !taken.has(seat.id) &&
        (held
          ? seat.status === "held" && holdMatches(seat, candidate)
          : seat.status === "available") &&
        categoryAllows(options, seat, candidate.ticketTypeId),
    );

  for (const cluster of clusterList) {
    let rest = cluster.members;

    if (options.holdsFirst) {
      const left: PlannerCandidate[] = [];
      for (const member of rest) {
        const seat = openFor(member, true)[0];
        if (seat === undefined) left.push(member);
        else place(seat, member);
      }
      rest = left;
    }

    if (options.keepTogether && rest.length > 1) {
      const run = findRun(free, taken, rest, options);
      if (run !== null) {
        run.forEach((seat, index) => place(seat, rest[index]));
        rest = [];
      }
    }

    for (const member of rest) {
      const seat = openFor(member, false)[0];
      if (seat !== undefined) {
        place(seat, member);
        continue;
      }
      const anyAllowed = ordered.some(
        (candidateSeat) =>
          candidateSeat.status === "available" &&
          categoryAllows(options, candidateSeat, member.ticketTypeId),
      );
      unplaced.push({
        registrationId: member.registrationId,
        reason: anyAllowed ? "no_seat" : "no_allowed_seat",
      });
    }
  }

  return { proposals, unplaced };
}

/** Pierwszy ciagly odcinek wolnych miejsc w jednym rzedzie/stole dla calego zespolu. */
function findRun(
  free: readonly PlannerSeat[],
  taken: ReadonlySet<string>,
  members: readonly PlannerCandidate[],
  options: PlannerOptions,
): PlannerSeat[] | null {
  const open = free.filter((seat) => !taken.has(seat.id) && seat.status === "available");
  for (let start = 0; start + members.length <= open.length; start += 1) {
    const run = open.slice(start, start + members.length);
    const contiguous = run.every(
      (seat, index) =>
        index === 0 ||
        (rowOf(seat) === rowOf(run[index - 1]) && seat.sortKey === run[index - 1].sortKey + 1),
    );
    if (!contiguous) continue;
    if (run.every((seat, index) => categoryAllows(options, seat, members[index].ticketTypeId))) {
      return run;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// WEJSCIE PLANERA Z DANYCH PANELU
// ---------------------------------------------------------------------------

/**
 * Miejsca planu w ksztalcie planera. Kategoria EFEKTYWNA (miejsce albo sekcja),
 * a rezerwacja sponsora zamieniona na jego firme - planer porownuje firmy,
 * nie identyfikatory sponsorow.
 */
export function plannerSeatsFromDetail(
  detail: SeatMapDetail,
  sponsorCompanyById: ReadonlyMap<string, string>,
): PlannerSeat[] {
  const occupied = new Set(detail.assignments.map((assignment) => assignment.seatId));
  return detail.sections.flatMap((section, sectionOrder) =>
    detail.seats
      .filter((seat) => seat.sectionId === section.id)
      .map((seat) => ({
        id: seat.id,
        sectionId: seat.sectionId,
        sectionOrder,
        sortKey: seat.sortKey,
        status: seat.status,
        categoryId: seat.categoryId ?? section.categoryId,
        holdCompanyId:
          seat.holdCompanyId ??
          (seat.holdSponsorId === null
            ? null
            : (sponsorCompanyById.get(seat.holdSponsorId) ?? null)),
        holdPackageOrderId: seat.holdPackageOrderId,
        occupied: occupied.has(seat.id),
      })),
  );
}

/** Kandydaci z RPC w ksztalcie planera. */
export function plannerCandidatesFromRows(
  rows: readonly SeatingCandidateRow[],
): PlannerCandidate[] {
  return rows.map((row) => ({
    registrationId: row.registration_id,
    partyKey: row.party_key,
    companyKey: companyKeyOf(row.company_id, row.company),
    companyId: row.company_id,
    packageOrderId: row.package_order_id,
    ticketTypeId: row.ticket_type_id,
    seated: row.seat_id !== null,
  }));
}

/** Kategoria -> dozwolone bilety, z listy kategorii szczegolu planu. */
export function categoryTicketsOf(detail: SeatMapDetail): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const category of detail.categories) out[category.id] = category.ticketTypeIds;
  return out;
}
