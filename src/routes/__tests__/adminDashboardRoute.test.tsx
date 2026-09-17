// `/admin/` - trasa kokpitu. Przedmiotem dowodu jest JEDNA rzecz: MOMENT,
// w którym zaczyna się pobieranie chunku pulpitu.
//
// MECHANIZM, KTÓRY TEN PLIK PILNUJE. `/admin` jest trasą `ssr: false`, a
// `AdminLayout` (routes/admin.tsx) przy `useAuth().loading` NIE renderuje
// `<Outlet/>`. Komponent tej trasy montuje się więc dopiero PO rozstrzygnięciu
// sesji, a `React.lazy` odpala swój import przy pierwszym renderze - czyli
// pobranie chunku pulpitu stało SZEREGOWO za dwoma fazami sieciowymi
// uwierzytelnienia (`getSession` + odczyt `user_roles`/`profiles`), mimo że
// od żadnej z nich nie zależy. Zmierzone na produkcji LCP `/admin` = 7,54 s.
//
// Moduł trasy żąda więc chunku SAM, przy ewaluacji - a router ewaluuje go przy
// rozwiązywaniu dopasowania, czyli zanim uwierzytelnienie w ogóle wystartuje.
//
// DLACZEGO TO WYMAGA TESTU. Ta zmiana to jedna linijka `void loadAdminDashboard()`
// bez żadnego widocznego skutku w DOM-ie: nikt jej nie zauważy przy przeglądzie,
// nic się nie zepsuje po jej usunięciu, a regresja kosztuje sekundy LCP i jest
// niewidoczna we wszystkich pozostałych testach. Test mierzy dokładnie to:
// czy SAM IMPORT MODUŁU TRASY wystarczy, żeby chunk pulpitu został zażądany -
// bez renderu, bez routera, bez sesji.
//
// GRANICA DOWODU. `vi.mock` zamienia moduł pulpitu na atrapę, więc mierzymy
// ŻĄDANIE modułu, nie transfer sieciowy ani realny podział na chunki. Podziału
// pilnują bramki artefaktu (`check:chunks`, `check:entry-purity`) - i one nadal
// muszą widzieć pulpit poza grafem startowym, bo `lazy` zostaje na miejscu.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dashboardRequests: 0 }));

vi.mock("@/components/admin/dashboard/AdminDashboard", () => {
  h.dashboardRequests += 1;
  return { AdminDashboard: () => null };
});

// Nakładki słownika rejestrują klucze efektem ubocznym importu i sięgają po
// `@/lib/i18n`; w tym pliku nie mają nic do zrobienia, a ciągną za sobą
// react-i18next (ta sama pułapka cyklu, co w `dashboardSection.test.tsx`).
vi.mock("@/lib/i18n-admin-dashboard", () => ({ ensureI18n: () => {} }));
vi.mock("@/components/admin/analytics/AdminBiStrip", () => ({ AdminBiStrip: () => null }));

describe("/admin/ - moment pobrania chunku pulpitu", () => {
  it("SAM import modułu trasy żąda chunku pulpitu DOKŁADNIE RAZ - bez renderu i bez sesji", async () => {
    // Stan wyjściowy: nikt jeszcze nie dotknął modułu trasy.
    expect(h.dashboardRequests).toBe(0);

    const mod = await import("@/routes/admin.index");
    // Rozgrzewka jest `void`-owana, więc jej obietnica rozstrzyga się poza
    // bieżącym zadaniem; jedno przejście przez kolejkę makrozadań wystarczy.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // SEDNO: chunk zażądany, choć NIC się nie wyrenderowało i nie ma sesji.
    expect(h.dashboardRequests).toBe(1);
    // Komponent trasy istnieje i jest tym, co router zamontuje. Jego samo
    // istnienie nie może dołożyć drugiego żądania modułu - `lazy` i rozgrzewka
    // sięgają po TEN SAM specyfikator, więc rejestr modułów je scala.
    expect(mod.Route.options.component).toBeTypeOf("function");
    expect(h.dashboardRequests).toBe(1);
  });
});
