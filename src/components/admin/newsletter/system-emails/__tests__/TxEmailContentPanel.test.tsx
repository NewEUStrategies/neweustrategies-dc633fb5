// Edytor treści maili transakcyjnych (karencja miejsca zespołowego i koniec
// dostępu), PL i EN obok siebie.
//
// CO TU JEST GROŹNE. Panel edytuje NADPISANIA szablonów - puste pole znaczy
// „użyj domyślnej treści". Skutek pomyłki widzi dopiero ODBIORCA:
//   * zapis, który nadpisuje cały obiekt, wyciera nadpisania pozostałych typów
//     maili - przypomnienie o wygaśnięciu dostępu wraca do domyślnej treści bez
//     żadnego sygnału w panelu;
//   * reset dotyczący obu języków wyciera pracę tłumacza;
//   * przycisk zapisu aktywny bez zmian uczy operatora klikać bez powodu, a
//     zablokowany po zmianie znaczy, że wpisanej treści nie da się zapisać.
//
// Warstwa danych: gotowa atrapa łańcucha PostgREST. Test sprawdza, CO poszłoby
// do bazy; nic nie wychodzi na zewnątrz.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseFromStub, ok, type RecordedChain } from "@/test/supabaseChain";

const env = vi.hoisted(() => ({
  from: (_table: string): unknown => ({}),
  previews: [] as Array<{ type: string; subject: string; html: string }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => env.from(table) },
}));
// Podgląd zapisanej wersji renderuje serwer - atrapa, żadnego realnego żądania.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => async () => env.previews,
}));
vi.mock("@/lib/tx-email-preview.functions", () => ({ getTxEmailPreviews: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import i18n from "@/lib/i18n";
import { toast } from "sonner";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { TxEmailContentPanel } from "@/components/admin/newsletter/system-emails/TxEmailContentPanel";
import {
  EDITABLE_TX_TYPES,
  TX_OVERRIDES_SETTING_KEY,
  type TxOverrides,
} from "@/lib/email/txOverrides";
import {
  FIELDS,
  TYPE_LABEL_KEYS,
} from "@/components/admin/newsletter/system-emails/txContentRules";

const C = (key: string) => i18n.t(`adminNewsletter.emailContent.${key}`);
const fieldLabel = (key: string) => i18n.t(FIELDS.find((f) => f.key === key)!.labelKey);

let stub: ReturnType<typeof supabaseFromStub>;
let saveResult: (chain: RecordedChain) => ReturnType<typeof ok>;

/** Wiersz `site_settings` z nadpisaniami (albo bez nich). */
function mount(stored: Partial<TxOverrides> | null = null) {
  stub.setResponse("site_settings", (chain) => {
    if (chain.has("upsert")) return saveResult(chain);
    return ok(stored ? [{ key: TX_OVERRIDES_SETTING_KEY, value: stored }] : []);
  });
  return renderWithQueryClient(<TxEmailContentPanel />);
}

/** Treść, jaka poszłaby do bazy po kliknięciu „Zapisz". */
async function saved(): Promise<TxOverrides> {
  fireEvent.click(screen.getByText(C("save")));
  await waitFor(() => {
    expect(stub.chainsFor("site_settings").some((c) => c.has("upsert"))).toBe(true);
  });
  const chain = stub.chainsFor("site_settings").find((c) => c.has("upsert"))!;
  const body = chain.argsOf("upsert")![0] as { value: TxOverrides };
  return body.value;
}

function saveButton(): HTMLButtonElement {
  return screen.getByText(C("save")).closest("button")!;
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

beforeEach(() => {
  stub = supabaseFromStub();
  env.from = stub.from;
  env.previews = [{ type: "team_seat_grace", subject: "Temat karencji", html: "<p>karencja</p>" }];
  saveResult = () => ok(null);
  clearEdgeTtlCache();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("układ edytora", () => {
  it("ma zakładkę dla KAŻDEGO edytowalnego typu maila", () => {
    mount();

    for (const type of EDITABLE_TX_TYPES) {
      expect(screen.getByText(i18n.t(TYPE_LABEL_KEYS[type]))).toBeTruthy();
    }
    expect(EDITABLE_TX_TYPES.length).toBeGreaterThan(1);
  });

  it("ma pole dla KAŻDEJ nadpisywalnej części maila", () => {
    mount();

    for (const f of FIELDS) {
      expect(screen.getByText(i18n.t(f.labelKey)), `brak pola ${f.key}`).toBeTruthy();
    }
  });

  it("puste pole MÓWI, że użyta będzie treść domyślna", () => {
    // Bez tej podpowiedzi puste pole czyta się jako „mail bez nagłówka".
    const { container } = mount();

    const intro = container.querySelector("textarea")!;
    expect(intro.getAttribute("placeholder")).toBe(C("fieldPlaceholder"));
    expect(screen.getByText(C("subtitle"))).toBeTruthy();
  });

  it("wymienia dostępne znaczniki w formie, w jakiej się je wpisuje", () => {
    mount();

    expect(screen.getByText(new RegExp(C("tokensLabel")))).toBeTruthy();
    expect(screen.getByText(/\{firstName\}|\{.+\}/)).toBeTruthy();
  });

  it("pola długie są WIELOLINIJKOWE, krótkie jednolinijkowe", () => {
    const { container } = mount();

    const multiline = FIELDS.filter((f) => f.multiline).length;
    expect(container.querySelectorAll("textarea")).toHaveLength(multiline);
    expect(multiline).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("zapis", () => {
  it("bez zmian zapis jest ZABLOKOWANY", () => {
    mount();

    expect(saveButton()).toHaveProperty("disabled", true);
    expect(stub.chainsFor("site_settings").some((c) => c.has("upsert"))).toBe(false);
  });

  it("pierwsza zmiana ODBLOKOWUJE zapis", () => {
    mount();

    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "Nowy temat" },
    });

    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("zapisana treść trafia do POLA i TYPU, który operator edytował", async () => {
    mount();

    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "Temat karencji" },
    });

    const value = await saved();
    expect(value.team_seat_grace.pl.subject).toBe("Temat karencji");
  });

  it("zapis NIE wyciera nadpisań pozostałych typów maili", async () => {
    // To jest cała stawka: skutek zobaczy dopiero odbiorca przypomnienia.
    mount({
      team_seat_grace: { pl: { eyebrow: "Zaczep" }, en: {} },
      team_seat_access_ended: { pl: { heading: "Koniec dostępu" }, en: {} },
    } as Partial<TxOverrides>);
    // Czekamy na widoczną wartość z bazy - inaczej edycja poszłaby przed
    // wczytaniem i została nadpisana synchronizacją szkicu.
    await screen.findByDisplayValue("Zaczep");

    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "Temat karencji" },
    });

    const value = await saved();
    expect(value.team_seat_access_ended.pl.heading).toBe("Koniec dostępu");
    expect(value.team_seat_grace.pl.subject).toBe("Temat karencji");
  });

  it("zapis NIE wyciera pozostałych pól tego samego maila", async () => {
    mount();

    fireEvent.change(screen.getByLabelText(fieldLabel("heading")), {
      target: { value: "Nagłówek" },
    });
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "Temat" },
    });

    const value = await saved();
    expect(value.team_seat_grace.pl).toMatchObject({ heading: "Nagłówek", subject: "Temat" });
  });

  it("pole WIELOLINIJKOWE też patchuje - wstęp maila to najdłuższa treść", async () => {
    // Akapit wstępny zastępuje treść personalizowaną, więc jego zgubienie
    // wysyła maila bez najważniejszego zdania.
    mount();

    fireEvent.change(screen.getByLabelText(fieldLabel("intro")), {
      target: { value: "Twoje miejsce w zespole wygasa za 7 dni." },
    });

    const value = await saved();
    expect(value.team_seat_grace.pl.intro).toBe("Twoje miejsce w zespole wygasa za 7 dni.");
    expect(value.team_seat_grace.pl.subject).toBe("");
  });

  it("zapis idzie pod KLUCZ nadpisań, a nie pod dowolny wiersz ustawień", async () => {
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), { target: { value: "X" } });

    fireEvent.click(screen.getByText(C("save")));

    await waitFor(() => {
      const chain = stub.chainsFor("site_settings").find((c) => c.has("upsert"));
      expect((chain?.argsOf("upsert")?.[0] as { key: string }).key).toBe(TX_OVERRIDES_SETTING_KEY);
    });
  });

  it("udany zapis potwierdza się komunikatem", async () => {
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), { target: { value: "X" } });

    await saved();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("BŁĄD zapisu jest widoczny - cicha porażka to utracona treść", async () => {
    saveResult = () => ({ data: null, error: Object.assign(new Error("baza padla"), {}) });
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), { target: { value: "X" } });

    fireEvent.click(screen.getByText(C("save")));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("baza padla"));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("dwa języki", () => {
  it("edycja PL nie rusza EN", async () => {
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "Polski temat" },
    });

    fireEvent.click(screen.getByText("EN"));
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "English subject" },
    });

    const value = await saved();
    expect(value.team_seat_grace.pl.subject).toBe("Polski temat");
    expect(value.team_seat_grace.en.subject).toBe("English subject");
  });

  it("przełączenie języka pokazuje treść TEGO języka", () => {
    mount({
      team_seat_grace: {
        pl: { subject: "Polski temat" },
        en: { subject: "English subject" },
      },
    } as Partial<TxOverrides>);

    return waitFor(() => {
      expect(screen.getByDisplayValue("Polski temat")).toBeTruthy();
    }).then(() => {
      fireEvent.click(screen.getByText("EN"));
      expect(screen.getByDisplayValue("English subject")).toBeTruthy();
      expect(screen.queryByDisplayValue("Polski temat")).toBeNull();
    });
  });

  it("aktywny język jest OZNACZONY - operator wie, co edytuje", () => {
    mount();

    expect(screen.getByText("PL").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("EN").getAttribute("aria-pressed")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
describe("przełączanie typu maila", () => {
  it("każdy typ ma WŁASNĄ treść", () => {
    mount({
      team_seat_grace: { pl: { subject: "Karencja" }, en: {} },
      team_seat_access_ended: { pl: { subject: "Koniec" }, en: {} },
    } as Partial<TxOverrides>);

    return waitFor(() => expect(screen.getByDisplayValue("Karencja")).toBeTruthy()).then(() => {
      fireEvent.click(screen.getByText(i18n.t(TYPE_LABEL_KEYS.team_seat_access_ended)));
      expect(screen.getByDisplayValue("Koniec")).toBeTruthy();
      expect(screen.queryByDisplayValue("Karencja")).toBeNull();
    });
  });

  it("edycja jednego typu nie przecieka do drugiego", async () => {
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "Karencja" },
    });

    fireEvent.click(screen.getByText(i18n.t(TYPE_LABEL_KEYS.team_seat_access_ended)));

    expect((screen.getByLabelText(fieldLabel("subject")) as HTMLInputElement).value).toBe("");
    expect((await saved()).team_seat_grace.pl.subject).toBe("Karencja");
  });
});

// ---------------------------------------------------------------------------
describe("przywracanie domyślnych", () => {
  it("reset czyści treść EDYTOWANEGO języka i wraca do stanu zapisanego", () => {
    // Po resecie szkic jest identyczny z zapisanym, więc nie ma czego zapisywać -
    // aktywny przycisk zapisu uczyłby operatora klikać bez powodu.
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), { target: { value: "Temat" } });
    expect(saveButton()).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByText(C("resetDefaults")));

    expect((screen.getByLabelText(fieldLabel("subject")) as HTMLInputElement).value).toBe("");
    expect(saveButton()).toHaveProperty("disabled", true);
  });

  it("reset ZAPISANEJ treści jest zmianą do zapisania", async () => {
    mount({
      team_seat_grace: { pl: { subject: "Zapisany temat" }, en: {} },
    } as Partial<TxOverrides>);
    await screen.findByDisplayValue("Zapisany temat");

    fireEvent.click(screen.getByText(C("resetDefaults")));

    expect(saveButton()).toHaveProperty("disabled", false);
    expect((await saved()).team_seat_grace.pl.subject).toBe("");
  });

  it("reset ZOSTAWIA drugi język - inaczej wyciera pracę tłumacza", async () => {
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), { target: { value: "Polski" } });
    fireEvent.click(screen.getByText("EN"));
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "English" },
    });

    fireEvent.click(screen.getByText(C("resetDefaults")));

    const value = await saved();
    expect(value.team_seat_grace.en.subject).toBe("");
    expect(value.team_seat_grace.pl.subject).toBe("Polski");
  });

  it("reset zostawia nietknięte pozostałe typy maili", async () => {
    mount();
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), {
      target: { value: "Karencja" },
    });
    fireEvent.click(screen.getByText(i18n.t(TYPE_LABEL_KEYS.team_seat_access_ended)));
    fireEvent.change(screen.getByLabelText(fieldLabel("subject")), { target: { value: "Koniec" } });

    fireEvent.click(screen.getByText(C("resetDefaults")));

    const value = await saved();
    expect(value.team_seat_grace.pl.subject).toBe("Karencja");
    expect(value.team_seat_access_ended.pl.subject).toBe("");
  });
});

// ---------------------------------------------------------------------------
describe("podgląd zapisanej wersji", () => {
  it("pokazuje temat i treść z serwera", async () => {
    mount();

    expect(await screen.findByText("Temat karencji")).toBeTruthy();
    const frame = screen.getByTitle("tx-email-preview") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("karencja");
  });

  it("BRAK podglądu dla typu pokazuje kreskę, nie pustkę", async () => {
    env.previews = [];
    mount();

    expect(await screen.findByText("-")).toBeTruthy();
    expect(
      (screen.getByTitle("tx-email-preview") as HTMLIFrameElement).getAttribute("srcdoc"),
    ).toBe("");
  });

  it("ramka podglądu jest w PIASKOWNICY", () => {
    mount();

    expect(screen.getByTitle("tx-email-preview").getAttribute("sandbox")).toBe("allow-same-origin");
    expect(screen.getByText(C("savedPreview"))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("tłumaczenia", () => {
  it("etykiety panelu idą za językiem interfejsu", async () => {
    await i18n.changeLanguage("en");
    try {
      mount();

      expect(screen.getByText(i18n.t("adminNewsletter.emailContent.title"))).toBeTruthy();
      expect(screen.getByText(i18n.t("adminNewsletter.emailContent.save"))).toBeTruthy();
    } finally {
      await i18n.changeLanguage("pl");
    }
  });
});
