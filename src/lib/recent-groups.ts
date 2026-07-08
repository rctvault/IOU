// A device-local list of groups you've opened, so you don't have to remember
// invite codes. This is just a convenience bookmark list kept in localStorage —
// it is NOT the group data (in cloud mode that lives in Supabase). Clearing
// browser data or switching devices loses the list, so the invite code is still
// the ultimate key: keep it somewhere, or ask a group member to re-share it.

const KEY = "tracker:recent-groups";
const MAX = 24;

export interface RecentGroup {
  code: string;
  name: string;
  homeCurrency: string;
  lastOpenedAt: string;
}

export function listRecentGroups(): RecentGroup[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentGroup[];
    return list.sort((a, b) => (a.lastOpenedAt < b.lastOpenedAt ? 1 : -1));
  } catch {
    return [];
  }
}

export function rememberGroup(g: Omit<RecentGroup, "lastOpenedAt">): void {
  if (typeof window === "undefined") return;
  const others = listRecentGroups().filter(
    (r) => r.code !== g.code.toUpperCase(),
  );
  const next: RecentGroup[] = [
    { ...g, code: g.code.toUpperCase(), lastOpenedAt: new Date().toISOString() },
    ...others,
  ].slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function forgetGroup(code: string): void {
  if (typeof window === "undefined") return;
  const next = listRecentGroups().filter((r) => r.code !== code.toUpperCase());
  localStorage.setItem(KEY, JSON.stringify(next));
}

/**
 * Rebuild the "Your groups" list from every group stored on this device
 * (single-device mode only). Recovers groups whose shortcut was removed but
 * whose data is still in localStorage. Returns how many were found.
 */
export function recoverDeviceGroups(): number {
  if (typeof window === "undefined") return 0;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("tracker:group:")) keys.push(k);
  }
  let count = 0;
  for (const k of keys) {
    try {
      const g = JSON.parse(localStorage.getItem(k) ?? "{}").group;
      if (g?.shareCode) {
        rememberGroup({
          code: g.shareCode,
          name: g.name,
          homeCurrency: g.homeCurrency,
        });
        count++;
      }
    } catch {
      // skip anything unparseable
    }
  }
  return count;
}
