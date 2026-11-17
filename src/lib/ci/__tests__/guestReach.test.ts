// Osiągalność pliku dla gościa (`guestReach.ts`) - miara poza bramką CI:
// klasa pliku (`public` > `session-gate` > `admin` > `none`) i dowód
// w postaci najkrótszej ścieżki importów od pliku trasy.
import { describe, expect, it } from "vitest";

import { guestReach } from "../../../../scripts/lib/guestReach";
import { routeTreeEntries } from "@/lib/ci/publicRouteLoaders";

const ROUTE_TREE = `
import { Route as rootRouteImport } from './routes/__root'
import { Route as PodcastRouteImport } from './routes/podcast'
import { Route as ProfileRouteImport } from './routes/profile'
import { Route as ProfileAccountRouteImport } from './routes/profile.account'
import { Route as AdminRouteImport } from './routes/admin'
import { Route as AdminUsersRouteImport } from './routes/admin.users'
import { Route as FeedRouteImport } from './routes/feed'

const PodcastRoute = PodcastRouteImport.update({
  id: '/podcast',
  path: '/podcast',
  getParentRoute: () => rootRouteImport,
} as any)
const ProfileRoute = ProfileRouteImport.update({
  id: '/profile',
  path: '/profile',
  getParentRoute: () => rootRouteImport,
} as any)
const ProfileAccountRoute = ProfileAccountRouteImport.update({
  id: '/account',
  path: '/account',
  getParentRoute: () => ProfileRoute,
} as any)
const AdminRoute = AdminRouteImport.update({
  id: '/admin',
  path: '/admin',
  getParentRoute: () => rootRouteImport,
} as any)
const AdminUsersRoute = AdminUsersRouteImport.update({
  id: '/users',
  path: '/users',
  getParentRoute: () => AdminRoute,
} as any)
const FeedRoute = FeedRouteImport.update({
  id: '/feed',
  path: '/feed',
  getParentRoute: () => rootRouteImport,
} as any)
`;

const SOURCES: Record<string, string> = {
  "src/routeTree.gen.ts": ROUTE_TREE,
  "src/router.tsx": `import { routeTree } from "./routeTree.gen"; import { E } from "@/components/ErrorPage";`,
  "src/components/ErrorPage.tsx": `export const E = 1;`,
  "src/routes/__root.tsx": `import { Header } from "@/components/Header";`,
  "src/components/Header.tsx": `import { Bell } from "./Bell";`,
  "src/components/Bell.tsx": `import { fetchBell } from "@/lib/bell";`,
  "src/lib/bell.ts": `export const fetchBell = 1;`,
  // Trasa publiczna: statyczny import i leniwy `import()`.
  "src/routes/podcast.tsx": `
    import { Hosts } from "@/components/Hosts";
    import { Route as AccountRoute } from "./profile.account";
    const Lazy = lazy(() => import("@/components/Guests"));
    export const Route = createFileRoute("/podcast")({ component: P });`,
  "src/components/Hosts.tsx": `import { q } from "@/lib/podcasts";`,
  "src/components/Guests.tsx": `import { g } from "@/lib/guests";`,
  "src/lib/podcasts.ts": `import { shared } from "@/lib/shared";`,
  "src/lib/guests.ts": `export const g = 1;`,
  "src/lib/shared.ts": `export const shared = 1;`,
  // Bramka sesji na rodzicu obejmuje dziecko.
  "src/routes/profile.tsx": `
    import { AuthGate } from "@/components/AuthGate";
    function L() { return <AuthGate><Outlet /></AuthGate>; }`,
  "src/routes/profile.account.tsx": `import { acc } from "@/lib/account"; import { shared } from "@/lib/shared";`,
  "src/components/AuthGate.tsx": `export function AuthGate() {}`,
  "src/lib/account.ts": `import { adminOnly } from "@/lib/adminOnly";`,
  // Panel: plik osiągalny wyłącznie z /admin. Trasa panelu importuje trasę
  // publiczną - pliki tras nie są przechodnie.
  "src/routes/admin.tsx": `import { x } from "./podcast";`,
  "src/routes/admin.users.tsx": `import { adminOnly } from "@/lib/adminOnly"; import { u } from "@/lib/users";`,
  "src/lib/adminOnly.ts": `export const adminOnly = 1;`,
  "src/lib/users.ts": `export const u = 1;`,
  // Trasa serwerowa bez komponentu (RSS) - też wejście publiczne.
  "src/routes/feed.ts": `import { rss } from "@/lib/rss";`,
  "src/lib/rss.ts": `export const rss = 1;`,
  "src/lib/dead.ts": `export const dead = 1;`,
};
const sources = Object.entries(SOURCES).map(([file, code]) => ({ file, code }));

describe("bramki tras dla miary gościa (`routeTreeEntries`)", () => {
  it("panel po ścieżce `/admin`, bramka sesji dziedziczona po drzewie tras", () => {
    const byFile = new Map(Object.entries(SOURCES));
    expect(
      routeTreeEntries({ routeTree: ROUTE_TREE, sources: byFile }).map(
        (r) => `${r.file} ${r.fullPath} admin=${r.admin} gate=${r.sessionGateFrom}`,
      ),
    ).toEqual([
      "src/routes/admin.tsx /admin admin=true gate=null",
      "src/routes/admin.users.tsx /admin/users admin=true gate=null",
      "src/routes/feed.ts /feed admin=false gate=null",
      "src/routes/podcast.tsx /podcast admin=false gate=null",
      "src/routes/profile.account.tsx /profile/account admin=false gate=/profile",
      "src/routes/profile.tsx /profile admin=false gate=/profile",
    ]);
  });
});

describe("osiągalność pliku dla gościa (`guestReach`)", () => {
  const reach = guestReach(sources);
  const show = (file: string): string => {
    const r = reach.get(file);
    return r === undefined ? "?" : `${r.cls} ${r.entry} ${r.path.join(" > ")}`;
  };

  it("powłoka i trasa publiczna (statycznie i przez `import()`); najlepsza klasa wygrywa", () => {
    expect(show("src/lib/bell.ts")).toBe(
      "public (powłoka) src/routes/__root.tsx > src/components/Header.tsx > src/components/Bell.tsx > src/lib/bell.ts",
    );
    expect(show("src/lib/guests.ts")).toBe(
      "public /podcast src/routes/podcast.tsx > src/components/Guests.tsx > src/lib/guests.ts",
    );
    // Osiągalny i z trasy publicznej, i zza bramki - `public`.
    expect(show("src/lib/shared.ts")).toBe(
      "public /podcast src/routes/podcast.tsx > src/components/Hosts.tsx > src/lib/podcasts.ts > src/lib/shared.ts",
    );
    expect(show("src/lib/rss.ts")).toBe("public /feed src/routes/feed.ts > src/lib/rss.ts");
    // Wejście serwera/routera spoza drzewa tras - publiczne.
    expect(show("src/components/ErrorPage.tsx")).toBe(
      "public (serwer) src/router.tsx > src/components/ErrorPage.tsx",
    );
  });

  it("za bramką sesji (także przez przodka), panel, plik bez ścieżki; trasa nie przechodzi przez import innej trasy ani `routeTree.gen.ts`", () => {
    expect(show("src/lib/account.ts")).toBe(
      "session-gate /profile/account src/routes/profile.account.tsx > src/lib/account.ts",
    );
    // `adminOnly` osiągalny zza bramki sesji (przez `account`) i z panelu - lepsza klasa.
    expect(show("src/lib/adminOnly.ts")).toBe(
      "session-gate /profile/account src/routes/profile.account.tsx > src/lib/account.ts > src/lib/adminOnly.ts",
    );
    expect(show("src/lib/users.ts")).toBe(
      "admin /admin/users src/routes/admin.users.tsx > src/lib/users.ts",
    );
    expect(show("src/routes/admin.tsx")).toBe("admin /admin src/routes/admin.tsx");
    expect(show("src/lib/dead.ts")).toBe("none null ");
    // `router.tsx` importuje drzewo tras - nie czyni z panelu kodu publicznego.
    expect(show("src/routes/admin.users.tsx")).toBe(
      "admin /admin/users src/routes/admin.users.tsx",
    );
  });
});
