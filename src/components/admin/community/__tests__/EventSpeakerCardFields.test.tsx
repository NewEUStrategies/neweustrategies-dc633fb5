// Pola KARTY PRELEGENTA - wspolne dla popupu „Nowy prelegent" i dialogu „Karta".
//
// CO TEN PLIK DOWODZI. Te piec pol zasila jedna karte na stronie prelegentow,
// a reguly walidacji sa lustrem CHECK-ow bazy. Dowodzone jest wiec:
//
//   1. KAZDE POLE PISZE WLASNY KLUCZ SZKICU. Para PL/EN zamieniona miejscami
//      nie daje wyjatku - wychodzi dopiero na stronie publicznej.
//   2. LIMIT 40 ZNAKOW jest na kontrolce (`maxLength`) i w komunikacie bledu
//      (wartosc z bazy albo wklejona moze byc dluzsza niz limit pola).
//   3. KAZDY BLAD MA `role="alert"` i `aria-invalid` na polu - redaktor
//      z czytnikiem ekranu musi uslyszec, ktore pole poprawic.
//   4. KOLOR: pusty = kolor marki. Wybierak nie umie byc pusty, wiec pokazuje
//      kolor marki, a obok stoi przycisk powrotu do niego - wylaczony, gdy
//      nie ma czego czyscic.
//   5. ZERO SUROWYCH KLUCZY i18n na ekranie, takze przy wszystkich bledach.
//
// `EventImageDropzone` jest ATRAPOWANY: prawdziwy obszar wgrywania wchodzi do
// Supabase Storage (i ma wlasny plik testowy), a tutaj liczy sie wylacznie
// kontrakt `value` / `onValueChange` i to, do jakiego katalogu trafia zdjecie.
import { useState } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { SpeakerCardDraft } from "@/lib/events/speakerCard";

interface DropzoneProps {
  label: string;
  hint?: string;
  recommendation: string;
  value: string;
  onValueChange: (value: string) => void;
  subfolder: string;
  aspectClassName?: string;
}

const dropzone = vi.hoisted(() => ({ last: null as DropzoneProps | null }));

vi.mock("@/components/admin/events/atoms/EventImageDropzone", () => ({
  EventImageDropzone: (props: DropzoneProps) => {
    dropzone.last = props;
    return (
      <div data-testid="image-dropzone">
        <input
          aria-label={props.label}
          value={props.value}
          onChange={(event) => props.onValueChange(event.target.value)}
        />
        <p>{props.hint}</p>
        <p>{props.recommendation}</p>
      </div>
    );
  },
}));

import { ensureI18n as ensureCommunityEventsI18n } from "@/lib/i18n-admin-community-events";

const { EventSpeakerCardFields } =
  await import("@/components/admin/community/EventSpeakerCardFields");

ensureCommunityEventsI18n();

const EMPTY: SpeakerCardDraft = { photoUrl: "", labelPl: "", labelEn: "", url: "", color: "" };

const onChange = vi.fn<(next: SpeakerCardDraft) => void>();

/** Kontrolowany rodzic - taki sam, jak dwa prawdziwe formularze. */
function Harness({ initial, idPrefix = "t" }: { initial: SpeakerCardDraft; idPrefix?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <EventSpeakerCardFields
      idPrefix={idPrefix}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

function renderFields(overrides: Partial<SpeakerCardDraft> = {}, idPrefix = "t") {
  return render(<Harness initial={{ ...EMPTY, ...overrides }} idPrefix={idPrefix} />);
}

function input(label: string): HTMLInputElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error(`test: "${label}" to nie input`);
  return element;
}

function picker(): HTMLInputElement {
  return input("Wybierz kolor przycisku");
}

function resetButton(): HTMLElement {
  return screen.getByRole("button", { name: "Kolor marki" });
}

const LABEL_41 = "x".repeat(41);

describe("EventSpeakerCardFields - szkic", () => {
  beforeEach(() => {
    onChange.mockReset();
    dropzone.last = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("kazde pole pisze WLASNY klucz szkicu - para PL/EN nie zamienia sie miejscami", () => {
    renderFields();

    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "Zapisz się" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, labelPl: "Zapisz się" });

    fireEvent.change(input("Napis na przycisku EN"), { target: { value: "Sign up" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      labelPl: "Zapisz się",
      labelEn: "Sign up",
    });

    fireEvent.change(input("Adres przycisku"), { target: { value: "https://example.com/z" } });
    fireEvent.change(input("Kolor przycisku"), { target: { value: "#0a7d3b" } });
    fireEvent.change(input("Zdjęcie rozwiniętej karty"), {
      target: { value: "https://cdn.example.com/karta.jpg" },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      photoUrl: "https://cdn.example.com/karta.jpg",
      labelPl: "Zapisz się",
      labelEn: "Sign up",
      url: "https://example.com/z",
      color: "#0a7d3b",
    });
    // Kontrolki pokazuja szkic rodzica, a nie wlasny stan.
    expect(input("Napis na przycisku PL").value).toBe("Zapisz się");
    expect(input("Napis na przycisku EN").value).toBe("Sign up");
    expect(input("Adres przycisku").value).toBe("https://example.com/z");
    expect(input("Kolor przycisku").value).toBe("#0a7d3b");
  });

  it("pola pokazuja wartosci szkicu przekazanego z zewnatrz", () => {
    renderFields({
      photoUrl: "https://cdn.example.com/a.jpg",
      labelPl: "Więcej",
      labelEn: "More",
      url: "/experts/halszka",
      color: "#123456",
    });
    expect(input("Zdjęcie rozwiniętej karty").value).toBe("https://cdn.example.com/a.jpg");
    expect(input("Napis na przycisku PL").value).toBe("Więcej");
    expect(input("Napis na przycisku EN").value).toBe("More");
    expect(input("Adres przycisku").value).toBe("/experts/halszka");
    expect(input("Kolor przycisku").value).toBe("#123456");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("zdjecie idzie przez wspolny obszar wgrywania do katalogu prelegentow", () => {
    renderFields();
    expect(dropzone.last).not.toBeNull();
    expect(dropzone.last?.subfolder).toBe("event-speakers");
    expect(dropzone.last?.label).toBe("Zdjęcie rozwiniętej karty");
    expect(dropzone.last?.recommendation).toBe("800 x 800 px");
    expect(
      screen.getByText("Puste = karta rozwija się na zdjęciu prelegenta."),
    ).toBeInTheDocument();
    // Kwadratowy kadr - rozwinieta karta jest kwadratem.
    expect(dropzone.last?.aspectClassName).toContain("aspect-square");
  });

  it("napisy przycisku NIE maja maxLength (UTF-16), limit pilnuje komunikat; pole koloru 7", () => {
    // `maxLength` liczy jednostki UTF-16, a baza punkty kodowe - emoji
    // zatrzymalyby pisanie w polowie limitu. Dlugosc pilnuje walidator.
    renderFields();
    expect(input("Napis na przycisku PL")).not.toHaveAttribute("maxLength");
    expect(input("Napis na przycisku EN")).not.toHaveAttribute("maxLength");
    expect(input("Kolor przycisku")).toHaveAttribute("maxLength", "7");
  });

  it("identyfikatory pol biora przedrostek - dwa formularze na jednej stronie sie nie gryza", () => {
    render(
      <>
        <Harness initial={EMPTY} idPrefix="create" />
        <Harness initial={EMPTY} idPrefix="edit" />
      </>,
    );
    const ids = screen.getAllByLabelText("Napis na przycisku PL").map((element) => element.id);
    expect(ids).toEqual(["create-label-pl", "edit-label-pl"]);
    const urlIds = screen.getAllByLabelText("Adres przycisku").map((element) => element.id);
    expect(urlIds).toEqual(["create-url", "edit-url"]);
  });

  it("adres przycisku jest opisany podpowiedzia (aria-describedby)", () => {
    renderFields({}, "karta");
    const url = input("Adres przycisku");
    expect(url).toHaveAttribute("aria-describedby", "karta-url-hint");
    expect(document.getElementById("karta-url-hint")?.textContent).toContain(
      "Adres https albo ścieżka w serwisie",
    );
    expect(url).toHaveAttribute("placeholder", "https://… albo /experts/…");
    expect(url).toHaveAttribute("inputMode", "url");
  });
});

describe("EventSpeakerCardFields - bledy przed zapisem", () => {
  beforeEach(() => {
    onChange.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("za dlugi napis PL: komunikat w role=alert i aria-invalid na polu", () => {
    // Wartosc dluzsza niz `maxLength` przychodzi z bazy albo z wklejenia -
    // kontrolka jej nie przytnie, wiec komunikat jest jedyna informacja.
    renderFields({ labelPl: LABEL_41 }, "k");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Napis może mieć najwyżej 40 znaków.");
    expect(alert.id).toBe("k-label-pl-error");
    expect(input("Napis na przycisku PL")).toHaveAttribute("aria-invalid", "true");
    expect(input("Napis na przycisku EN")).toHaveAttribute("aria-invalid", "false");
  });

  it("za dlugi napis EN ma wlasny komunikat przy wlasnym polu", () => {
    renderFields({ labelEn: LABEL_41 }, "k");
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("k-label-en-error");
    expect(alert).toHaveTextContent("Napis może mieć najwyżej 40 znaków.");
    expect(input("Napis na przycisku EN")).toHaveAttribute("aria-invalid", "true");
  });

  it("limit liczy napis PO przycieciu - 40 znakow w spacjach nie jest bledem", () => {
    renderFields({ labelPl: `  ${"x".repeat(40)}  ` });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input("Napis na przycisku PL")).toHaveAttribute("aria-invalid", "false");
  });

  it("limit liczy znaki jak baza (punkty kodowe), a nie jednostki UTF-16", () => {
    // 40 emoji to 40 znakow dla `char_length`, choc 80 jednostek dla JS.
    const { unmount } = renderFields({ labelPl: "\u{1F3A4}".repeat(40) });
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();

    renderFields({ labelPl: "\u{1F3A4}".repeat(41) });
    expect(screen.getByRole("alert")).toHaveTextContent("najwyżej 40 znaków");
  });

  it("blad pojawia sie w trakcie pisania i znika po poprawce", () => {
    renderFields();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(input("Napis na przycisku PL"), { target: { value: LABEL_41 } });
    expect(screen.getByRole("alert")).toHaveTextContent("najwyżej 40 znaków");

    fireEvent.change(input("Napis na przycisku PL"), { target: { value: "Zapisz się" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["javascript:alert(1)"],
    ["http://example.com/zapisy"],
    ["//evil.example.com"],
    // Przegladarka czyta `/\host` jak `//host` - adres wzgledny wobec protokolu.
    ["/\\evil.example.com"],
    // CHECK w bazie rozroznia wielkosc liter, wiec panel tez.
    ["HTTPS://example.com/zapisy"],
    ["https://example.com/z apisy"],
    ["zapisy"],
  ])("adres przycisku %s jest odrzucony z komunikatem", (value) => {
    renderFields({ url: value }, "k");
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("k-url-error");
    expect(alert).toHaveTextContent(
      "Adres musi zaczynać się od https:// albo od ukośnika (ścieżka w serwisie).",
    );
    expect(input("Adres przycisku")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([["https://example.com/zapisy"], ["/experts/halszka"], [""]])(
    "adres przycisku %s jest przyjety",
    (value) => {
      renderFields({ url: value });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(input("Adres przycisku")).toHaveAttribute("aria-invalid", "false");
    },
  );

  it("zdjecie karty spoza https ma komunikat - strona publiczna nie laduje http", () => {
    renderFields({ photoUrl: "http://cdn.example.com/karta.jpg" }, "k");
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("k-photo-error");
    expect(alert).toHaveTextContent("Adres zdjęcia musi zaczynać się od https://");
  });

  it.each([["red"], ["#abc"], ["#12345g"], ["0a7d3b"]])(
    "kolor %s spoza formatu #RRGGBB ma komunikat",
    (value) => {
      renderFields({ color: value }, "k");
      const alert = screen.getByRole("alert");
      expect(alert.id).toBe("k-color-error");
      expect(alert).toHaveTextContent("Kolor w formacie #RRGGBB.");
      expect(input("Kolor przycisku")).toHaveAttribute("aria-invalid", "true");
    },
  );

  it("wszystkie bledy naraz: kazdy przy swoim polu, bez surowych kluczy i18n", () => {
    renderFields({
      photoUrl: "ftp://x",
      labelPl: LABEL_41,
      labelEn: LABEL_41,
      url: "javascript:void(0)",
      color: "zielony",
    });
    expect(screen.getAllByRole("alert")).toHaveLength(5);
    expect(document.body.textContent ?? "").not.toContain("adminCommunityEvents.");
    expect(document.body.textContent ?? "").not.toContain("adminEventAgenda.");
  });
});

describe("EventSpeakerCardFields - kolor przycisku", () => {
  beforeEach(() => {
    onChange.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("pusty kolor: wybierak pokazuje kolor marki, a pole ma go jako podpowiedz", () => {
    renderFields();
    expect(picker().value).toBe("#fa9346");
    expect(input("Kolor przycisku")).toHaveAttribute("placeholder", "#fa9346");
    expect(input("Kolor przycisku").value).toBe("");
  });

  it("wybrany kolor trafia do wybieraka malymi literami", () => {
    renderFields({ color: "#AABBCC" });
    expect(picker().value).toBe("#aabbcc");
    // Pole tekstowe zostawia to, co wpisal redaktor - to jego wartosc.
    expect(input("Kolor przycisku").value).toBe("#AABBCC");
  });

  it("niepoprawny kolor nie psuje wybieraka - ten wraca do koloru marki", () => {
    renderFields({ color: "#abc" });
    expect(picker().value).toBe("#fa9346");
  });

  it("wybor w wybieraku wpisuje kolor do szkicu i do pola tekstowego", () => {
    renderFields({ labelPl: "Zapisz się" });
    fireEvent.change(picker(), { target: { value: "#112233" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...EMPTY,
      labelPl: "Zapisz się",
      color: "#112233",
    });
    expect(input("Kolor przycisku").value).toBe("#112233");
    expect(picker().value).toBe("#112233");
  });

  it("„Kolor marki” jest wylaczony, gdy kolor jest pusty albo sam bialy znak", () => {
    const { unmount } = renderFields();
    expect(resetButton()).toBeDisabled();
    unmount();

    renderFields({ color: "   " });
    expect(resetButton()).toBeDisabled();
  });

  it("„Kolor marki” czysci kolor i wraca wybierak do koloru marki", () => {
    renderFields({ color: "#0a7d3b", url: "/experts/x" });
    expect(resetButton()).toBeEnabled();

    fireEvent.click(resetButton());

    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, url: "/experts/x", color: "" });
    expect(input("Kolor przycisku").value).toBe("");
    expect(picker().value).toBe("#fa9346");
    // Po wyczyszczeniu nie ma juz czego czyscic.
    expect(resetButton()).toBeDisabled();
  });

  it("„Kolor marki” czysci takze kolor niepoprawny (i jego komunikat)", () => {
    renderFields({ color: "zielony" });
    expect(screen.getByRole("alert")).toHaveTextContent("#RRGGBB");
    fireEvent.click(resetButton());
    expect(screen.queryByRole("alert")).toBeNull();
    // Przycisk to `type="button"` - w formularzu nie wysyla go.
    expect(resetButton()).toHaveAttribute("type", "button");
  });
});
