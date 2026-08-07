// ORGANIZM: dystans w sieci na profilu osoby - komponent samowystarczalny.
//
// Jeździ na TYM SAMYM batchowanym `connection_statuses`, co ConnectButton
// i MutualConnectionsHint (wspólny cache React Query po kluczu z listą id),
// więc dołożenie go do nagłówka profilu nie kosztuje ani jednego RPC więcej.
//
// Bramki (identyczne jak reszta powierzchni sieci): moduł włączony w tenancie,
// użytkownik zalogowany, cudzy profil. Stopień 0 („poza zasięgiem") świadomie
// nie renderuje niczego - „nie znam nikogo, kto by ją znał" to informacja
// prawdziwa, ale bezużyteczna i nieprzyjemna, więc zostaje w danych.
import { useAuth } from "@/hooks/useAuth";
import { useCommunityModules } from "@/lib/community/useCommunityModules";
import { useConnectionStatuses } from "@/lib/network/useConnections";
import { ConnectionDistance } from "../molecules/ConnectionDistance";
import "@/lib/i18n-network";

export interface NetworkDistanceProps {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  density?: "full" | "compact";
  className?: string;
}

export function NetworkDistance({
  userId,
  displayName,
  avatarUrl,
  density = "full",
  className,
}: NetworkDistanceProps) {
  const { user } = useAuth();
  const modules = useCommunityModules();
  const enabled = modules.connections_enabled && !!user && user.id !== userId;
  const statusesQ = useConnectionStatuses(enabled ? [userId] : []);
  const state = statusesQ.data?.get(userId);

  if (!enabled || !state) return null;

  return (
    <ConnectionDistance
      degree={state.degree}
      bridge={state.bridge}
      targetName={displayName}
      targetAvatarUrl={avatarUrl}
      density={density}
      className={className}
    />
  );
}
