// Klucze słownika S3 dla inwentarza dostępu - jawne mapy po typach DTO
// (`adminRevenue.access.*`), wspólne dla tabeli inwentarza i symulatora.
// Nowa wartość unii bez napisu nie skompiluje się, zamiast pokazać surowy klucz.
import type {
  AccessInventoryEntity,
  AccessInventoryMode,
  AccessInventoryPolicy,
} from "@/lib/revenue/access/dto";

export const ACCESS_ENTITY_KEY: Readonly<Record<AccessInventoryEntity, string>> = {
  post: "adminRevenue.access.entity.post",
  page: "adminRevenue.access.entity.page",
  media: "adminRevenue.access.entity.media",
};

export const ACCESS_MODE_KEY: Readonly<Record<AccessInventoryMode, string>> = {
  public: "adminRevenue.access.mode.public",
  members: "adminRevenue.access.mode.members",
  paid: "adminRevenue.access.mode.paid",
  password: "adminRevenue.access.mode.password",
};

export const ACCESS_POLICY_KEY: Readonly<Record<AccessInventoryPolicy, string>> = {
  inherit: "adminRevenue.access.policy.inherit",
  metered: "adminRevenue.access.policy.metered",
  exempt: "adminRevenue.access.policy.exempt",
};
