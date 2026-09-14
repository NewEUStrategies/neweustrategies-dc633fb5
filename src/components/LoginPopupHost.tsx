import { lazy, Suspense, useEffect, useState } from "react";
import { onOpenLoginPopup, type LoginPopupOptions } from "@/lib/loginPopupBus";

const LoginPopup = lazy(() => import("./LoginPopup").then((m) => ({ default: m.LoginPopup })));

/** Keep the event listener ready without downloading the sign-in form. */
export function LoginPopupHost() {
  const [request, setRequest] = useState<LoginPopupOptions | null>(null);
  useEffect(() => onOpenLoginPopup((options) => setRequest({ ...options })), []);
  return request ? (
    <Suspense fallback={null}>
      <LoginPopup request={request} />
    </Suspense>
  ) : null;
}
