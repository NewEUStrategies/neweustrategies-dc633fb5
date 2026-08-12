// K1 (stored XSS w eksporcie PDF osi czasu) + K4 (kontrakt payloadu osi czasu).
//
// Dokument wydruku trafia do `document.write` w nowym oknie sesji admina, a
// imię/nazwisko/e-mail leada pochodzą z publicznego formularza kontaktowego.
// Ładunek w danych NIE MOŻE stać się węzłem DOM w tym dokumencie.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildLeadTimelineHtml,
  leadTimelineDisplayName,
  parseLeadTimelinePayload,
  type LeadTimelineEvent,
} from "../leadTimeline";

const XSS = '<img src=x onerror="alert(1)">';
const LABELS = { submit: "Zgłoszenie", consent: "Zgoda" };

const event = (over: Partial<LeadTimelineEvent> = {}): LeadTimelineEvent => ({
  id: "msg:1",
  type: "submit",
  at: "2026-08-01T10:00:00.000Z",
  title: "Formularz kontaktowy",
  detail: null,
  meta: null,
  ...over,
});

const parse = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html") as unknown as Document;

describe("buildLeadTimelineHtml - escapowanie danych leada", () => {
  it("nie wpuszcza znaczników z imienia i e-maila do DOM wydruku", () => {
    const html = buildLeadTimelineHtml({
      lead: { first_name: XSS, last_name: null, email: `${XSS}@example.com` },
      events: [event()],
      typeLabels: LABELS,
      now: new Date("2026-08-01T12:00:00.000Z"),
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");

    const doc = parse(html);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    // Jedyny skrypt w dokumencie to własny hook window.print().
    expect(doc.querySelectorAll("script")).toHaveLength(1);
    expect(doc.title).toContain(XSS);
  });

  it("escapuje tytuł, treść, meta i etykietę typu zdarzenia", () => {
    const html = buildLeadTimelineHtml({
      lead: { first_name: "Anna", last_name: "Kowalska", email: "anna@example.com" },
      events: [
        event({ title: XSS, detail: `detail ${XSS}`, meta: { note: XSS } }),
        // Typ spoza słownika etykiet (np. nowy rodzaj zdarzenia z serwera)
        // wypada na surową wartość - też przez escapeHtml.
        event({ id: "x:2", type: "other" as LeadTimelineEvent["type"] }),
      ],
      typeLabels: LABELS,
    });

    expect(html).not.toContain("<img");
    const doc = parse(html);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(doc.querySelector(".t")?.textContent).toBe(XSS);
    expect(doc.querySelector(".d")?.textContent).toBe(`detail ${XSS}`);
    expect(doc.querySelector(".m")?.textContent).toBe(JSON.stringify({ note: XSS }));
    expect(Array.from(doc.querySelectorAll(".tg")).map((n) => n.textContent)).toEqual([
      "Zgłoszenie",
      "other",
    ]);
  });

  it("nazwa spada na e-mail, gdy brak imienia i nazwiska", () => {
    expect(leadTimelineDisplayName({ first_name: null, last_name: null, email: "a@b.pl" })).toBe(
      "a@b.pl",
    );
  });
});

describe("parseLeadTimelinePayload - kontrakt getCrmLeadTimeline", () => {
  it("czyta kształt { lead, events } zwracany przez handler", () => {
    const payload = parseLeadTimelinePayload(
      JSON.stringify({
        lead: { email: "a@b.pl", first_name: "A", last_name: "B", tenant_id: "t" },
        events: [event()],
      }),
    );
    expect(payload.lead.email).toBe("a@b.pl");
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]?.title).toBe("Formularz kontaktowy");
  });

  it("zwraca pustą listę zdarzeń, gdy handler nie odda tablicy", () => {
    expect(parseLeadTimelinePayload(JSON.stringify({ lead: null })).events).toEqual([]);
    expect(parseLeadTimelinePayload("null").events).toEqual([]);
  });
});

describe("konsumenci osi czasu", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("karta /admin/crm/$id mapuje events, a nie cały payload (K4)", () => {
    const src = read("src/routes/admin.crm.$id.tsx");
    expect(src).toContain("parseLeadTimelinePayload");
    expect(src).toContain("timelineQ.data?.events");
    // Poprzedni kontrakt (tablica zdarzeń z polami kind/body) nie istnieje.
    expect(src).not.toContain("e.kind");
    expect(src).not.toContain("e.body");
  });

  it("drawer listy CRM buduje wydruk przez wspólny builder (K1)", () => {
    const src = read("src/routes/admin.crm.index.tsx");
    expect(src).toContain("buildLeadTimelineHtml");
    expect(src).not.toContain("<title>${");
    expect(src).not.toContain("function escapeHtml");
  });
});
