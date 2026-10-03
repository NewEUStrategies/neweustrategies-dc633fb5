// WSKAŹNIK OBECNOŚCI - kto teraz ogląda tę encję (lead, wpis, rozmowa).
//
// CO DOWODZI TEN PLIK. Molekuła stała na zerze. Niesie trzy kontrakty:
//   * pusty pokój nie rysuje NIC (ani pustej ramki, ani „0 osób");
//   * liczba i nazwiska idą do etykiety dostępnej i do dymka - czytnik
//     ekranu dostaje zdanie, a nie stos bezimiennych kółek;
//   * odmiana liczby idzie ze słownika (PL ma cztery formy, EN dwie).
// Hook obecności jest atrapą (kanał realtime ma własne testy w `lib/realtime`);
// `AvatarGroup` i słownik `i18n-cohesion` są prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EntityPresencePeer } from "@/lib/realtime/useEntityPresence";

const h = vi.hoisted(() => ({
  peers: [] as EntityPresencePeer[],
  calls: [] as Array<[string, string | null | undefined]>,
}));

vi.mock("@/lib/realtime/useEntityPresence", () => ({
  useEntityPresence: (type: string, id: string | null | undefined) => {
    h.calls.push([type, id]);
    return h.peers;
  },
}));

import i18n from "@/lib/i18n";
import "@/lib/i18n-cohesion";
import { PresenceIndicator } from "../PresenceIndicator";

const peer = (userId: string, name: string): EntityPresencePeer => ({
  userId,
  name,
  sinceIso: "2026-03-01T10:00:00Z",
});

beforeEach(async () => {
  h.peers = [];
  h.calls.length = 0;
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

describe("PresenceIndicator", () => {
  it("pusty pokój nie rysuje niczego", () => {
    const { container } = render(<PresenceIndicator entityType="crm_lead" entityId="lead-1" />);
    expect(container.firstChild).toBeNull();
    expect(h.calls.at(-1)).toEqual(["crm_lead", "lead-1"]);
  });

  it("dwie osoby: polska odmiana, nazwiska w dymku i etykieta stosu", () => {
    h.peers = [peer("u1", "Anna"), peer("u2", "Bartek")];
    const { container } = render(<PresenceIndicator entityType="post" entityId="p1" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("title")).toBe("Tu teraz: Anna, Bartek");
    expect(screen.getAllByText("2 osoby przeglądają teraz ten element").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("2 osoby przeglądają teraz ten element")).toBeTruthy();
  });

  it("pięć osób: forma „osób”", () => {
    h.peers = ["a", "b", "c", "d", "e"].map((id) => peer(id, id.toUpperCase()));
    render(<PresenceIndicator entityType="page" entityId="pg" maxAvatars={2} />);
    expect(screen.getByLabelText("5 osób przegląda teraz ten element")).toBeTruthy();
  });

  it("po angielsku liczba pojedyncza i mnoga ze słownika EN", async () => {
    await i18n.changeLanguage("en");
    h.peers = [peer("u1", "Anna")];
    const { rerender } = render(<PresenceIndicator entityType="post" entityId="p1" />);
    expect(screen.getByLabelText("1 person is viewing this item right now")).toBeTruthy();
    h.peers = [peer("u1", "Anna"), peer("u2", "Ben")];
    rerender(<PresenceIndicator entityType="post" entityId="p1" />);
    expect(screen.getByLabelText("2 people are viewing this item right now")).toBeTruthy();
  });
});
