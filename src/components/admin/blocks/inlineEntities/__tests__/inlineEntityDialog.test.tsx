// Okno wstawiania / edycji encji inline: dane z CRM i z profilu autora trafiają
// do KOPII w materiale, edycja pokazuje liczbę wystąpień, a zapis woła najpierw
// wstawienie odwołania, potem rejestr (kolejność chroni przed nadpisaniem).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { InlineEntity } from "@/lib/blocks/inlineEntities/model";
import { company, person } from "@/lib/blocks/inlineEntities/__tests__/fixtures";
import type { AuthorRow, CrmCompanyRow } from "@/lib/blocks/inlineEntities/sources";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";

realT("pl");

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const lookups = vi.hoisted(() => ({
  lookupCrmCompanies: vi.fn<(q: { q?: string; id?: string }) => Promise<CrmCompanyRow[]>>(),
  lookupAuthors: vi.fn<(q: { q?: string; id?: string }) => Promise<AuthorRow[]>>(),
}));
vi.mock("@/lib/blocks/inlineEntities/sources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blocks/inlineEntities/sources")>()),
  ...lookups,
}));

// Pole obrazu ma własne testy (wgrywanie, kadrowanie) - tu tylko jego kontrakt.
vi.mock("../InlineEntityImageField", () => ({
  InlineEntityImageField: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (v: { src: string } | null) => void;
  }) => (
    <button type="button" onClick={() => onChange({ src: "https://cdn.example.com/new.webp" })}>
      {`image:${label}`}
    </button>
  ),
}));

const { InlineEntityDialog } = await import("../InlineEntityDialog");

const CRM_ROW: CrmCompanyRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme Energy",
  country: "Polska",
  branch: "Energetyka",
  specialization: "Magazyny energii",
  website: "acme.example.com",
  domain: null,
  logo_url: "https://cdn.example.com/acme.png",
  social_links: { linkedin: "https://linkedin.com/company/acme" },
};
const AUTHOR_ROW: AuthorRow = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "anna-nowak",
  first_name: "Anna",
  last_name: "Nowak",
  display_name: "Anna Nowak",
  job_title: "Analityczka",
  company: "NES",
  website_url: null,
  linkedin_url: null,
  x_url: null,
  facebook_url: null,
  instagram_url: null,
  avatar_url: null,
  specialization: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Props = Parameters<typeof InlineEntityDialog>[0];

function open(props: Partial<Props> & Pick<Props, "request">) {
  const onClose = vi.fn();
  const onSave = vi.fn<(e: InlineEntity) => void>();
  render(
    <InlineEntityDialog
      entities={{}}
      usage={new Map()}
      lang="pl"
      onClose={onClose}
      onSave={onSave}
      {...props}
    />,
    { wrapper },
  );
  return { onClose, onSave };
}

beforeEach(() => {
  lookups.lookupCrmCompanies.mockReset();
  lookups.lookupAuthors.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("InlineEntityDialog - create", () => {
  it("renders nothing without a request", () => {
    const { container } = render(
      <InlineEntityDialog
        request={null}
        entities={{}}
        usage={new Map()}
        lang="pl"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
      { wrapper },
    );
    expect(container.textContent).toBe("");
  });

  it("creates a manual company: inserts the reference first, then saves the copy", () => {
    const onSaved = vi.fn();
    const { onSave, onClose } = open({
      request: { mode: "create", kind: "company", prefillName: "Orlen", onSaved },
    });
    expect(screen.getByRole("heading", { name: "Nowa firma w tekście" })).toBeTruthy();
    expect((screen.getByLabelText("Nazwa firmy") as HTMLInputElement).value).toBe("Orlen");
    fireEvent.change(screen.getByLabelText("Kraj pochodzenia"), { target: { value: "Polska" } });
    fireEvent.change(screen.getByLabelText("Strona www"), { target: { value: "orlen.pl" } });
    fireEvent.change(screen.getAllByLabelText("PL")[0], { target: { value: "Paliwa" } });
    fireEvent.change(screen.getAllByLabelText("EN")[0], { target: { value: "Fuels" } });
    fireEvent.change(screen.getAllByLabelText("PL")[1], { target: { value: "Rafinacja" } });
    fireEvent.change(screen.getByLabelText("LinkedIn"), {
      target: { value: "linkedin.com/company/orlen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "image:Logo" }));
    fireEvent.click(screen.getByRole("button", { name: "Wstaw w tekst" }));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({
      kind: "company",
      name: "Orlen",
      country: { code: "PL", pl: "Polska", en: "Poland" },
      industry: { pl: "Paliwa", en: "Fuels" },
      specialization: { pl: "Rafinacja", en: "" },
      website: "https://orlen.pl/",
      socials: { linkedin: "https://linkedin.com/company/orlen" },
      image: { src: "https://cdn.example.com/new.webp" },
      source: { type: "manual" },
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(onSaved.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0]);
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("refuses to save a nameless entity", () => {
    const { onSave } = open({ request: { mode: "create", kind: "company", onSaved: vi.fn() } });
    fireEvent.click(screen.getByRole("button", { name: "Wstaw w tekst" }));
    expect(screen.getByRole("alert").textContent).toBe("Podaj nazwę firmy.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("switches to a person and splits the prefilled name", () => {
    const { onSave } = open({
      request: { mode: "create", kind: "company", prefillName: "Maya Chen", onSaved: vi.fn() },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Osoba" }));
    expect(screen.getByRole("heading", { name: "Nowa osoba w tekście" })).toBeTruthy();
    expect((screen.getByLabelText("Imię") as HTMLInputElement).value).toBe("Maya");
    expect((screen.getByLabelText("Nazwisko") as HTMLInputElement).value).toBe("Chen");
    fireEvent.change(screen.getByLabelText("Firma"), { target: { value: "Northwind" } });
    fireEvent.change(screen.getByLabelText("Strona zewnętrzna"), { target: { value: "maya.dev" } });
    fireEvent.change(screen.getByLabelText("PL"), { target: { value: "Dyrektorka" } });
    fireEvent.click(screen.getByRole("radio", { name: "Osoba" }));
    fireEvent.click(screen.getByRole("button", { name: "Wstaw w tekst" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      kind: "person",
      firstName: "Maya",
      lastName: "Chen",
      company: "Northwind",
      position: { pl: "Dyrektorka", en: "" },
      website: "https://maya.dev/",
    });
  });

  it("rejects a person without any name", () => {
    const { onSave } = open({ request: { mode: "create", kind: "person", onSaved: vi.fn() } });
    fireEvent.click(screen.getByRole("button", { name: "Wstaw w tekst" }));
    expect(screen.getByRole("alert").textContent).toBe("Podaj imię lub nazwisko.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("pulls a company from CRM into the form", async () => {
    lookups.lookupCrmCompanies.mockResolvedValue([
      CRM_ROW,
      { ...CRM_ROW, id: "x", logo_url: null, branch: null },
    ]);
    const { onSave } = open({ request: { mode: "create", kind: "company", onSaved: vi.fn() } });
    fireEvent.change(screen.getByLabelText("Szukaj w CRM"), { target: { value: "acm" } });
    const hit = await screen.findAllByRole("button", { name: /Acme Energy/ });
    fireEvent.click(hit[0]);
    expect((screen.getByLabelText("Nazwa firmy") as HTMLInputElement).value).toBe("Acme Energy");
    expect((screen.getByLabelText("Kraj pochodzenia") as HTMLInputElement).value).toBe("Polska");
    expect(screen.getByText("Źródło: CRM")).toBeTruthy();
    expect(lookups.lookupCrmCompanies).toHaveBeenCalledWith({ q: "acm" }, expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Wstaw w tekst" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: "Acme Energy",
      specialization: { pl: "Magazyny energii" },
      image: { src: "https://cdn.example.com/acme.png" },
      source: { type: "crm", id: CRM_ROW.id },
    });
  });

  it("pulls a person from author profiles", async () => {
    lookups.lookupAuthors.mockResolvedValue([
      AUTHOR_ROW,
      { ...AUTHOR_ROW, id: "y", avatar_url: "https://cdn.example.com/a.jpg" },
    ]);
    const { onSave } = open({ request: { mode: "create", kind: "person", onSaved: vi.fn() } });
    fireEvent.change(screen.getByLabelText("Szukaj wśród autorów"), { target: { value: "ann" } });
    const hits = await screen.findAllByRole("button", { name: /Anna Nowak/ });
    fireEvent.click(hits[0]);
    expect(screen.getByText("Źródło: profil autora")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Wstaw w tekst" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      firstName: "Anna",
      lastName: "Nowak",
      company: "NES",
      source: { type: "author", slug: "anna-nowak" },
    });
  });

  it("reports empty and failed searches", async () => {
    lookups.lookupCrmCompanies.mockResolvedValueOnce([]);
    open({ request: { mode: "create", kind: "company", onSaved: vi.fn() } });
    const search = screen.getByLabelText("Szukaj w CRM");
    fireEvent.change(search, { target: { value: "zz" } });
    expect(await screen.findByText("Brak wyników - uzupełnij dane ręcznie poniżej.")).toBeTruthy();
    lookups.lookupCrmCompanies.mockRejectedValueOnce(new Error("boom"));
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(await screen.findByText("Nie udało się wyszukać. Spróbuj ponownie.")).toBeTruthy();
  });

  it("offers entities already used in the material", () => {
    const onSaved = vi.fn();
    const { onSave, onClose } = open({
      request: { mode: "create", kind: "company", onSaved },
      entities: { [company().id]: company(), [person().id]: person() },
    });
    expect(screen.queryByRole("button", { name: "Użyj: Maya Chen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Użyj: Acme Energy" }));
    expect(onSaved).toHaveBeenCalledWith(company());
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("cancel closes without saving", () => {
    const { onSave, onClose } = open({
      request: { mode: "create", kind: "company", onSaved: vi.fn() },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("InlineEntityDialog - edit", () => {
  it("shows how many places the change affects and saves every occurrence", () => {
    const { onSave } = open({
      request: { mode: "edit", id: company().id },
      entities: { [company().id]: company() },
      usage: new Map([[company().id, 3]]),
    });
    expect(screen.getByRole("heading", { name: "Edytuj firmę" })).toBeTruthy();
    expect(
      screen.getByText("Użyta w materiale 3 razy - zmiany obejmą wszystkie miejsca jednocześnie."),
    ).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(screen.getByLabelText("Nazwa firmy"), { target: { value: "Acme Storage" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: company().id, name: "Acme Storage" });
    // Kraj bez zmian zostaje tym samym obiektem (bez ponownego rozpoznawania).
    expect(onSave.mock.calls[0][0]).toMatchObject({ country: company().country });
    expect(toast.success).toHaveBeenCalledWith(
      "Zapisano - zaktualizowano wszystkie wystąpienia w materiale.",
    );
  });

  it("refreshes from CRM on request, keeping the custom crop", async () => {
    lookups.lookupCrmCompanies.mockResolvedValueOnce([{ ...CRM_ROW, name: "Acme Energy SA" }]);
    open({
      request: { mode: "edit", id: company().id },
      entities: { [company().id]: company() },
    });
    fireEvent.click(screen.getByRole("button", { name: "Odśwież z CRM" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Nazwa firmy") as HTMLInputElement).value).toBe(
        "Acme Energy SA",
      ),
    );
    expect(lookups.lookupCrmCompanies).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Pobrano aktualne dane ze źródła - zapisz, aby zastosować.",
    );
    lookups.lookupCrmCompanies.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "Odśwież z CRM" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się pobrać danych ze źródła."),
    );
  });

  it("refreshes a person from the author profile and can detach from the source", async () => {
    const author = person({
      source: { type: "author", id: AUTHOR_ROW.id, slug: "anna-nowak", syncedAt: "" },
    });
    lookups.lookupAuthors.mockResolvedValueOnce([AUTHOR_ROW]);
    const { onSave } = open({
      request: { mode: "edit", id: author.id },
      entities: { [author.id]: author },
      usage: new Map([[author.id, 1]]),
    });
    expect(screen.getByText("Użyta w materiale 1 raz - zmiany obejmą to miejsce.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Odśwież z profilu" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Imię") as HTMLInputElement).value).toBe("Anna"),
    );
    lookups.lookupAuthors.mockRejectedValueOnce(new Error("x"));
    fireEvent.click(screen.getByRole("button", { name: "Odśwież z profilu" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Odłącz od źródła" }));
    expect(screen.getByText("Wpisane ręcznie")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      source: { type: "manual" },
      firstName: "Anna",
    });
  });

  it("starts an unknown (pasted) reference from its fallback label", () => {
    const { onSave } = open({
      request: {
        mode: "edit",
        id: "ie_ghost001",
        fallback: { kind: "person", label: "Jan Kowalski" },
      },
    });
    expect(screen.getByRole("heading", { name: "Edytuj osobę" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      id: "ie_ghost001",
      firstName: "Jan",
      lastName: "Kowalski",
    });
  });

  it("an unknown reference without a fallback starts as a company", () => {
    open({ request: { mode: "edit", id: "ie_ghost002" } });
    expect(screen.getByRole("heading", { name: "Edytuj firmę" })).toBeTruthy();
  });
});
