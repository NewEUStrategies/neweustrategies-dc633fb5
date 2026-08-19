// Trasa `/admin/contact` - centrum kontaktu (skrzynka formularza + ustawienia
// wysyłki). Skrzynka trzyma treści przysłane przez ludzi z zewnątrz: imię,
// e-mail, telefon, firma, treść wiadomości i zgoda na newsletter. Test montuje
// PRAWDZIWĄ trasę i sprawdza reguły, których złamanie widzi tylko operator:
// który filtr idzie do zapytania, że otwarcie wiadomości oznacza ją jako
// przeczytaną, że kasowanie wymaga potwierdzenia i że ustawienia zapisują się
// razem z identyfikatorem tenanta.
//
// Zamockowana jest wyłącznie granica sieci (klient Supabase). Dane syntetyczne.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderRoute } from "@/test/routeHarness";
import { ok, fail, type RecordedChain } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  messages: [] as unknown[],
  settings: null as unknown,
  session: { user: { id: "u1" } } as unknown,
  profile: { tenant_id: "tenant-1" } as unknown,
  settingsFails: false,
  toastError: [] as string[],
  toastSuccess: [] as string[],
  lang: "pl",
}));

const stub = vi.hoisted(() => {
  return { current: null as unknown };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const s = supabaseFromStub();
  stub.current = s;
  return {
    supabase: {
      from: (table: string) => s.from(table),
      auth: {
        getSession: async () => ({ data: { session: h.session }, error: null }),
      },
    },
  };
});
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError.push(m),
    success: (m: string) => h.toastSuccess.push(m),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: h.lang }, t: (k: string) => k }),
}));

import { Route } from "@/routes/admin.contact";
import type { SupabaseFromStub } from "@/test/supabaseChain";

const chainStub = () => stub.current as SupabaseFromStub;

const message = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  name: "Anna Kowalska",
  email: "anna@example.test",
  phone: "+48 500 100 200",
  company: "Acme",
  subject: "Zapytanie o współpracę",
  message: "Proszę o kontakt w sprawie projektu.",
  lang: "pl",
  status: "new",
  created_at: "2026-08-10T10:00:00.000Z",
  read_at: null,
  archived_at: null,
  newsletter_opt_in: true,
  recipient: "biuro@example.test",
  source: "formularz",
  confirmation_sent_at: null,
  ...over,
});

const settings = (over: Record<string, unknown> = {}) => ({
  tenant_id: "tenant-1",
  default_recipient: "biuro@example.test",
  auto_reply_enabled: true,
  auto_reply_subject_pl: "Dziękujemy",
  auto_reply_subject_en: "Thank you",
  auto_reply_body_pl: "Odpowiemy wkrótce.",
  auto_reply_body_en: "We will reply soon.",
  notify_admin_enabled: true,
  notify_admin_subject_pl: "Nowa wiadomość",
  notify_admin_subject_en: "New message",
  from_address: "no-reply@example.test",
  from_name: "NES",
  newsletter_double_optin: true,
  ...over,
});

const mount = () =>
  renderRoute({ route: Route, path: "/admin/contact", initialEntry: "/admin/contact" });

/** Radix aktywuje zakładkę na `mousedown`, nie na `click`. */
const openTab = async (name: string) => {
  fireEvent.mouseDown(await screen.findByRole("tab", { name }));
};

const lastMessagesChain = () => chainStub().lastChain("contact_messages") as RecordedChain;

beforeEach(() => {
  h.messages = [];
  h.settings = null;
  h.session = { user: { id: "u1" } };
  h.profile = { tenant_id: "tenant-1" };
  h.settingsFails = false;
  h.toastError = [];
  h.toastSuccess = [];
  h.lang = "pl";
  const s = chainStub();
  s.reset();
  s.setResponse("contact_messages", (chain) =>
    chain.has("update") || chain.has("delete") ? ok(null) : ok(h.messages),
  );
  s.setResponse("contact_form_settings", () =>
    h.settingsFails ? fail("zapis odrzucony") : ok(h.settings),
  );
  s.setResponse("profiles", () => ok(h.profile));
});

afterEach(() => cleanup());

describe("centrum kontaktu - skrzynka", () => {
  it("panel nie idzie do indeksu wyszukiwarek", async () => {
    const view = await mount();
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex" });
  });

  it("domyślnie pyta o nieprzeczytane i niearchiwalne", async () => {
    await mount();
    await waitFor(() => expect(chainStub().chainsFor("contact_messages").length).toBeGreaterThan(0));
    const chain = lastMessagesChain();
    expect(chain.calls.filter((c) => c.method === "is").map((c) => c.args)).toEqual([
      ["read_at", null],
      ["archived_at", null],
    ]);
  });

  it("filtr „Archiwum” pyta o wiadomości z datą archiwizacji", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Archiwum" }));
    await waitFor(() => expect(lastMessagesChain().has("not")).toBe(true));
    expect(lastMessagesChain().argsOf("not")).toEqual(["archived_at", "is", null]);
  });

  it("filtr „Wszystkie” nie zawęża zapytania", async () => {
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: "Wszystkie" }));
    await waitFor(() => expect(lastMessagesChain().has("is")).toBe(false));
    expect(lastMessagesChain().has("not")).toBe(false);
  });

  it("pusta skrzynka mówi wprost, że nic nie przyszło", async () => {
    await mount();
    expect(await screen.findByText("Brak wiadomości.")).toBeInTheDocument();
    expect(screen.getByText("Wybierz wiadomość z listy.")).toBeInTheDocument();
  });

  it("wiersz pokazuje temat, nadawcę i zajawkę treści", async () => {
    h.messages = [message()];
    await mount();
    expect(await screen.findByText("Zapytanie o współpracę")).toBeInTheDocument();
    expect(screen.getByText(/anna@example.test/)).toBeInTheDocument();
    expect(screen.getByText(/Proszę o kontakt/)).toBeInTheDocument();
  });

  it("wiadomość bez tematu pokazuje nadawcę zamiast pustej linii", async () => {
    h.messages = [message({ subject: null })];
    await mount();
    fireEvent.click(await screen.findByText("Anna Kowalska"));
    expect(await screen.findByText("(brak tematu)")).toBeInTheDocument();
  });

  it("wyszukiwarka filtruje po nadawcy, temacie i treści - lokalnie", async () => {
    h.messages = [message(), message({ id: "m2", name: "Jan Nowak", email: "jan@example.test", subject: "Faktura" })];
    await mount();
    expect(await screen.findByText("Faktura")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Szukaj..."), { target: { value: "nowak" } });
    await waitFor(() => expect(screen.queryByText("Zapytanie o współpracę")).toBeNull());
    expect(screen.getByText("Faktura")).toBeInTheDocument();
  });

  it("otwarcie nieprzeczytanej wiadomości oznacza ją jako przeczytaną", async () => {
    h.messages = [message()];
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    await waitFor(() =>
      expect(
        chainStub()
          .chainsFor("contact_messages")
          .some((c) => c.has("update")),
      ).toBe(true),
    );
    const upd = chainStub()
      .chainsFor("contact_messages")
      .find((c) => c.has("update")) as RecordedChain;
    const patch = (upd.argsOf("update") as [Record<string, unknown>])[0];
    expect(patch.status).toBe("read");
    expect(typeof patch.read_at).toBe("string");
    expect(upd.argsOf("eq")).toEqual(["id", "m1"]);
  });

  it("wiadomość już przeczytana nie jest oznaczana ponownie", async () => {
    h.messages = [message({ read_at: "2026-08-11T10:00:00.000Z" })];
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    // Treść jest i w zajawce listy, i w szczegółach - obie pochodzą z bazy.
    expect((await screen.findAllByText(/Proszę o kontakt w sprawie projektu./)).length).toBe(2);
    expect(chainStub().chainsFor("contact_messages").some((c) => c.has("update"))).toBe(false);
  });

  it("szczegóły pokazują metadane zgłoszenia i zgodę na newsletter", async () => {
    h.messages = [message({ read_at: "2026-08-11T10:00:00.000Z", confirmation_sent_at: "2026-08-11T11:00:00.000Z" })];
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    expect(await screen.findByText(/Acme/)).toBeInTheDocument();
    expect(screen.getByText("Newsletter")).toBeInTheDocument();
    expect(screen.getByText("Potwierdzenie wysłane")).toBeInTheDocument();
    expect(screen.getByText("formularz")).toBeInTheDocument();
    expect(screen.getByText("PL")).toBeInTheDocument();
  });

  it("archiwizacja i przywrócenie ustawiają oraz zerują datę archiwizacji", async () => {
    h.messages = [message({ read_at: "2026-08-11T10:00:00.000Z" })];
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    fireEvent.click(await screen.findByRole("button", { name: /Archiwizuj/ }));
    await waitFor(() =>
      expect(chainStub().chainsFor("contact_messages").some((c) => c.has("update"))).toBe(true),
    );
    const first = chainStub().chainsFor("contact_messages").find((c) => c.has("update")) as RecordedChain;
    expect(typeof (first.argsOf("update") as [Record<string, unknown>])[0].archived_at).toBe("string");

    cleanup();
    chainStub().reset();
    chainStub().setResponse("contact_messages", (chain) =>
      chain.has("update") ? ok(null) : ok([message({ read_at: "x", archived_at: "2026-08-12T10:00:00.000Z" })]),
    );
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    fireEvent.click(await screen.findByRole("button", { name: /Przywróć/ }));
    await waitFor(() =>
      expect(chainStub().chainsFor("contact_messages").some((c) => c.has("update"))).toBe(true),
    );
    const back = chainStub().chainsFor("contact_messages").find((c) => c.has("update")) as RecordedChain;
    expect((back.argsOf("update") as [Record<string, unknown>])[0].archived_at).toBeNull();
  });

  it("zamknięcie wątku ustawia status done", async () => {
    h.messages = [message({ read_at: "2026-08-11T10:00:00.000Z" })];
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    fireEvent.click(await screen.findByRole("button", { name: /Zamknij/ }));
    await waitFor(() =>
      expect(chainStub().chainsFor("contact_messages").some((c) => c.has("update"))).toBe(true),
    );
    const chain = chainStub().chainsFor("contact_messages").find((c) => c.has("update")) as RecordedChain;
    expect((chain.argsOf("update") as [Record<string, unknown>])[0]).toEqual({ status: "done" });
  });

  it("kasowanie wiadomości wymaga potwierdzenia", async () => {
    h.messages = [message({ read_at: "2026-08-11T10:00:00.000Z" })];
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(confirmSpy).toHaveBeenCalledWith("Usunąć tę wiadomość?");
    expect(chainStub().chainsFor("contact_messages").some((c) => c.has("delete"))).toBe(false);

    confirmSpy.mockReturnValue(true as never);
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(chainStub().chainsFor("contact_messages").some((c) => c.has("delete"))).toBe(true),
    );
    expect(h.toastSuccess).toContain("Wiadomość usunięta.");
    vi.unstubAllGlobals();
  });

  it("odpowiedź prowadzi do klienta poczty z tematem w Re:", async () => {
    h.messages = [message({ read_at: "2026-08-11T10:00:00.000Z" })];
    await mount();
    fireEvent.click(await screen.findByText("Zapytanie o współpracę"));
    const link = await screen.findByRole("link", { name: /Odpowiedz/ });
    expect(link.getAttribute("href")).toBe(
      "mailto:anna@example.test?subject=Re: Zapytanie%20o%20wsp%C3%B3%C5%82prac%C4%99",
    );
  });

  it("odświeżenie ponawia zapytanie", async () => {
    await mount();
    await waitFor(() => expect(chainStub().chainsFor("contact_messages").length).toBe(1));
    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(chainStub().chainsFor("contact_messages").length).toBe(2));
  });
});

describe("centrum kontaktu - ustawienia", () => {
  it("formularz podnosi zapisane ustawienia z bazy", async () => {
    h.settings = settings();
    await mount();
    await openTab("Ustawienia");
    expect(await screen.findByDisplayValue("biuro@example.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Dziękujemy")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Odpowiemy wkrótce.")).toBeInTheDocument();
  });

  it("zapis dokleja identyfikator tenanta zalogowanego operatora", async () => {
    h.settings = settings();
    await mount();
    await openTab("Ustawienia");
    fireEvent.change(await screen.findByDisplayValue("biuro@example.test"), {
      target: { value: "kontakt@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz ustawienia" }));
    await waitFor(() =>
      expect(chainStub().chainsFor("contact_form_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    const chain = chainStub()
      .chainsFor("contact_form_settings")
      .find((c) => c.has("upsert")) as RecordedChain;
    const [payload, opts] = chain.argsOf("upsert") as [Record<string, unknown>, { onConflict: string }];
    expect(payload).toMatchObject({
      tenant_id: "tenant-1",
      default_recipient: "kontakt@example.test",
    });
    // Bez `onConflict` drugi zapis dorzuciłby DRUGI wiersz ustawień tenanta.
    expect(opts.onConflict).toBe("tenant_id");
    expect(h.toastSuccess).toContain("Zapisano.");
  });

  it("przełączniki zmieniają zapisywane flagi", async () => {
    h.settings = settings({ auto_reply_enabled: false, newsletter_double_optin: false });
    await mount();
    await openTab("Ustawienia");
    const switches = await screen.findAllByRole("switch");
    fireEvent.click(switches[1]);
    fireEvent.click(switches[2]);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz ustawienia" }));
    await waitFor(() =>
      expect(chainStub().chainsFor("contact_form_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    const chain = chainStub()
      .chainsFor("contact_form_settings")
      .find((c) => c.has("upsert")) as RecordedChain;
    const [payload] = chain.argsOf("upsert") as [Record<string, unknown>];
    expect(payload).toMatchObject({ auto_reply_enabled: true, newsletter_double_optin: true });
  });

  it("zapis obejmuje wszystkie pola szablonu - w obu językach", async () => {
    h.settings = settings();
    await mount();
    await openTab("Ustawienia");
    fireEvent.change(await screen.findByDisplayValue("NES"), { target: { value: "NES Bruksela" } });
    fireEvent.change(screen.getByDisplayValue("no-reply@example.test"), {
      target: { value: "kontakt@nes.test" },
    });
    fireEvent.change(screen.getByDisplayValue("Dziękujemy"), { target: { value: "Dziękujemy!" } });
    fireEvent.change(screen.getByDisplayValue("Odpowiemy wkrótce."), {
      target: { value: "Odpowiemy w 24 h." },
    });
    fireEvent.change(screen.getByDisplayValue("Thank you"), { target: { value: "Thanks!" } });
    fireEvent.change(screen.getByDisplayValue("We will reply soon."), {
      target: { value: "We reply within 24 h." },
    });
    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Zapisz ustawienia" }));
    await waitFor(() =>
      expect(chainStub().chainsFor("contact_form_settings").some((c) => c.has("upsert"))).toBe(true),
    );
    const chain = chainStub()
      .chainsFor("contact_form_settings")
      .find((c) => c.has("upsert")) as RecordedChain;
    expect((chain.argsOf("upsert") as [Record<string, unknown>])[0]).toMatchObject({
      from_name: "NES Bruksela",
      from_address: "kontakt@nes.test",
      auto_reply_subject_pl: "Dziękujemy!",
      auto_reply_body_pl: "Odpowiemy w 24 h.",
      auto_reply_subject_en: "Thanks!",
      auto_reply_body_en: "We reply within 24 h.",
      // Przełącznik startował włączony - klik ma go WYŁĄCZYĆ.
      notify_admin_enabled: false,
    });
  });

  it("błąd zapisu pokazuje komunikat, a nie cichą porażkę", async () => {
    h.settings = settings();
    await mount();
    await openTab("Ustawienia");
    await screen.findByDisplayValue("biuro@example.test");
    h.settingsFails = true;
    fireEvent.click(screen.getByRole("button", { name: "Zapisz ustawienia" }));
    await waitFor(() => expect(h.toastError).toContain("zapis odrzucony"));
  });

  it("brak sesji nie zapisuje niczego i mówi o tym operatorowi", async () => {
    h.settings = settings();
    h.session = null;
    await mount();
    await openTab("Ustawienia");
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz ustawienia" }));
    await waitFor(() => expect(h.toastError).toContain("Not signed in"));
    expect(chainStub().chainsFor("contact_form_settings").some((c) => c.has("upsert"))).toBe(false);
  });

  it("konto bez tenanta nie zapisuje ustawień w cudzej przestrzeni", async () => {
    h.settings = settings();
    h.profile = { tenant_id: null };
    await mount();
    await openTab("Ustawienia");
    fireEvent.click(await screen.findByRole("button", { name: "Zapisz ustawienia" }));
    await waitFor(() => expect(h.toastError).toContain("No tenant"));
    expect(chainStub().chainsFor("contact_form_settings").some((c) => c.has("upsert"))).toBe(false);
  });

  it("wersja angielska ma komplet etykiet skrzynki i ustawień", async () => {
    h.lang = "en";
    h.settings = settings();
    await mount();
    expect(await screen.findByText("Contact Center")).toBeInTheDocument();
    expect(await screen.findByText("No messages.")).toBeInTheDocument();
    expect(screen.getByText("Pick a message from the list.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unread" })).toBeInTheDocument();
    await openTab("Settings");
    expect(await screen.findByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText("Auto-reply")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save settings" })).toBeInTheDocument();
  });
});
