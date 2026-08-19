import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinUsForm } from "@/components/interests/JoinUsForm";
import type { InterestCatalog, InterestItem } from "@/hooks/useInterests";
import type { CustomFieldDef } from "@/lib/builder/formFieldConfig";

const controls = vi.hoisted(() => {
  const markers = {
    subscribe: () => undefined,
    prefill: () => undefined,
    link: () => undefined,
    consent: () => undefined,
  };
  return {
    language: "pl",
    builderMode: null as unknown,
    newsletter: { enabled: true, heading_pl: null, heading_en: null },
    catalog: { categories: [], tags: [] } as InterestCatalog,
    my: {
      data: { categoryIds: [] as string[], tagIds: [] as string[] },
      save: vi.fn(),
      userId: null as string | null,
      isLoading: false,
      isAnonymous: true,
    },
    server: {
      subscribe: vi.fn(),
      prefill: vi.fn(),
      link: vi.fn(),
      consent: vi.fn(),
    },
    markers,
  };
});

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (marker: unknown) => {
    if (marker === controls.markers.subscribe) return controls.server.subscribe;
    if (marker === controls.markers.prefill) return controls.server.prefill;
    if (marker === controls.markers.link) return controls.server.link;
    return controls.server.consent;
  },
}));

vi.mock("@/lib/newsletter.functions", () => ({
  subscribeToNewsletter: controls.markers.subscribe,
}));
vi.mock("@/lib/joinUsSync.functions", () => ({
  getJoinUsPrefill: controls.markers.prefill,
  linkJoinUsAndBackfill: controls.markers.link,
}));
vi.mock("@/lib/consents.functions", () => ({ setMyConsent: controls.markers.consent }));
vi.mock("@/lib/notifications/consentCatalog", () => ({
  getConsentDefinition: () => ({ version: "2.0" }),
}));

vi.mock("@/hooks/useNewsletterSettings", () => ({
  useNewsletterSettings: () => ({ data: controls.newsletter }),
}));
vi.mock("@/hooks/useInterests", () => ({
  useInterestCatalog: () => ({ data: controls.catalog, isLoading: false }),
  useMyInterests: () => controls.my,
}));
vi.mock("@/lib/content-model/editorCanvas", () => ({
  useBuilderMode: () => controls.builderMode,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { fields?: string }) =>
      values?.fields ? `${key}:${values.fields}` : key,
    i18n: { language: controls.language },
  }),
}));

vi.mock("@/lib/newsletter/newsletterFieldLabels", () => ({
  useNewsletterFieldLabels: () => ({
    label: (key: string, override?: string) => override?.trim() || key,
    topics: (key: string, override?: string) => override?.trim() || key,
  }),
  topicLabel: (key: string, lang: "pl" | "en") =>
    ({
      heading: lang === "pl" ? "Tematy" : "Topics",
      placeholder: lang === "pl" ? "Wybierz tematy…" : "Select topics…",
      selected: lang === "pl" ? "Wybrano" : "selected",
      empty: lang === "pl" ? "Brak wyboru" : "Nothing selected",
      clear: lang === "pl" ? "Wyczyść" : "Clear",
      done: lang === "pl" ? "Gotowe" : "Done",
      areas: lang === "pl" ? "Obszary" : "Areas",
      topics: lang === "pl" ? "Tematy" : "Topics",
      jumpToGroup: lang === "pl" ? "Przejdź do grupy" : "Jump to group",
    })[key],
  topicsTriggerText: (count: number, lang: "pl" | "en") =>
    count > 0
      ? lang === "pl"
        ? `Wybrano: ${count}`
        : `${count} selected`
      : lang === "pl"
        ? "Wybierz tematy…"
        : "Select topics…",
}));

vi.mock("@/components/ui/floating-input", () => ({
  FloatingInput: ({
    label,
    labelEditTarget: _labelEditTarget,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    label: string;
    labelEditTarget?: string;
  }) => <input aria-label={label} {...props} />,
}));

vi.mock("@/components/interests/CountryCombobox", () => ({
  CountryCombobox: ({
    label,
    value,
    onChange,
    required,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    onCheckedChange?: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}));

vi.mock("@/components/ui/subscribe-button", () => ({
  SubscribeButton: ({
    loading,
    loadingLabel,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    loadingLabel?: string;
  }) => (
    <button type="submit" disabled={loading} {...props}>
      {loading ? loadingLabel : children}
    </button>
  ),
}));

vi.mock("@/lib/builder/formFieldConfig", () => ({
  CustomFieldsRenderer: ({
    fields,
    values,
    onChange,
  }: {
    fields: Array<{ id: string; label_pl?: string }>;
    values: Record<string, string>;
    onChange: (id: string, value: string) => void;
  }) => (
    <>
      {fields.map((field) => (
        <input
          key={field.id}
          aria-label={field.label_pl || field.id}
          value={values[field.id] ?? ""}
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      ))}
    </>
  ),
  validateCustomFields: (
    fields: Array<{ id: string; required?: boolean }>,
    values: Record<string, string>,
  ) =>
    fields.filter((field) => field.required && !values[field.id]?.trim()).map((field) => field.id),
}));

vi.mock("@/lib/i18n-interests", () => ({ ensureI18n: vi.fn() }));

const root: InterestItem = {
  id: "root",
  type: "category",
  slug: "region",
  label: "Region",
  parentId: null,
};
const europe: InterestItem = {
  id: "europe",
  type: "category",
  slug: "europe",
  label: "Europa",
  parentId: "root",
  parentLabel: "Region",
  parentSlug: "region",
};
const risk: InterestItem = {
  id: "risk",
  type: "tag",
  slug: "risk",
  label: "Ryzyko",
  parentId: null,
};

const requiredCustomField = {
  id: "department",
  type: "text",
  required: true,
  label_pl: "Dział",
  label_en: "Department",
} as unknown as CustomFieldDef;

function fill(label: string, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}

function acceptConsent() {
  fireEvent.click(screen.getByRole("checkbox", { name: /joinUs.consent/ }));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "joinUs.submit" }));
}

describe("JoinUsForm", () => {
  beforeEach(() => {
    controls.language = "pl";
    controls.builderMode = null;
    controls.newsletter = { enabled: true, heading_pl: null, heading_en: null };
    controls.catalog = { categories: [root, europe], tags: [risk] };
    controls.my = {
      data: { categoryIds: [], tagIds: [] },
      save: vi.fn().mockResolvedValue({ ok: true, anon: true }),
      userId: null,
      isLoading: false,
      isAnonymous: true,
    };
    controls.server.subscribe.mockReset().mockResolvedValue({ ok: true });
    controls.server.prefill.mockReset().mockResolvedValue(null);
    controls.server.link.mockReset().mockResolvedValue(undefined);
    controls.server.consent.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ["card", "join-us-shell--card"],
    ["inline", "join-us-shell--inline"],
    ["split", "join-us-shell--split"],
    ["split-image", "join-us-shell--split-image"],
  ] as const)("renderuje wariant %s z nagłówkiem i formularzem", (variant, expectedClass) => {
    const { container } = render(
      <JoinUsForm
        variant={variant}
        showInterests={false}
        imageUrl={variant === "split-image" ? "https://example.test/cover.jpg" : undefined}
        imageAlt="Okładka"
      />,
    );

    expect(screen.getByRole("heading", { name: "joinUs.title" })).toBeInTheDocument();
    expect(container.querySelector("[data-jus-id]")).toHaveClass(expectedClass);
    expect(screen.getByRole("button", { name: "joinUs.submit" })).toBeEnabled();
  });

  it("ukrywa wyłączony newsletter publicznie, ale zachowuje go w builderze", () => {
    controls.newsletter.enabled = false;
    const { container, rerender } = render(<JoinUsForm showInterests={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    controls.builderMode = {};
    rerender(<JoinUsForm showInterests={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Newsletter jest wyłączony");
    expect(screen.getByRole("button", { name: "joinUs.submit" })).toBeInTheDocument();
  });

  it("pokazuje kolejne błędy e-maila, pola, zainteresowań i zgody", () => {
    render(
      <JoinUsForm
        showFirstName
        requireFirstName
        showInterests
        requireInterests
        interestsDisplay="chips"
      />,
    );

    fill("email *", "błędny");
    submit();
    expect(screen.getByText("joinUs.errorEmail")).toBeInTheDocument();
    expect(controls.server.subscribe).not.toHaveBeenCalled();

    fill("email *", "talent@example.test");
    submit();
    expect(screen.getByText("joinUs.requiredFields:firstName")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "firstName *" })).toBeRequired();

    fill("firstName *", "Anna");
    submit();
    expect(screen.getByText("joinUs.interestsRequired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Europa" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Europa" }));
    submit();
    expect(screen.getByText("joinUs.consentRequired")).toBeInTheDocument();
    expect(controls.server.subscribe).not.toHaveBeenCalled();
  });

  it("waliduje wymagane pole niestandardowe przed zgodą", () => {
    render(
      <JoinUsForm
        showInterests={false}
        customFields={[requiredCustomField]}
        requireEmail={false}
      />,
    );

    submit();
    expect(screen.getByText("joinUs.requiredFields:department")).toBeInTheDocument();
    expect(controls.server.subscribe).not.toHaveBeenCalled();

    fill("Dział", "Analizy");
    submit();
    expect(screen.getByText("joinUs.consentRequired")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Dział" })).toHaveValue("Analizy");
  });

  it("zapisuje kompletny formularz, preferencje i zgodę zalogowanego użytkownika", async () => {
    controls.my.userId = "user-1";
    controls.my.isAnonymous = false;
    render(
      <JoinUsForm
        variant="split"
        showInterests
        interestsDisplay="chips"
        showFirstName
        showLastName
        showPosition
        showLinkedin
        showPhone
        showCompany
        showCountry
        requireFirstName
        requireLastName
        requirePosition
        requireLinkedin
        requirePhone
        requireCompany
        requireCountry
        customFields={[requiredCustomField]}
        source="test-source"
      />,
    );

    fill("firstName *", " Anna ");
    fill("lastName *", " Kowalska ");
    fill("email *", "ANNA@EXAMPLE.TEST ");
    fill("position *", "Analityczka");
    fill("linkedin *", "https://linkedin.example.test/anna");
    fill("phone *", "+48 000 000 000");
    fill("company *", "NES Test");
    fill("country *", "Polska");
    fill("Dział", "Strategia");
    fireEvent.click(screen.getByRole("button", { name: "Europa" }));
    fireEvent.click(screen.getByRole("button", { name: "Ryzyko" }));
    acceptConsent();
    submit();

    expect(await screen.findByText("joinUs.success")).toBeInTheDocument();
    expect(controls.server.subscribe).toHaveBeenCalledTimes(1);
    const request = controls.server.subscribe.mock.calls[0]?.[0];
    expect(request.data).toMatchObject({
      email: "anna@example.test",
      name: "Anna Kowalska",
      firstName: "Anna",
      lastName: "Kowalska",
      language: "pl",
      source: "test-source",
      meta: {
        position: "Analityczka",
        linkedin: "https://linkedin.example.test/anna",
        phone: "+48 000 000 000",
        company: "NES Test",
        country: "Polska",
      },
      custom: {
        department: "Strategia",
        interests_areas: "Europa",
        interests_topics: "Ryzyko",
        interests: "Europa, Ryzyko",
        interests_region: "Europa",
      },
    });
    expect(controls.my.save).toHaveBeenCalledWith({ categoryIds: ["europe"], tagIds: ["risk"] });
    expect(controls.server.link).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "anna@example.test" }) }),
    );
    expect(controls.server.consent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: "marketing_email", version: "2.0", given: true }),
      }),
    );
  });

  it("traktuje zapisy pomocnicze jako niekrytyczne po udanej subskrypcji", async () => {
    controls.my.userId = "user-2";
    controls.my.data = { categoryIds: [europe.id], tagIds: [] };
    controls.my.save.mockRejectedValue(new Error("preferences unavailable"));
    controls.server.link.mockRejectedValue(new Error("profile unavailable"));
    controls.server.consent.mockRejectedValue(new Error("consent unavailable"));
    render(<JoinUsForm interestsDisplay="chips" />);

    fill("email *", "user@example.test");
    acceptConsent();
    submit();

    expect(await screen.findByText("joinUs.success")).toBeInTheDocument();
    expect(controls.my.save).toHaveBeenCalledTimes(1);
    expect(controls.server.link).toHaveBeenCalledTimes(1);
    expect(controls.server.consent).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ok: false, error: "not_configured" }, "joinUs.errorGeneric"],
    [{ ok: false, error: "duplicate-test" }, "duplicate-test"],
  ])("pokazuje kontrolowany błąd serwera %j", async (response, expected) => {
    controls.server.subscribe.mockResolvedValue(response);
    render(<JoinUsForm showInterests={false} />);
    fill("email *", "reader@example.test");
    acceptConsent();

    submit();

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(controls.server.subscribe).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("joinUs.success")).not.toBeInTheDocument();
  });

  it("pokazuje komunikat wyjątku i odzyskuje przycisk", async () => {
    controls.server.subscribe.mockRejectedValue(new Error("Sieć testowa niedostępna"));
    render(<JoinUsForm showInterests={false} />);
    fill("email *", "reader@example.test");
    acceptConsent();

    submit();

    expect(await screen.findByText("Sieć testowa niedostępna")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "joinUs.submit" })).toBeEnabled();
    expect(controls.server.subscribe).toHaveBeenCalledTimes(1);
  });

  it("renderuje ustawienia obrazu, nakładki i tekst angielski", () => {
    controls.language = "en";
    render(
      <JoinUsForm
        variant="split-image"
        showInterests={false}
        imageUrl="https://example.test/image.jpg"
        imageAlt="Polski alt"
        imageAltEn="English alt"
        imageOverlay={150}
        imagePosition="50% 20%"
        imageAspect="16/9"
        imageFit="contain"
      />,
    );

    const image = screen.getByRole("img", { name: "English alt" });
    expect(image).toHaveClass("object-contain");
    expect(image).toHaveStyle({ objectPosition: "50% 20%" });
    expect(document.querySelector('[style*="rgba(0, 0, 0, 1)"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "joinUs.title" })).toBeInTheDocument();
  });
});
