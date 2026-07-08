"use client";

import { useState } from "react";
import { MEMBER_COLORS, nextColor } from "@/lib/ids";
import { getStore } from "@/lib/store";
import { isActive, type GroupBundle } from "@/lib/types";
import { Avatar, Sheet } from "./ui";

export function MembersSheet({
  bundle,
  onClose,
  onChanged,
}: {
  bundle: GroupBundle;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const members = bundle.members;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const store = await getStore();
    await store.addMember(bundle.group.id, {
      name: name.trim(),
      color: nextColor(members.length),
    });
    setName("");
    setBusy(false);
    await onChanged();
  }

  async function rename(id: string, newName: string) {
    const store = await getStore();
    await store.updateMember(id, { name: newName });
    await onChanged();
  }

  async function remove(id: string, name: string) {
    const inExpenses = bundle.expenses.some(
      (e) =>
        e.payerMemberId === id ||
        e.participants.some((p) => p.memberId === id),
    );
    const message = inExpenses
      ? `${name} appears in existing expenses. Removing them can break those records — use "Left?" instead if they've just left the trip.\n\nRemove anyway? This can't be undone.`
      : `Remove ${name}? This can't be undone.`;
    if (!window.confirm(message)) return;
    const store = await getStore();
    await store.removeMember(id);
    await onChanged();
  }

  async function refreshColors() {
    setBusy(true);
    const store = await getStore();
    for (let i = 0; i < members.length; i++) {
      await store.updateMember(members[i].id, {
        color: MEMBER_COLORS[i % MEMBER_COLORS.length],
      });
    }
    setBusy(false);
    await onChanged();
  }

  async function setActive(id: string, active: boolean) {
    const store = await getStore();
    await store.updateMember(id, { active });
    await onChanged();
  }

  return (
    <Sheet open title="Members" onClose={onClose}>
      <div className="space-y-2">
        {members.map((m) => {
          const active = isActive(m);
          return (
            <div key={m.id} className="flex items-center gap-2">
              <span className={active ? "" : "opacity-40"}>
                <Avatar name={m.name} color={m.color} />
              </span>
              <input
                className={`input flex-1 ${active ? "" : "opacity-60"}`}
                defaultValue={m.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== m.name) rename(m.id, v);
                }}
              />
              <button
                onClick={() => setActive(m.id, !active)}
                className="btn-ghost h-9 rounded-full px-2 text-xs"
                title={active ? "Mark as left the trip" : "Rejoin the trip"}
              >
                {active ? "Left?" : "Rejoin"}
              </button>
              <button
                onClick={() => remove(m.id, m.name)}
                className="btn-ghost h-9 w-9 rounded-full !px-0 text-negative"
                aria-label={`Remove ${m.name}`}
              >
                ✕
              </button>
            </div>
          );
        })}
        {members.length === 0 && (
          <p className="text-sm text-muted">No members yet — add the group.</p>
        )}
      </div>

      <form onSubmit={add} className="mt-5 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Add a person…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-brand" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>

      {members.length > 0 && (
        <button
          onClick={refreshColors}
          disabled={busy}
          className="btn-ghost mt-4 w-full text-sm text-muted"
        >
          Refresh avatar colors
        </button>
      )}

      <p className="mt-4 text-xs text-muted">
        “Left?” marks someone who has left the trip — they&apos;re kept out of new
        expenses but stay in past ones and balances. “Remove” deletes them
        entirely (past expenses are unaffected).
      </p>
    </Sheet>
  );
}
