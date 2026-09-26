// Organizm „Nowa edycja z poprzedniej" - szkic, podgląd na żywo i zapis.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. SZKIC Z WŁASNYMI DOMYŚLNYMI. Formularz ma startować z przełączników
//      i terminu oddanych przez bazę; własne domyślne rozjechałyby się
//      z `_event_clone_settings` przy pierwszej zmianie.
//   2. PODGLĄD NIE WIDZI SZKICU. Zmiana adresu, strefy czy przełącznika musi
//      trafić do `admin_event_clone_preview` - inaczej daty i blokady na
//      ekranie dotyczą innego klonu niż ten, który powstanie.
//   3. OPCJA WYŁĄCZONEJ SEKCJI. „Sesje jako szkice" bez agendy to kontrolka
//      bez skutku - ma zniknąć razem z sekcją.
//   4. ZAPIS MIMO BLOKADY. Sesje poza nowym terminem albo zajęty adres mają
//      zatrzymać zapis PRZED bazą; brakujący tytuł - tak samo.
//   5. ŁADUNEK INNY NIŻ SZKIC. Zapis ma oddać wejście złożone z TEGO szkicu
//      (przycięte, z opcjami CRM), bez klucza idempotencji - ten dokłada ekran.
//
// Radix Select i kalendarz nie działają pod happy-dom bez pełnego API
// wskaźnika - mają natywne odpowiedniki. Przełączniki (Radix Switch) są
// prawdziwe, bo są zwykłymi przyciskami `role="switch"`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { freezeClock } from "@/test/time";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import { CLONE_SOURCE_ID, clonePreview } from "@/test/events/eventCloneFixtures";
import type { EventClonePreview } from "@/lib/events/eventCloneApi";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-clone", () => ({ ensureCloneI18n: () => undefined }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/components/atoms/FormSelect", () => ({
  FormSelect: ({
    id,
    value,
    options,
    onValueChange,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: ReactNode }[];
    onValueChange: (value: string) => void;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {String(option.label)}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/components/ui/datetime-picker", () => ({
  DateTimePicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string | null;
    onChange: (iso: string | null) => void;
  }) => (
    <input
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    />
  ),
}));

const { EventCloneForm } = await import("@/components/admin/events/organisms/EventCloneForm");

freezeClock();

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  // Podgląd odpowiada na szkic: zajęty slug -> blokada, strefa -> strefa celu.
  h.rpc.setResponse("admin_event_clone_preview", (call) => {
    const payload = call.arg("p_payload") as Record<string, unknown>;
    const base = clonePreview();
    return {
      data: {
        target: {
          starts_at: payload.starts_at ?? null,
          timezone: payload.timezone ?? "Europe/Warsaw",
          slug: payload.slug ?? "kongres-2027-z-bazy",
        },
        shift: { day_shift: 364 },
        warnings: [],
        blockers: payload.slug === "zajety" ? [{ code: "slug_taken", count: 1 }] : [],
        not_copied: {},
        dates: {},
        counts: base.counts,
      },
      error: null,
    };
  });
});
afterEach(() => cleanup());

function mount(overrides: Partial<EventClonePreview> = {}, props: Partial<Parameters<typeof EventCloneForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const onDraftChange = vi.fn();
  const utils = renderWithQueryClient(
    <EventCloneForm
      source={clonePreview(overrides)}
      isSaving={false}
      onCancel={onCancel}
      onSubmit={onSubmit}
      onDraftChange={onDraftChange}
      {...props}
    />,
  );
  return { ...utils, onSubmit, onCancel, onDraftChange };
}

function lastPreviewPayload(): Record<string, unknown> {
  return h.rpc!.lastCall("admin_event_clone_preview")?.arg("p_payload") as Record<string, unknown>;
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /adminEventClone.actions.submit/ }));
}

describe("EventCloneForm - szkic startowy", () => {
  it("tytuły z podbitym rokiem, termin i przełączniki z bazy, karta źródła, liczniki w podpowiedziach", async () => {
    const { container, onDraftChange } = mount();
    expect(screen.getByLabelText("adminEventClone.fields.titlePl")).toHaveValue("Kongres 2027");
    expect(screen.getByLabelText("adminEventClone.fields.titleEn")).toHaveValue("Congress 2027");
    expect(screen.getByLabelText("adminEventClone.fields.startsAt")).toHaveValue("2100-03-20T08:00:00.000Z");
    expect(screen.getByLabelText("adminEventClone.fields.timezone")).toHaveValue("Europe/Warsaw");
    expect(screen.getByRole("switch", { name: "adminEventClone.include.labels.agenda" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "adminEventClone.include.labels.codes" })).not.toBeChecked();
    expect(screen.getByText("Kongres 2026")).toBeInTheDocument();
    expect(screen.getByText(/adminEventClone\.status\.published/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "adminEventClone.source.open" })).toHaveAttribute(
      "href",
      `/admin/events/${CLONE_SOURCE_ID}/overview`,
    );
    // Podpowiedź sekcji niesie liczniki źródła (sale 2, ścieżki 1, sesje 4),
    // a brak licznika to zero, nie pustka.
    expect(
      screen.getByText(
        /adminEventClone\.include\.hints\.agenda adminEventClone\.count\(count=2,label=adminEventClone\.items\.rooms\) · .*count=1.*tracks.* · .*count=4.*sessions/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/include\.hints\.homeAds adminEventClone\.count\(count=0/)).toBeInTheDocument();
    expect(screen.getByText("adminEventClone.crm.renewalTasksHint(count=2)")).toBeInTheDocument();
    // Podgląd na żywo z propozycją adresu z bazy.
    await waitFor(() =>
      expect(screen.getByText("adminEventClone.fields.slugHint(slug=kongres-2027-z-bazy)")).toBeInTheDocument(),
    );
    expect(lastPreviewPayload()).toMatchObject({
      source_event_id: CLONE_SOURCE_ID,
      title_pl: "Kongres 2027",
      starts_at: "2100-03-20T08:00:00.000Z",
      timezone: "Europe/Warsaw",
    });
    expect(onDraftChange).toHaveBeenCalledWith(expect.objectContaining({ titlePl: "Kongres 2027" }));
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("zanim przyjdzie podgląd, podpowiedź adresu bierze slug z podglądu źródła", () => {
    h.rpc!.setResponse("admin_event_clone_preview", () => new Promise(() => {}) as never);
    mount();
    expect(screen.getByText("adminEventClone.fields.slugHint(slug=kongres-2027)")).toBeInTheDocument();
  });
});

describe("EventCloneForm - edycja szkicu trafia do podglądu", () => {
  it("adres, koniec i strefa jadą do podglądu; koniec ma minimum = początek", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.slug"), { target: { value: "Moj-Adres" } });
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.endsAt"), {
      target: { value: "2100-03-22T17:00:00.000Z" },
    });
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.timezone"), {
      target: { value: "Europe/London" },
    });
    await waitFor(
      () =>
        expect(lastPreviewPayload()).toMatchObject({
          slug: "moj-adres",
          ends_at: "2100-03-22T17:00:00.000Z",
          timezone: "Europe/London",
        }),
      { timeout: 3000 },
    );
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.titleEn"), { target: { value: "C 2027" } });
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.startsAt"), { target: { value: "" } });
    await waitFor(() => expect(lastPreviewPayload()).not.toHaveProperty("starts_at"), { timeout: 3000 });
    expect(lastPreviewPayload()).toMatchObject({ title_en: "C 2027" });
  });

  it("wyłączona sekcja chowa swoje opcje; bez sekcji z opcjami znika cała grupa", async () => {
    mount();
    expect(screen.getByRole("switch", { name: "adminEventClone.options.labels.sessionsAsDraft" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.include.labels.agenda" }));
    expect(screen.queryByRole("switch", { name: "adminEventClone.options.labels.sessionsAsDraft" })).toBeNull();
    expect(
      screen.queryByRole("switch", { name: "adminEventClone.options.labels.includeCancelledSessions" }),
    ).toBeNull();
    expect(screen.getByRole("switch", { name: "adminEventClone.crm.refreshSnapshots" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.include.labels.sponsors" }));
    expect(screen.queryByRole("switch", { name: "adminEventClone.crm.refreshSnapshots" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.include.labels.tickets" }));
    expect(screen.getByText("adminEventClone.options.title")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.include.labels.cfp" }));
    expect(screen.queryByText("adminEventClone.options.title")).toBeNull();
    await waitFor(
      () =>
        expect(lastPreviewPayload().include).toMatchObject({
          agenda: false,
          sponsors: false,
          tickets: false,
          cfp: false,
        }),
      { timeout: 3000 },
    );
  });

  it("opcje i CRM: przełącznik opcji, odświeżenie migawek, zadania z terminem", async () => {
    mount();
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.options.labels.keepAccessCodes" }));
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.crm.refreshSnapshots" }));
    expect(screen.queryByLabelText("adminEventClone.crm.dueDays")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.crm.renewalTasks" }));
    fireEvent.change(screen.getByLabelText("adminEventClone.crm.dueDays"), { target: { value: "14" } });
    await waitFor(
      () =>
        expect(lastPreviewPayload().options).toMatchObject({
          keep_access_codes: true,
          refresh_sponsor_snapshots: false,
          crm_renewal_tasks: true,
          crm_task_due_days: 14,
        }),
      { timeout: 3000 },
    );
  });

  it("kody: pole przyrostka pojawia się z sekcją, podpowiedź pokazuje przyrostek wielkimi literami", () => {
    mount();
    expect(screen.queryByLabelText("adminEventClone.options.codeSuffix")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.include.labels.codes" }));
    const suffix = screen.getByLabelText("adminEventClone.options.codeSuffix");
    expect(suffix).toHaveValue("-2100");
    fireEvent.change(suffix, { target: { value: "-x27" } });
    expect(screen.getByText("adminEventClone.options.codeSuffixHint(suffix=-X27)")).toBeInTheDocument();
  });

  it("źródło z zapisami zewnętrznymi: pole adresu; zmieniony adres jedzie do bazy", async () => {
    const base = clonePreview();
    mount({
      source: { ...base.source, registrationMode: "external", externalRegistrationUrl: "https://t.example.org/26" },
    });
    const url = screen.getByLabelText("adminEventClone.fields.externalUrl");
    expect(url).toHaveValue("https://t.example.org/26");
    fireEvent.change(url, { target: { value: "https://t.example.org/27" } });
    await waitFor(
      () => expect(lastPreviewPayload()).toMatchObject({ external_registration_url: "https://t.example.org/27" }),
      { timeout: 3000 },
    );
  });

  it("zwykłe źródło nie ma pola adresu zapisów", () => {
    mount();
    expect(screen.queryByLabelText("adminEventClone.fields.externalUrl")).toBeNull();
  });
});

describe("EventCloneForm - zapis", () => {
  it("poprawny szkic: onSubmit dostaje wejście TEGO szkicu, bez klucza idempotencji", () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.titlePl"), {
      target: { value: "  Kongres Jubileuszowy 2027 " },
    });
    submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const input = onSubmit.mock.calls[0][0];
    expect(input).toMatchObject({
      sourceEventId: CLONE_SOURCE_ID,
      titlePl: "Kongres Jubileuszowy 2027",
      startsAt: "2100-03-20T08:00:00.000Z",
      include: clonePreview().include,
    });
    expect(input).not.toHaveProperty("idempotencyKey");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("odmowa po próbie: brak tytułu, zły termin zadań - bez wywołania onSubmit", () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.titlePl"), { target: { value: " " } });
    expect(screen.queryByText("adminEventClone.issues.titles")).toBeNull();
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("adminEventClone.issues.titles");
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.titlePl"), { target: { value: "Kongres 2027" } });
    fireEvent.click(screen.getByRole("switch", { name: "adminEventClone.crm.renewalTasks" }));
    fireEvent.change(screen.getByLabelText("adminEventClone.crm.dueDays"), { target: { value: "0" } });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("adminEventClone.issues.dueDays");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blokada z podglądu (zajęty adres) zatrzymuje zapis zdaniem o blokadach", async () => {
    const { onSubmit } = mount();
    fireEvent.change(screen.getByLabelText("adminEventClone.fields.slug"), { target: { value: "zajety" } });
    await waitFor(
      () => expect(screen.getByText("adminEventClone.blockers.slugTaken(count=1)")).toBeInTheDocument(),
      { timeout: 3000 },
    );
    submit();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => within(alert).queryByText("adminEventClone.issues.blocked"))).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("zapis w toku gasi przycisk; Anuluj woła onCancel", () => {
    const { onCancel } = mount({}, { isSaving: true });
    const button = screen.getByRole("button", { name: /adminEventClone.actions.submitting/ });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "adminEventClone.actions.cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("bez onDraftChange formularz działa (raport w górę jest opcjonalny)", () => {
    renderWithQueryClient(
      <EventCloneForm source={clonePreview()} isSaving={false} onCancel={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByLabelText("adminEventClone.fields.titlePl")).toHaveValue("Kongres 2027");
  });
});
