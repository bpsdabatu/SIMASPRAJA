"use client";

import { PrintSettingsMenu } from "@/components/print-settings";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Tombol kirim yang otomatis nonaktif + indikator saat Server Action berjalan. */
export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/** Tombol dengan konfirmasi native sebelum aksi destruktif/final. */
export function ConfirmSubmit({
  message, children, ...props
}: ButtonProps & { message: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending || props.disabled}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}
      {...props}
    >
      {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

export function PrintButton({ label = "Cetak" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <PrintSettingsMenu iconOnly label="Pengaturan cetak" />
      <Button type="button" variant="outline" onClick={() => window.print()}>
        {label}
      </Button>
    </span>
  );
}
