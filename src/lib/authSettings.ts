export type LoginPosition = "left" | "center" | "right";

export interface AuthSettings {
  popup_enabled: boolean;
  allow_public_signup: boolean;
  signup_label_pl: string;
  signup_label_en: string;
  signin_label_pl: string;
  signin_label_en: string;
  popup_heading_pl: string;
  popup_heading_en: string;
  popup_description_pl: string;
  popup_description_en: string;
  form_logo_url: string;
  form_logo_url_dark: string;
  login_position: LoginPosition;
  login_bg_url: string;
  login_bg_color: string;
  custom_login_url: string;
  logged_in_redirect_url: string;
  logout_redirect_url: string;
  show_back_to_home: boolean;
}

export const AUTH_DEFAULTS: AuthSettings = {
  popup_enabled: true,
  allow_public_signup: true,
  signup_label_pl: "Zarejestruj",
  signup_label_en: "Sign up",
  signin_label_pl: "Zaloguj",
  signin_label_en: "Sign in",
  popup_heading_pl: "Witaj ponownie",
  popup_heading_en: "Welcome back",
  popup_description_pl: "Zaloguj się, aby zapisywać artykuły i obserwować autorów.",
  popup_description_en: "Sign in to bookmark articles and follow authors.",
  form_logo_url: "",
  form_logo_url_dark: "",
  login_position: "center",
  login_bg_url: "",
  login_bg_color: "",
  custom_login_url: "",
  logged_in_redirect_url: "",
  logout_redirect_url: "/",
  show_back_to_home: true,
};

export const AUTH_SETTINGS_KEY = "auth_branding";
