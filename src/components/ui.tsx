"use client";

import { useCallback, useEffect, useState } from "react";
import { initials, readableTextOn } from "@/lib/format";

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
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        background: color,
        color: readableTextOn(color),
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
  const [show, setShow] = useState(false);

  // Animate in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Animate out, then unmount via the parent's onClose.
  const handleClose = useCallback(() => {
    setShow(false);
    setTimeout(onClose, 300);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && handleClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, handleClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div
        className="sheet-backdrop absolute inset-0 bg-black/40"
        data-show={show ? "true" : "false"}
        onClick={handleClose}
        aria-hidden
      />
      <div
        className="sheet-panel relative mt-auto flex max-h-[92vh] w-full max-w-md flex-col rounded-t-3xl bg-background shadow-2xl"
        data-show={show ? "true" : "false"}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-black/15" />
        <div className="flex items-center justify-between px-5 pb-2 pt-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={handleClose}
            className="btn-ghost -mr-2 h-9 w-9 rounded-full !px-0 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="scroll-touch flex-1 overflow-y-auto px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
        {footer && (
          <div className="border-t border-border bg-surface px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
