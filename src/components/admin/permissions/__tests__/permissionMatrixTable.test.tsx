// Testy renderu macierzy uprawnień (atomic design + PL/EN + izolacja tenanta).
//
// Sprawdzamy, że tabela pokazuje DOKŁADNIE to, co wyliczyła warstwa danych: role
// z bramek, warstwy podanego tenanta (i żadne inne), rozróżnienie "brak" vs
// "nie dotyczy" oraz nazwę bramki SQL, po której audytor trafi do źródła.
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-permissions";
import { PermissionMatrixTable } from "../organisms";
import { PermissionActorCard } from "../molecules";
import { PermissionLevelCell } from "../atoms";
import {
  buildPermissionMatrix,
  groupRows,
  tierActorId,
  type TierInput,
} from "@/lib/authz/permissionMatrix";
import { PERMISSION_GROUPS } from "@/lib/authz/permissionRows";
import type { AuthzSnapshotModule } from "@/lib/authz/authzSnapshotTypes";

const SNAPSHOT: AuthzSnapshotModule = {
  appRoles: ["admin", "author", "editor", "super_admin", "user"],
  roleGates: [
    {
      ref: "fn:admin_list_users/0",
      kind: "function",
      object: "admin_list_users",
      file: "x.sql",
      anyRoles: ["admin"],
      allRoles: [],
      tenantRef: "caller",
      securityDefiner: true,
      featureKeys: [],
    },
  ],
  featureGates: [
    {
      capability: "premium_content",
      ref: "fn:has_content_access/2",
      kind: "function",
      object: "has_content_access",
      file: "x.sql",
      bypassRoles: [],
      tenantRef: "row",
    },
  ],
  stats: { migrations: 3, functions: 2, policies: 1 },
};

const TIERS: readonly TierInput[] = [
  {
    key: "reader",
    rank: 0,
    name_pl: "Essential",
    name_en: "Essential",
    features: {},
    is_default: true,
  },
  {
    key: "member",
    rank: 10,
    name_pl: "Plus",
    name_en: "Plus",
    features: { premium_content: true },
    is_default: false,
  },
];

function renderMatrix(tiers: readonly TierInput[] = TIERS) {
  const matrix = buildPermissionMatrix({ tiers, snapshot: SNAPSHOT });
  return {
    matrix,
    ...render(
      <PermissionMatrixTable
        actors={matrix.actors}
        sections={groupRows(matrix.rows, PERMISSION_GROUPS)}
        lang="pl"
      />,
    ),
  };
}

beforeAll(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
});

describe("PermissionMatrixTable", () => {
  it("renderuje kolumnę na każdą rolę i na każdą warstwę tenanta", () => {
    const { getAllByRole } = renderMatrix();
    const headers = getAllByRole("columnheader").map((cell) => cell.textContent ?? "");
    for (const label of ["Super-Admin", "Admin", "Editor", "Użytkownik", "Essential", "Plus"]) {
      expect(
        headers.some((header) => header.includes(label)),
        label,
      ).toBe(true);
    }
  });

  it("NIE renderuje warstwy, której nie ma w danych tenanta", () => {
    const { queryAllByRole } = renderMatrix([TIERS[0]]);
    const headers = queryAllByRole("columnheader").map((cell) => cell.textContent ?? "");
    expect(headers.some((header) => header.includes("Plus"))).toBe(false);
  });

  it("pokazuje etykietę wiersza i nazwę bramki SQL", () => {
    const { getByText } = renderMatrix();
    expect(getByText("Lista użytkowników obszaru roboczego")).toBeInTheDocument();
    expect(getByText("admin_list_users")).toBeInTheDocument();
  });

  it("odróżnia 'brak' (bramka nie przepuszcza) od 'nie dotyczy' (inna oś)", () => {
    const { getByRole } = renderMatrix();
    const row = getByRole("row", { name: /Lista użytkowników obszaru roboczego/ });
    const cells = within(row).getAllByRole("cell");
    // Kolejność kolumn: super_admin, admin, editor, author, user, warstwy...
    expect(cells[1].textContent).toContain("Pełny");
    expect(cells[0].textContent).toContain("Brak");
    expect(cells[5].textContent).toContain("Nie dotyczy");
  });

  it("flaga warstwy jest 'pełna' tylko dla warstwy, która ją ma", () => {
    const { getByRole } = renderMatrix();
    const row = getByRole("row", { name: /Treści premium/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells[5].textContent).toContain("Brak"); // Essential
    expect(cells[6].textContent).toContain("Pełny"); // Plus
  });

  it("oznacza pozycje bez bramki jako dekoracyjne", () => {
    const { getByRole } = renderMatrix();
    const row = getByRole("row", { name: /Grupy robocze/ });
    expect(within(row).getByText("Dekoracyjna")).toBeInTheDocument();
  });

  it("nagłówki sekcji są renderowane raz na sekcję", () => {
    const { getAllByText } = renderMatrix();
    expect(getAllByText("Użytkownicy i role")).toHaveLength(1);
  });

  it("tabela ma dostępny opis (caption) i nagłówki wierszy", () => {
    const { container, getAllByRole } = renderMatrix();
    expect(container.querySelector("caption")?.textContent).toContain("Macierz uprawnień");
    expect(getAllByRole("rowheader").length).toBeGreaterThan(0);
  });

  it("przełącza język na EN bez zmiany danych", async () => {
    await i18n.changeLanguage("en");
    const { getByText } = renderMatrix();
    expect(getByText("Workspace user list")).toBeInTheDocument();
    expect(getByText("admin_list_users")).toBeInTheDocument();
    await i18n.changeLanguage("pl");
  });
});

describe("PermissionLevelCell", () => {
  it("pokazuje wartość puli dla wierszy limitów", () => {
    const { getByText } = render(<PermissionLevelCell level="full" quota={4} />);
    expect(getByText("4 / mies.")).toBeInTheDocument();
  });

  it("dla puli zerowej mówi wprost, że puli nie ma", () => {
    const { getByText } = render(<PermissionLevelCell level="none" quota={0} />);
    expect(getByText("Brak puli")).toBeInTheDocument();
  });

  it("ma tytuł objaśniający poziom (a11y + tooltip)", () => {
    const { container } = render(<PermissionLevelCell level="not_applicable" />);
    expect(container.firstElementChild?.getAttribute("title")).toBeTruthy();
  });
});

describe("PermissionActorCard", () => {
  it("karta warstwy pokazuje rangę, znacznik domyślnej i licznik egzekwowania", () => {
    const matrix = buildPermissionMatrix({ tiers: TIERS, snapshot: SNAPSHOT });
    const actor = matrix.actors.find((candidate) => candidate.id === tierActorId("member"));
    expect(actor).toBeDefined();
    const { getByText, container } = render(
      <PermissionActorCard
        actor={actor as NonNullable<typeof actor>}
        lang="pl"
        enforcedFlags={{ enforced: 1, total: 1 }}
      />,
    );
    expect(getByText("Plus")).toBeInTheDocument();
    expect(getByText("ranga 10")).toBeInTheDocument();
    expect(container.textContent).toContain("1/1");
  });

  it("karta roli pokazuje opis zakresu zaufania", () => {
    const matrix = buildPermissionMatrix({ tiers: [], snapshot: SNAPSHOT });
    const actor = matrix.actors[0];
    const { container } = render(<PermissionActorCard actor={actor} lang="pl" />);
    expect(container.textContent).toContain("Super-Admin");
    expect(container.textContent).toContain("nie dziedziczy");
  });
});
