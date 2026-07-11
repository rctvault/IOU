// "This is me" — which member the person on THIS device is, per group. Stored
// only in localStorage (never in the shared DB), so each person's choice is
// private to their own device and can't overwrite anyone else's.

const key = (groupId: string) => `tracker:me:${groupId}`;

export function getMe(groupId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key(groupId));
}

export function setMe(groupId: string, memberId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key(groupId), memberId);
}

export function clearMe(groupId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key(groupId));
}
