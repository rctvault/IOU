"use client";

import { useEffect } from "react";
import { initials } from "@/lib/format";

export function Avatar({
  name,
  color,
  size = 36,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        background: color,
        width: size,
        height: size,
        fontSize: size * 0.38,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** A bottom sheet / modal used for the add-expense, settle-up and members flows. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative mt-auto flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-background shadow-2xl">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="btn-ghost -mr-2 h-9 w-9 rounded-full !px-0 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="border-t border-border bg-surface px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
