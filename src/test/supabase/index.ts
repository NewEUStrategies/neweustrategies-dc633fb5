// Atomy testowe klienta Supabase - JEDNO zrodlo prawdy dla calego repo.
//
// Atomic design zastosowany do testow: te piec modulow to atomy, z ktorych
// powierzchniowe pliki fixture'ow (`test/chat`, `test/profile`, `test/clubs`,
// `test/network`) skladaja swoje molekuly - fabryki wierszy i widokow
// domenowych. Zaden z nich nie buduje juz wlasnej atrapy klienta.
//
// PODZIAL PRZEBIEGA PO SPOSOBIE ROZMOWY Z BAZA, nie po module produktowym:
//
//   ./chain     - `supabase.from(...)`, pelny thenable lancuch PostgREST.
//                 Czat, profil, KOMENTARZE.
//   ./rpc       - `supabase.rpc(...)`, rejestrator nazwy i argumentow.
//                 KLUBY (caly modul jest RPC-only), siec kontaktow.
//   ./realtime  - `supabase.channel(...)` z obserwowalnym refcountem.
//   ./storage   - `supabase.storage`, podpisy pojedyncze i wsadowe.
//   ./i18n      - stub `react-i18next` echujacy klucz zamiast tlumaczenia.
//
// Skutek jest ten sam, co przy pierwszym wydzieleniu (`supabaseChain.ts`):
// zmiana kontraktu klienta psuje JEDEN plik, nie dwadziescia dziewiec.
export {
  fail,
  ok,
  okCount,
  pgError,
  supabaseFromStub,
  type PostgrestErrorLike,
  type RecordedCall,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type TableResponder,
} from "./chain";

export {
  supabaseAuthStub,
  supabaseRpcStub,
  type RecordedRpc,
  type RpcResponder,
  type SupabaseAuthStub,
  type SupabaseRpcStub,
} from "./rpc";

export {
  realtimeStub,
  type FakeChannel,
  type RealtimeEventPayload,
  type RealtimeHandler,
  type RealtimeStub,
  type RecordedListener,
} from "./realtime";

export { storageStub, type StorageStub } from "./storage";

export { reactI18nextStub, translateKey } from "./i18n";
