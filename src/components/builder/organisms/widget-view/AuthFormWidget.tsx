// Auth form widgets (login/register/lost/reset), extracted from SimpleWidgets.
import type { WidgetNode } from "@/lib/builder/types";
import {
  LoginFormView,
  RegisterFormView,
  LostPasswordFormView,
  ResetPasswordFormView,
} from "@/components/blocks/AuthFormBlocks";
import type { Lang } from "./frame";

type AuthCfg = Record<string, unknown>;
export function AuthFormWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const data = (node.content ?? {}) as AuthCfg;
  switch (node.type) {
    case "login-form":
      return <LoginFormView data={data} lang={lang} />;
    case "register-form":
      return <RegisterFormView data={data} lang={lang} />;
    case "lost-password-form":
      return <LostPasswordFormView data={data} lang={lang} />;
    case "reset-password-form":
      return <ResetPasswordFormView data={data} lang={lang} />;
    default:
      return null;
  }
}
