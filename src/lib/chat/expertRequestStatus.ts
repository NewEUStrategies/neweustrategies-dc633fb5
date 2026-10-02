// Status, w który przechodzi „Zapytanie do eksperta" po danej akcji.
//
// AKCJA NIE JEST STATUSEM. Słownik zna `expertRequest.status.declined`, a nie
// `...decline`, więc klucz toastu składany z gołej nazwy akcji dawał po
// odrzuceniu zapytania w profilu surowy klucz zamiast komunikatu (a panel
// `/admin/expert-requests` - to samo, gdy RPC nie oddało `status`). Moduł jest
// czysty i osobny, bo `useExpertRequests` bywa w testach zastępowany atrapą.
import type { ExpertRequestAction } from "./useExpertRequests";

export const EXPERT_REQUEST_RESULT_STATUS = {
  approve: "approved",
  decline: "declined",
  answered: "answered",
  cancel: "cancelled",
} as const satisfies Record<ExpertRequestAction, string>;
