"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CurrencyList } from "@/components/CurrencyList";
import { CURRENCIES } from "@/lib/currencies";
import {
  forgetGroup,
  listRecentGroups,
  recoverDeviceGroups,
  type RecentGroup,
} from "@/lib/recent-groups";
import { getStore, isCloudEnabled } from "@/lib/store";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("JPY");
  const [currencies, setCurrencies] = useState<string[]>(["JPY"]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentGroup[]>([]);
  const [confirmingCode, setConfirmingCode] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Client-only: the remembered-groups list lives in localStorage.
  useEffect(() => setRecents(listRecentGroups()), []);

  function restoreGroups() {
    const n = recoverDeviceGroups();
    setRecents(listRecentGroups());
    if (n === 0) {
      window.alert(
        "No groups were found stored on this device. If you're in shared/cloud mode, reopen a group with its invite code instead.",
      );
    }
  }

  function startDelete(groupCode: string) {
    setConfirmingCode(groupCode);
    setConfirmText("");
  }

  async function confirmDelete(groupCode: string) {
    if (confirmText.trim().toLowerCase() !== "delete") return;
    setDeleting(true);
    try {
      const store = await getStore();
      const bundle = await store.getGroupByCode(groupCode);
      if (bundle) await store.deleteGroup(bundle.group.id);
      forgetGroup(groupCode);
      setRecents(listRecentGroups());
      setConfirmingCode(null);
    } catch {
      setError("Could not delete that group. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  function changeHome(next: string) {
    setCurrency(next);
    setCurrencies((prev) =>
      [next, ...prev].filter((c, i, a) => a.indexOf(c) === i),
    );
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const store = await getStore();
      const group = await store.createGroup({
        name: name.trim(),
        homeCurrency: currency,
        currencies,
      });
      router.push(`/g/${group.shareCode}`);
    } catch {
      setError("Could not create the group. Please try again.");
      setBusy(false);
    }
  }

  async function joinGroup(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const store = await getStore();
      const bundle = await store.getGroupByCode(c);
      if (!bundle) {
        setError("No group found with that code.");
        setBusy(false);
        return;
      }
      router.push(`/g/${c}`);
    } catch {
      setError("Could not open that group. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col px-5 pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <div className="mb-8">
        <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Tallio" className="h-8 w-8 translate-y-[2px]" />
        </div>
        <h1 className="text-2xl font-bold">Tallio</h1>
        <p className="mt-1 text-sm text-muted">
          Split shared costs across currencies — with tax, discounts and easy
          settle-up.
        </p>
      </div>

      {recents.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-muted">Your groups</h2>
          <div className="card divide-y divide-border">
            {recents.map((g) =>
              confirmingCode === g.code ? (
                <div key={g.code} className="space-y-2 px-4 py-3">
                  <p className="text-xs text-muted">
                    Type <span className="font-semibold">delete</span> to
                    permanently delete “{g.name}” for everyone. This can&apos;t
                    be undone.
                  </p>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="delete"
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                    />
                    <button
                      className="inline-flex items-center justify-center rounded-xl bg-negative px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                      disabled={
                        deleting ||
                        confirmText.trim().toLowerCase() !== "delete"
                      }
                      onClick={() => confirmDelete(g.code)}
                    >
                      Delete
                    </button>
                    <button
                      className="btn-ghost px-3 py-2 text-sm"
                      onClick={() => setConfirmingCode(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={g.code} className="flex items-center">
                  <button
                    onClick={() => router.push(`/g/${g.code}`)}
                    className="flex flex-1 items-center gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{g.name}</div>
                      <div className="text-xs text-muted">
                        {g.code} · {g.homeCurrency}
                      </div>
                    </div>
                    <span className="text-muted">›</span>
                  </button>
                  <button
                    onClick={() => startDelete(g.code)}
                    className="btn-ghost mr-2 h-8 w-8 rounded-full !px-0 text-muted hover:text-negative"
                    aria-label={`Delete ${g.name}`}
                    title="Delete group"
                  >
                    🗑
                  </button>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <form onSubmit={createGroup} className="card mb-5 space-y-4 p-5">
        <h2 className="text-base font-semibold">Create a group</h2>
        <div>
          <label className="label">Group name</label>
          <input
            className="input"
            placeholder="e.g. Japan trip 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Home currency (for settle-up)</label>
          <select
            className="input"
            value={currency}
            onChange={(e) => changeHome(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">
            Currencies you&apos;ll use (add each country&apos;s currency)
          </label>
          <CurrencyList
            home={currency}
            value={currencies}
            onChange={setCurrencies}
          />
        </div>
        <button className="btn-brand w-full" disabled={busy || !name.trim()}>
          Create group
        </button>
      </form>

      <form onSubmit={joinGroup} className="card space-y-4 p-5">
        <h2 className="text-base font-semibold">Join with a code</h2>
        <input
          className="input uppercase tracking-[0.3em]"
          placeholder="ABC123"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="btn-outline w-full" disabled={busy || !code.trim()}>
          Open group
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-negative">{error}</p>}

      <button
        onClick={restoreGroups}
        className="mt-4 text-center text-xs text-muted underline hover:text-foreground"
      >
        Restore groups saved on this device
      </button>

      <p className="mt-auto pt-8 text-center text-xs text-muted">
        {isCloudEnabled()
          ? "Cloud sync on — share the code with your group."
          : "Single-device mode. Add Supabase keys to share across devices."}
      </p>
    </main>
  );
}
