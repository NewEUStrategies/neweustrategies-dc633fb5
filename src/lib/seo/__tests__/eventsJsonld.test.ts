import { describe, it, expect } from "vitest";
import {
  eventsCollectionJsonLd,
  publicEventJsonLd,
  type EventsListJsonLdEvent,
} from "@/lib/seo/jsonld";

const ORIGIN = "https://neweuropeanstrategies.com";

function build(events: EventsListJsonLdEvent[], lang: "pl" | "en" = "pl") {
  return eventsCollectionJsonLd({
    origin: ORIGIN,
    lang,
    path: "/events",
    name: lang === "en" ? "Events" : "Wydarzenia",
    description: "Opis listy",
    events,
  });
}

function items(graph: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = graph.mainEntity as { itemListElement: Array<{ item: Record<string, unknown> }> };
  return list.itemListElement.map((li) => li.item);
}

describe("eventsCollectionJsonLd", () => {
  it("emits a CollectionPage with full Event nodes and language-correct URLs", () => {
    const graph = build(
      [
        { slug: "szczyt-ue", name: "Szczyt UE", startDate: "2026-09-01T10:00:00Z" },
        { slug: "webinar-x", name: "Webinar X", startDate: "2026-09-02T10:00:00Z" },
      ],
      "en",
    );
    expect(graph["@type"]).toBe("CollectionPage");
    expect(graph.url).toBe(`${ORIGIN}/en/events`);
    expect(graph.isPartOf).toEqual({ "@id": `${ORIGIN}/#website` });
    const nodes = items(graph);
    expect(nodes.map((n) => n.url)).toEqual([
      `${ORIGIN}/en/events/szczyt-ue`,
      `${ORIGIN}/en/events/webinar-x`,
    ]);
    expect(nodes[0]["@type"]).toBe("Event");
    expect(nodes[0].eventStatus).toBe("https://schema.org/EventScheduled");
    expect(nodes[0].organizer).toEqual({ "@id": `${ORIGIN}/#organization` });
  });

  it("maps events.kind onto the schema.org attendance mode and never guesses", () => {
    const nodes = items(
      build([
        { slug: "a", name: "A", startDate: "2026-09-01T10:00:00Z", kind: "webinar" },
        { slug: "b", name: "B", startDate: "2026-09-01T10:00:00Z", kind: "in_person" },
        { slug: "c", name: "C", startDate: "2026-09-01T10:00:00Z", kind: "hybrid" },
        { slug: "d", name: "D", startDate: "2026-09-01T10:00:00Z", kind: "roundtable" },
      ]),
    );
    expect(nodes[0].eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode");
    expect(nodes[1].eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
    expect(nodes[2].eventAttendanceMode).toBe("https://schema.org/MixedEventAttendanceMode");
    expect(nodes[3]).not.toHaveProperty("eventAttendanceMode");
  });

  it("builds Place for physical venues and VirtualLocation for remote events", () => {
    const nodes = items(
      build([
        { slug: "sala", name: "Sala", startDate: "2026-09-01T10:00:00Z", location: "Bruksela" },
        { slug: "web", name: "Web", startDate: "2026-09-01T10:00:00Z", kind: "webinar" },
        {
          slug: "hyb",
          name: "Hyb",
          startDate: "2026-09-01T10:00:00Z",
          kind: "hybrid",
          location: "Warszawa",
        },
        { slug: "nic", name: "Nic", startDate: "2026-09-01T10:00:00Z", kind: "roundtable" },
      ]),
    );
    expect(nodes[0].location).toEqual({ "@type": "Place", name: "Bruksela", address: "Bruksela" });
    expect(nodes[1].location).toEqual({
      "@type": "VirtualLocation",
      url: `${ORIGIN}/events/web`,
    });
    // Wydarzenie hybrydowe z salą: oba miejsca naraz (Place + VirtualLocation).
    const hybrid = nodes[2].location as Array<Record<string, unknown>>;
    expect(hybrid.map((l) => l["@type"])).toEqual(["Place", "VirtualLocation"]);
    // Nieznany rodzaj bez sali: markup uczciwie bez lokalizacji.
    expect(nodes[3]).not.toHaveProperty("location");
  });

  it("emits endDate and image only when present", () => {
    const nodes = items(
      build([
        {
          slug: "pelne",
          name: "Pełne",
          startDate: "2026-09-01T10:00:00Z",
          endDate: "2026-09-01T12:00:00Z",
          image: "https://cdn.example.com/cover.jpg",
        },
        { slug: "gole", name: "Gołe", startDate: "2026-09-01T10:00:00Z", endDate: null },
      ]),
    );
    expect(nodes[0].endDate).toBe("2026-09-01T12:00:00Z");
    expect(nodes[0].image).toEqual(["https://cdn.example.com/cover.jpg"]);
    expect(nodes[1]).not.toHaveProperty("endDate");
    expect(nodes[1]).not.toHaveProperty("image");
  });

  it("dokłada PostalAddress, gdy adres strukturalny jest w kolumnach", () => {
    const nodes = items(
      build([
        {
          slug: "kongres",
          name: "Kongres",
          startDate: "2026-09-01T10:00:00Z",
          kind: "in_person",
          location: "Centrum Kongresowe",
          streetAddress: "Krucza 1",
          postalCode: "00-001",
          city: "Warszawa",
          region: "mazowieckie",
          country: "PL",
        },
      ]),
    );
    expect(nodes[0].location).toEqual({
      "@type": "Place",
      // Nazwa sali zostaje nazwą miejsca - adres strukturalny zajmuje `address`.
      name: "Centrum Kongresowe",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Krucza 1",
        postalCode: "00-001",
        addressLocality: "Warszawa",
        addressRegion: "mazowieckie",
        addressCountry: "PL",
      },
    });
  });

  it("pomija puste pola adresu, zamiast emitować je jako pusty napis", () => {
    const nodes = items(
      build([
        {
          slug: "bruksela",
          name: "Bruksela",
          startDate: "2026-09-01T10:00:00Z",
          city: "Bruksela",
          country: "BE",
          streetAddress: null,
          postalCode: "",
          region: null,
        },
      ]),
    );
    // Bez nazwy sali nazwą miejsca jest adres w jednej linii (`Place` wymaga
    // nazwy), a `address` niesie wyłącznie pola wypełnione.
    expect(nodes[0].location).toEqual({
      "@type": "Place",
      name: "Bruksela, BE",
      address: { "@type": "PostalAddress", addressLocality: "Bruksela", addressCountry: "BE" },
    });
  });

  it("ZACHOWUJE dzisiejsze zachowanie dla wydarzenia z samą nazwą miejsca", () => {
    // To jest regresja, o którą naprawdę chodzi: dopisanie adresu
    // strukturalnego nie może odebrać `Place` wydarzeniom, w których nikt
    // nowych kolumn nie uzupełnił.
    const nodes = items(
      build([
        { slug: "sala", name: "Sala", startDate: "2026-09-01T10:00:00Z", location: "Bruksela" },
      ]),
    );
    expect(nodes[0].location).toEqual({ "@type": "Place", name: "Bruksela", address: "Bruksela" });
  });
});

describe("publicEventJsonLd - strona szczegółu wydarzenia", () => {
  it("jest samodzielnym dokumentem @context o kształcie węzła z listy", () => {
    const ld = publicEventJsonLd({
      origin: ORIGIN,
      lang: "pl",
      event: {
        slug: "kongres",
        name: "Kongres",
        startDate: "2026-09-01T10:00:00Z",
        endDate: "2026-09-02T16:00:00Z",
        kind: "in_person",
        location: "Centrum Kongresowe",
        city: "Warszawa",
        country: "PL",
        description: "  Opis wydarzenia  ",
      },
    });
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Event");
    expect(ld["@id"]).toBe(`${ORIGIN}/events/kongres#event`);
    expect(ld.url).toBe(`${ORIGIN}/events/kongres`);
    expect(ld.endDate).toBe("2026-09-02T16:00:00Z");
    expect(ld.eventAttendanceMode).toBe("https://schema.org/OfflineEventAttendanceMode");
    expect(ld.description).toBe("Opis wydarzenia");
    const place = ld.location as Record<string, unknown>;
    expect(place.address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Warszawa",
      addressCountry: "PL",
    });
  });

  it("bez opisu nie emituje pustego pola description", () => {
    const ld = publicEventJsonLd({
      origin: ORIGIN,
      lang: "en",
      event: { slug: "web", name: "Web", startDate: "2026-09-01T10:00:00Z", description: "   " },
    });
    expect(ld).not.toHaveProperty("description");
    expect(ld.url).toBe(`${ORIGIN}/en/events/web`);
  });
});
