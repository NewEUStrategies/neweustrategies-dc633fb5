// Zakladka SLOTY panelu reklam: lista kreacji plus formularz dodawania/edycji.
//
// PO CO TEN PLIK ISTNIEJE. Slot to kreacja, ktora wykona sie u KAZDEGO
// czytelnika. Cztery rzeczy moga tu pojsc nie tak w sposob, ktorego panel sam
// z siebie nie pokazuje:
//   1. ZAPIS BEZ NAZWY - wiersz bez nazwy jest w liscie nieodroznialny od
//      innych, a przy pozycjach wybiera sie go wlasnie po nazwie.
//   2. ODMOWA BAZY POLKNIETA W CISZY - redaktor widzi wyczyszczony formularz
//      i zaklada, ze kreacja poszla; kampania nie leci, a nikt nie szuka
//      przyczyny, bo „przeciez zapisalem".
//   3. USUNIECIE BEZ POTWIERDZENIA albo usuniecie MIMO anulowania - slot znika
//      razem z przypietymi pozycjami i nie ma tego jak cofnac z panelu.
//   4. POLA NIE OD TEGO RODZAJU - formularz pokazujacy pole „Skrypt" dla slotu
//      obrazkowego zbiera dane, ktore emisja zignoruje: redaktor wkleja kod
//      AdSense, zapisuje i nie rozumie, czemu miejsce jest puste.
// Kazdy z tych czterech punktow ma tu wlasny przypadek.
//
// GRANICE vs SASIEDZI. Atrapowane sa WYLACZNIE granice: klient Supabase, toasty
// (`sonner`, `@/lib/adminToasts`), dialog potwierdzenia (`@/lib/appDialogs`),
// i18n oraz prymitywy Radiksa, ktore pod happy-dom nie reaguja na klikniecie
// (Select, Switch). PRAWDZIWE biegna: `../model`, `TargetingEditor`,
// `TargetingSummary`, `TargetingHeader` i `@/lib/ads/types` - to sasiedzi,
// a panel ma zdawac egzamin wobec nich, nie wobec ich atrap.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type SupabaseFromStub } from "@/test/supabaseChain";
import { axeViolations, summarize } from "@/test/axe";
import type { AdSlot } from "@/lib/ads/types";

/** Ksztalt pytania, ktore panel zadaje przed usunieciem (patrz `@/lib/appDialogs`). */
type ConfirmDialogOptions = {
  title: string;
  description?: string;
  destructive?: boolean;
  confirmLabel?: string;
};

const h = vi.hoisted(() => ({
  from: null as unknown,
  rt: null as unknown,
  // Sygnatura z argumentem, bo test asertuje TRESC pytania (tytul, wariant
  // destrukcyjny) - `vi.fn<() => ...>` dawal krotke zerowej dlugosci.
  confirm: vi.fn<(opts: ConfirmDialogOptions) => Promise<boolean>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/adminToasts", () => ({
  adminToast: { deleted: () => "adminToasts.deleted", saved: () => "adminToasts.saved" },
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { realtimeStub } = await import("@/test/supabase/realtime");
  const from = supabaseFromStub();
  const rt = realtimeStub();
  h.from = from;
  h.rt = rt;
  return {
    supabase: {
      from: from.from,
      channel: rt.channel.bind(rt),
      removeChannel: rt.removeChannel.bind(rt),
    },
  };
});

// Radix pod happy-dom nie otwiera listy ani nie przelacza przelacznika bez
// pelnego API wskaznika - a wybor RODZAJU slotu i przelacznik zgody sa tu
// glowna trescia zachowania.
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

import { SlotsPanel } from "../SlotsPanel";

const db = () => h.from as SupabaseFromStub;

const SLOT_A: AdSlot = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  tenant_id: "tttttttt-1111-4111-8111-tttttttttttt",
  name: "Baner glowny",
  kind: "html",
  status: "active",
  html: "<div>kreacja</div>",
  script: null,
  image_url: null,
  image_link: null,
  image_alt: null,
  width: 970,
  height: 250,
  requires_consent: true,
  targeting: { categorySlugs: ["unia-europejska"] },
  notes: "kampania Q1",
  created_at: "2026-02-01T10:00:00.000Z",
  updated_at: "2026-02-01T10:00:00.000Z",
};

const SLOT_B: AdSlot = {
  ...SLOT_A,
  id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  name: "Pasek boczny",
  kind: "image",
  status: "paused",
  requires_consent: false,
  targeting: {},
  html: null,
  image_url: "https://przyklad.example.com/kreacja.png",
};

/** Katalog zainteresowan dla PRAWDZIWEGO `TargetingEditor` w formularzu. */
function withCatalog(): void {
  db().setResponse(
    "categories",
    ok([
      { id: "cat-ue", slug: "unia-europejska", name_pl: "Unia", name_en: "EU", parent_id: null },
    ]),
  );
  db().setResponse("tags", ok([{ id: "tag-nato", slug: "nato", name: "NATO" }]));
}

async function renderPanel(slots: AdSlot[]) {
  db().setResponse("ad_slots", ok(slots));
  withCatalog();
  const utils = renderWithQueryClient(<SlotsPanel />);
  await waitFor(() => expect(db().chainsFor("ad_slots").length).toBeGreaterThan(0));
  return utils;
}

/** Rodzaj slotu - jedyny `<select>` w tym formularzu. */
function selectKind(): HTMLSelectElement {
  return screen.getByRole("combobox") as HTMLSelectElement;
}

beforeEach(() => {
  db().reset();
  (h.rt as { reset(): void }).reset();
  h.confirm.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("SlotsPanel - lista", () => {
  it("PUSTA lista mowi wprost, ze slotow nie ma (a nie pokazuje pustej tabeli)", async () => {
    await renderPanel([]);
    expect(await screen.findByText("adsAdmin.slots.empty")).toBeInTheDocument();
  });

  it("odczyt listy idzie po `ad_slots` i sortuje od najnowszych", async () => {
    // Kolejnosc nie jest kosmetyka: redaktor po zapisie szuka swojego wiersza
    // na gorze. Odwrocenie sortu chowa nowa kreacje na koncu dlugiej listy.
    await renderPanel([]);
    const chain = db().lastChain("ad_slots");
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("wiersz pokazuje nazwe, rodzaj, status, zgode i podsumowanie targetingu", async () => {
    await renderPanel([SLOT_A]);
    const row = (await screen.findByText("Baner glowny")).closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText("adsAdmin.kinds.html")).toBeInTheDocument();
    expect(cells.getByText("adsAdmin.slots.statusActive")).toBeInTheDocument();
    expect(cells.getByText("adsAdmin.slots.consentRequired")).toBeInTheDocument();
    // Podsumowanie liczy PRAWDZIWY `parseAdTargeting`, nie atrapa.
    expect(cells.getByText("1 adsAdmin.summaryCategories")).toBeInTheDocument();
  });

  it("slot WSTRZYMANY i bez wymogu zgody czyta sie inaczej niz aktywny", async () => {
    // Te dwie kolumny to jedyne miejsce, w ktorym widac, ze kreacja NIE leci
    // albo ze leci bez zgody marketingowej - czyli dokladnie to, o co pyta
    // audyt RODO.
    await renderPanel([SLOT_B]);
    const row = (await screen.findByText("Pasek boczny")).closest("tr");
    const cells = within(row as HTMLElement);
    expect(cells.getByText("adsAdmin.slots.statusPaused")).toBeInTheDocument();
    expect(cells.getByText("adsAdmin.slots.consentNotRequired")).toBeInTheDocument();
    expect(cells.getByText("adsAdmin.summaryAll")).toBeInTheDocument();
  });

  it("BLAD odczytu listy konczy sie komunikatem, nie cicha pusta tabela", async () => {
    // Pusta tabela po odmowie RLS mowi „nie masz zadnych slotow" - redaktor
    // zaklada wtedy drugi slot o tej samej nazwie zamiast szukac przyczyny.
    db().setResponse("ad_slots", fail("permission denied for table ad_slots", "42501"));
    withCatalog();
    renderWithQueryClient(<SlotsPanel />);
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("permission denied for table ad_slots"),
    );
  });
});

describe("SlotsPanel - zapis", () => {
  it("PUSTA nazwa blokuje zapis i nic nie leci do bazy", async () => {
    await renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adsAdmin.slots.nameRequired"));
    expect(
      db()
        .chainsFor("ad_slots")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("sama SPACJA to nadal pusta nazwa", async () => {
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adsAdmin.slots.nameRequired"));
    expect(
      db()
        .chainsFor("ad_slots")
        .some((c) => c.has("insert")),
    ).toBe(false);
  });

  it("DODANIE slotu wysyla INSERT z domyslkami RODO i czysci formularz", async () => {
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja partnera" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));

    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const insert = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({
      name: "Kreacja partnera",
      kind: "html",
      status: "active",
      requires_consent: true,
    });
    // Po zapisie pole nazwy wraca do pustki - inaczej nastepne klikniecie
    // „Dodaj" zalozy drugi slot o tej samej nazwie.
    await waitFor(() => expect(screen.getByLabelText("adsAdmin.slots.fieldName")).toHaveValue(""));
  });

  it("po udanym zapisie lista jest CZYTANA PONOWNIE", async () => {
    // Bez ponownego odczytu nowy slot nie pojawia sie w tabeli, wiec redaktor
    // klika „Dodaj" jeszcze raz i robi duplikat.
    await renderPanel([]);
    const przed = db().chainsFor("ad_slots").length;
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja partnera" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .filter((c) => c.has("select")).length,
      ).toBeGreaterThan(przed - 1),
    );
  });

  it("ODMOWA bazy zostawia wpisane dane i pokazuje komunikat", async () => {
    // Gdyby formularz sie wyczyscil, redaktor stracilby tresc kreacji RAZEM
    // z informacja, ze zapis sie nie udal.
    db().setResponse("ad_slots", (chain) =>
      chain.has("insert")
        ? fail("duplicate key value violates unique constraint", "23505")
        : ok([]),
    );
    withCatalog();
    renderWithQueryClient(<SlotsPanel />);
    await screen.findByText("adsAdmin.slots.empty");
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja partnera" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint"),
    );
    expect(screen.getByLabelText("adsAdmin.slots.fieldName")).toHaveValue("Kreacja partnera");
  });

  it("po ODMOWIE zapisu przycisk WRACA do stanu klikalnego", async () => {
    // Blokada „w locie" chroni przed dubletem, ale musi sie zdejmowac takze na
    // sciezce bledu. Zostawiona wlaczona zamienia jedna odmowe bazy w trwale
    // zablokowany formularz - redaktor moze juz tylko przeladowac strone.
    db().setResponse("ad_slots", (chain) =>
      chain.has("insert") ? fail("nie udalo sie zapisac", "XX000") : ok([]),
    );
    withCatalog();
    renderWithQueryClient(<SlotsPanel />);
    await screen.findByText("adsAdmin.slots.empty");
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja partnera" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("nie udalo sie zapisac"));
    expect(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ })).not.toBeDisabled();
  });
});

describe("SlotsPanel - edycja", () => {
  it("EDYTUJ przenosi wiersz do formularza i zmienia naglowek na tryb edycji", async () => {
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.edit" }))[0]);
    expect(screen.getByLabelText("adsAdmin.slots.fieldName")).toHaveValue("Baner glowny");
    expect(screen.getByText("adsAdmin.slots.editTitle")).toBeInTheDocument();
  });

  it("zapis w trybie edycji idzie przez UPDATE ZAWEZONY do tego wiersza", async () => {
    // Brak `eq("id", ...)` przepisalby WSZYSTKIE sloty najemcy jedna trescia.
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.edit" }))[0]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Baner glowny v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.save/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const update = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("update"));
    expect(update?.argsOf("update")?.[0]).toMatchObject({ name: "Baner glowny v2" });
    expect(update?.argsOf("eq")).toEqual(["id", SLOT_A.id]);
  });

  it("ANULUJ wychodzi z trybu edycji i przywraca pusty szkic", async () => {
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.edit" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "adsAdmin.cancel" }));
    expect(screen.getByLabelText("adsAdmin.slots.fieldName")).toHaveValue("");
    expect(screen.getByText("adsAdmin.slots.addTitle")).toBeInTheDocument();
  });

  it("przycisk ANULUJ NIE ISTNIEJE przy dodawaniu nowego slotu", async () => {
    // Byloby to jedyne miejsce w formularzu, ktore niczego nie anuluje.
    await renderPanel([]);
    await screen.findByText("adsAdmin.slots.empty");
    expect(screen.queryByRole("button", { name: "adsAdmin.cancel" })).toBeNull();
  });

  it("edycja wczytuje TARGETING wiersza do edytora chipow", async () => {
    // Chip bez zaznaczenia oznaczalby, ze zapis edycji wyczysci zawezenie
    // kreacji i puscil ja na cala witryne.
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.edit" }))[0]);
    expect(await screen.findByRole("button", { name: "Unia" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("SlotsPanel - usuwanie", () => {
  it("POTWIERDZONE usuniecie kasuje TEN wiersz i melduje sukces", async () => {
    h.confirm.mockResolvedValue(true);
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.slots.deleteAction" }))[0]);
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("delete")),
      ).toBe(true),
    );
    const del = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("delete"));
    expect(del?.argsOf("eq")).toEqual(["id", SLOT_A.id]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminToasts.deleted");
  });

  it("dialog potwierdzenia jest OZNACZONY JAKO DESTRUKCYJNY", async () => {
    // To jedyny wizualny hamulec przed skasowaniem kreacji razem z jej
    // pozycjami; zwykly dialog „OK/Anuluj" klika sie odruchowo.
    h.confirm.mockResolvedValue(true);
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.slots.deleteAction" }))[0]);
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.confirm.mock.calls[0]![0]).toMatchObject({
      destructive: true,
      title: "adsAdmin.slots.deleteTitle",
      confirmLabel: "adsAdmin.deleteConfirm",
    });
  });

  it("ANULOWANE potwierdzenie NIE kasuje niczego", async () => {
    // Najwazniejszy przypadek calego pliku: pominiecie `await` przy dialogu
    // daje obiekt Promise, ktory jest zawsze prawdziwy - i kazde klikniecie
    // kosza kasuje slot mimo wcisnietego „Anuluj".
    h.confirm.mockResolvedValue(false);
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.slots.deleteAction" }))[0]);
    await waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(
      db()
        .chainsFor("ad_slots")
        .some((c) => c.has("delete")),
    ).toBe(false);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("ODMOWA usuniecia (np. przypieta pozycja) konczy sie komunikatem", async () => {
    h.confirm.mockResolvedValue(true);
    db().setResponse("ad_slots", (chain) =>
      chain.has("delete")
        ? fail('update or delete on table "ad_slots" violates foreign key constraint', "23503")
        : ok([SLOT_A]),
    );
    withCatalog();
    renderWithQueryClient(<SlotsPanel />);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.slots.deleteAction" }))[0]);
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith(
        'update or delete on table "ad_slots" violates foreign key constraint',
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("SlotsPanel - pola zalezne od rodzaju slotu", () => {
  it("HTML: pole tresci HTML jest, pola skryptu i grafiki NIE MA", async () => {
    await renderPanel([]);
    expect(screen.getByLabelText("adsAdmin.slots.fieldHtml")).toBeInTheDocument();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldScript")).toBeNull();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldImageUrl")).toBeNull();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldAlt")).toBeNull();
  });

  it("SKRYPT: pojawia sie pole skryptu, znika pole HTML", async () => {
    await renderPanel([]);
    fireEvent.change(selectKind(), { target: { value: "script" } });
    expect(await screen.findByLabelText("adsAdmin.slots.fieldScript")).toBeInTheDocument();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldHtml")).toBeNull();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldImageUrl")).toBeNull();
  });

  it("GRAFIKA: trzy pola obrazka naraz, bez pol kodu", async () => {
    await renderPanel([]);
    fireEvent.change(selectKind(), { target: { value: "image" } });
    expect(await screen.findByLabelText("adsAdmin.slots.fieldImageUrl")).toBeInTheDocument();
    expect(screen.getByLabelText("adsAdmin.slots.fieldClickUrl")).toBeInTheDocument();
    expect(screen.getByLabelText("adsAdmin.slots.fieldAlt")).toBeInTheDocument();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldHtml")).toBeNull();
    expect(screen.queryByLabelText("adsAdmin.slots.fieldScript")).toBeNull();
  });

  it("lista rodzajow pochodzi z mapy kluczy, nie z recznego wyliczenia", async () => {
    // `AD_SLOT_KIND_LABEL_KEYS` jest typowany na `Record<AdSlotKind, string>`:
    // nowy rodzaj bez etykiety sie nie skompiluje. Test pilnuje, ze formularz
    // czyta wlasnie te mape, wiec nowy rodzaj pojawi sie w nim sam.
    await renderPanel([]);
    expect(Array.from(selectKind().options).map((o) => o.value)).toEqual([
      "html",
      "script",
      "image",
    ]);
  });

  it("wybor rodzaju NIE kasuje wpisanej juz nazwy", async () => {
    // Przepiecie rodzaju w polowie wypelniania formularza to normalny ruch;
    // gubienie przy tym nazwy zmusza do przepisywania od nowa.
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja partnera" },
    });
    fireEvent.change(selectKind(), { target: { value: "image" } });
    expect(screen.getByLabelText("adsAdmin.slots.fieldName")).toHaveValue("Kreacja partnera");
  });

  it("wymiary przyjmuja liczby, a wyczyszczenie pola daje NULL, nie zero", async () => {
    // `0` w kolumnie szerokosci to realna szerokosc zero - kreacja znika.
    // `null` znaczy „bez wymuszonego rozmiaru" i to jest zamierzone.
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja" },
    });
    const width = screen.getByLabelText("adsAdmin.slots.fieldWidth");
    fireEvent.change(width, { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldHeight"), {
      target: { value: "250" },
    });
    fireEvent.change(width, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const payload = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.width).toBeNull();
    expect(payload.height).toBe(250);
  });

  it("przelacznik zgody marketingowej trafia do ladunku zapisu", async () => {
    // Wylaczenie zgody jest decyzja prawna; musi dojechac do kolumny, a nie
    // zostac w stanie komponentu.
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja bez zgody" },
    });
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const payload = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.requires_consent).toBe(false);
  });

  it("przelacznik statusu przestawia slot na `paused`", async () => {
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja wstrzymana" },
    });
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const payload = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.status).toBe("paused");
  });

  it("zaznaczenie kategorii w edytorze targetingu trafia do jsonb jako SLUGI", async () => {
    // Styk formularza z PRAWDZIWYM `TargetingEditor` i PRAWDZIWYM
    // `adTargetingToJson`: to jedyne miejsce, w ktorym widac, ze zawezenie
    // kreacji faktycznie dojezdza do kolumny.
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja zawezona" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Unia" }));
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("insert")),
      ).toBe(true),
    );
    const payload = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(payload.targeting).toEqual({ categorySlugs: ["unia-europejska"] });
  });
});

describe("SlotsPanel - dostepnosc", () => {
  it("formularz slotu nie ma strukturalnych naruszen dostepnosci", async () => {
    const { container } = await renderPanel([SLOT_A]);
    await screen.findByText("Baner glowny");
    const naruszenia = await axeViolations(container, {
      // Nazwa przycisku kosza ma nizej WLASNY przypadek (dawny defekt, dzis
      // naprawiony) - ta regula bylaby tu wylacznie duplikatem tamtego wpisu.
      "button-name": { enabled: false },
      // `select-name` mierzyloby TU ATRAPE, nie produkcje: Radiksowy Select
      // renderuje przycisk z `aria-haspopup`, a nasza atrapa - natywny
      // `<select>`. Ocena nazwy tej kontrolki nalezy do testow samego atomu
      // `components/ui/select`, nie do panelu.
      "select-name": { enabled: false },
      // `label` mierzyloby tu ATRAPE Radiksowego przelacznika: nasza atrapa
      // renderuje `<input type=checkbox>`, a produkcja `<button role=switch>` -
      // czyli kontrolke, ktorej ta regula w ogole nie dotyczy.
      label: { enabled: false },
      // Naglowek kolumny akcji ma nizej wlasny przypadek (dawny defekt, dzis
      // naprawiony).
      "empty-table-header": { enabled: false },
    });
    expect(naruszenia, summarize(naruszenia)).toEqual([]);
  });

  it("przycisk usuwania wiersza ma DOSTEPNA NAZWE", async () => {
    // CO BYLO ZLE. Kosz w wierszu listy byl `<Button>` z samym `<svg>` w srodku -
    // bez `aria-label`, bez tekstu ukrytego dla czytnika ekranu. axe-core
    // zglaszal `button-name`, a `getByRole("button", { name: "" })` w testach
    // wyzej dokumentowal ten sam brak od drugiej strony.
    //
    // JAKIE TO BYLO RYZYKO. To jest przycisk NIEODWRACALNY: kasuje slot razem
    // z przypietymi do niego pozycjami. Redaktor korzystajacy z czytnika ekranu
    // slyszal w wierszu dwa przyciski - „Edytuj" i przycisk bez nazwy - i nie
    // mial jak odroznic edycji od skasowania inaczej niz przez klikniecie. Ta
    // sama luka dotyczyla nawigacji klawiatura: lista fokusow czytala sie jako
    // „Edytuj, przycisk, Edytuj, przycisk".
    //
    // JAK NAPRAWIONE. Kosz ma `aria-label={t("adsAdmin.slots.deleteAction")}`
    // (klucz zalozony w `i18n-ads-admin` w PL i EN), wiec pozostale przypadki
    // w tym pliku szukaja go juz po nazwie, a nie po jej braku.
    const { container } = await renderPanel([SLOT_A]);
    await screen.findByText("Baner glowny");
    const naruszenia = await axeViolations(container);
    expect(naruszenia.map((v) => v.id)).not.toContain("button-name");
  });

  it("kolumna akcji ma NAZWE w naglowku tabeli", async () => {
    // CO BYLO ZLE. Ostatnia komorka `<thead>` byla `<th className="p-3"></th>` -
    // pusty naglowek. axe-core zglaszal `empty-table-header`.
    //
    // JAKIE TO BYLO RYZYKO. Czytnik ekranu w trybie tabeli zapowiada przy kazdej
    // komorce nazwe jej kolumny. Dla kolumny akcji zapowiadal PUSTKE, wiec
    // uzytkownik slyszal „Baner glowny, HTML, aktywny, ... , (cisza), przycisk" -
    // i nie wiedzial, ze wlasnie wszedl w kolumne z nieodwracalnym usuwaniem.
    // To ta sama luka, co brak nazwy przycisku kosza, tylko od strony nawigacji
    // po strukturze tabeli.
    //
    // JAK NAPRAWIONE. Naglowek niesie `adsAdmin.columnActions` w `sr-only` -
    // czytnik ekranu zapowiada „Akcje", a uklad tabeli zostaje bez zmian.
    const { container } = await renderPanel([SLOT_A]);
    await screen.findByText("Baner glowny");
    const naruszenia = await axeViolations(container, {
      "button-name": { enabled: false },
      "select-name": { enabled: false },
      label: { enabled: false },
    });
    expect(naruszenia.map((v) => v.id)).not.toContain("empty-table-header");
  });
});

// ---------------------------------------------------------------------------
// BRAKI i18n - NAPRAWIONE (dawne `it.fails`).
//
// Atrapa i18n oddaje KLUCZ zamiast tlumaczenia, wiec kazdy napis, ktory pojawil
// sie w drzewie po polsku, byl dowodem na literal wpisany wprost w kodzie
// panelu. Panel jest dwujezyczny (PL/EN) - te napisy widzial po polsku takze
// redaktor pracujacy po angielsku.
//
// JAK NAPRAWIONE: napisy przeniesione do `src/lib/i18n-ads-admin.ts` w OBU
// jezykach (`adsAdmin.edit`, `adsAdmin.cancel`, `adsAdmin.slots.empty`,
// `adsAdmin.slots.fieldKind`, `.fieldActive`, `.fieldRequiresConsent`,
// `.fieldImageUrl`, `.fieldScript`, `.sandboxHtmlHint`, `.sandboxScriptHint`),
// a panel wola je przez `t()`. Przypadki nizej pilnuja, ze zaden z tych
// literalow nie wrocil do drzewa.
// ---------------------------------------------------------------------------
describe("SlotsPanel - braki i18n (naprawione)", () => {
  it("etykieta przycisku EDYCJI pochodzi ze slownika", async () => {
    await renderPanel([SLOT_A]);
    await screen.findByText("Baner glowny");
    expect(screen.queryByRole("button", { name: "Edytuj" })).toBeNull();
  });

  it("etykieta przycisku ANULUJ pochodzi ze slownika", async () => {
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.edit" }))[0]);
    expect(screen.queryByRole("button", { name: "Anuluj" })).toBeNull();
  });

  it("komunikat o pustej liscie pochodzi ze slownika", async () => {
    await renderPanel([]);
    await waitFor(() => expect(db().chainsFor("ad_slots").length).toBeGreaterThan(0));
    expect(screen.queryByText("Brak slotów. Dodaj pierwszy poniżej.")).toBeNull();
  });

  it("etykiety pol formularza pochodza ze slownika", async () => {
    // „Typ", „Aktywny", „Wymaga zgody marketingowej (RODO)", „URL grafiki",
    // „Skrypt (np. AdSense)" - piec literalow w jednym formularzu.
    await renderPanel([]);
    await waitFor(() => expect(db().chainsFor("ad_slots").length).toBeGreaterThan(0));
    expect(screen.queryByText("Typ")).toBeNull();
    expect(screen.queryByText("Aktywny")).toBeNull();
    expect(screen.queryByText("Wymaga zgody marketingowej (RODO)")).toBeNull();
  });

  it("toast po zapisie slotu pochodzi ze slownika", async () => {
    // Usuniecie meldowalo sie przez `adminToast.deleted()` (slownik), a zapis -
    // literalem „Zapisano slot": dwa rozne mechanizmy w jednej funkcji. Zapis
    // idzie teraz przez `adminToast.saved()`, tak jak sasiednie wywolanie.
    await renderPanel([]);
    fireEvent.change(screen.getByLabelText("adsAdmin.slots.fieldName"), {
      target: { value: "Kreacja partnera" },
    });
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.slots\.addAction/ }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalledWith("Zapisano slot");
  });
});

// ---------------------------------------------------------------------------
// DEFEKT KONTRAKTU ZAPISU - NAPRAWIONY (dawny `it.fails`).
// ---------------------------------------------------------------------------
describe("SlotsPanel - kontrakt ladunku UPDATE", () => {
  it("ladunek edycji nie niesie kolumn zarzadzanych przez baze", async () => {
    // CO BYLO ZLE. „Edytuj" wklada do szkicu CALY wiersz odczytany z bazy
    // (`setDraft(s)`), a zapis wysylal `{ ...draft }` jako ladunek `update`.
    // Do bazy wracalo wiec takze `id`, `tenant_id`, `created_at` i - co
    // najgorsze - `updated_at` sprzed edycji.
    //
    // JAKIE TO BYLO RYZYKO. `updated_at` przestawal znaczyc „kiedy ostatnio
    // zmieniono": wiersz zapisany dzis wracal ze znacznikiem sprzed tygodnia.
    // Kazdy odczyt sortujacy albo cache'ujacy po `updated_at` (a tak dziala
    // wiekszosc warstw emisji i podgladow) widzial kreacje jako niezmieniona.
    // `tenant_id` w ladunku to dodatkowo zapis kolumny rozdzielajacej najemcow -
    // przechodzil tylko dlatego, ze wartosc byla ta sama, ktora juz tam stoi.
    //
    // JAK NAPRAWIONE. `SlotsPanel.payloadOf()` sklada ladunek z BIALEJ LISTY
    // kolumn edytowalnych, wiec `id`, `tenant_id`, `created_at` i `updated_at`
    // zostaja po stronie bazy - takze przy zapisie z trybu edycji.
    await renderPanel([SLOT_A]);
    fireEvent.click((await screen.findAllByRole("button", { name: "adsAdmin.edit" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: /adsAdmin\.save/ }));
    await waitFor(() =>
      expect(
        db()
          .chainsFor("ad_slots")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const payload = db()
      .chainsFor("ad_slots")
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain("updated_at");
  });
});
