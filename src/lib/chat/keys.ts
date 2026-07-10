// React Query key factory for the chat feature. User id is part of every key
// so an account switch can never leak another user's cached threads.
export const chatKeys = {
  all: ["chat"] as const,
  conversations: (uid: string | undefined) => ["chat", "conversations", uid ?? "anon"] as const,
  messages: (uid: string | undefined, conversationId: string) =>
    ["chat", "messages", uid ?? "anon", conversationId] as const,
  reactions: (uid: string | undefined, conversationId: string) =>
    ["chat", "reactions", uid ?? "anon", conversationId] as const,
  peers: (uid: string | undefined, userIds: ReadonlyArray<string>) =>
    ["chat", "peers", uid ?? "anon", [...userIds].sort().join(",")] as const,
  people: (uid: string | undefined, q: string) => ["chat", "people", uid ?? "anon", q] as const,
  attachmentUrl: (path: string) => ["chat", "attachment-url", path] as const,
};
