"use client";

import { useEffect, useState } from "react";
import { Field, Select } from "@/components/ui/input";

interface Opt { id: string; label: string }

/**
 * Penugasan pada form tambah dokumen mengikuti jenis dokumen yang dipilih (#type):
 *  - Nota Dinas PPTK kepada PPK : pilih PPK tujuan (wajib).
 *  - Nota Dinas PPK / DPP        : PPK = penyusun (Anda); pilih PPBJ tujuan/pereviu (dapat menyusul).
 */
export function AssignmentFields({ ppk, ppbj, recipients, initial }: { ppk: Opt[]; ppbj: Opt[]; recipients: Record<string, "ppk" | "ppbj">; initial: string }) {
  const [type, setType] = useState(initial);
  useEffect(() => {
    const el = document.getElementById("type") as HTMLSelectElement | null;
    if (!el) return;
    setType(el.value);
    const h = () => setType(el.value);
    el.addEventListener("change", h);
    return () => el.removeEventListener("change", h);
  }, []);
  const toPpk = recipients[type] === "ppk";
  return toPpk ? (
    <Field label="PPK tujuan" htmlFor="ppk" hint="Nota Dinas PPTK disampaikan kepada PPK, yang menerima lalu menyusun dan menetapkan DPP.">
      <Select id="ppk" name="ppk" required defaultValue=""><option value="" disabled>Pilih PPK</option>{ppk.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
    </Field>
  ) : (
    <Field label="PPBJ (tujuan/pereviu)" htmlFor="ppbj" hint="PPK penyusun adalah Anda. PPBJ wajib ditentukan sebelum diajukan.">
      <Select id="ppbj" name="ppbj" defaultValue=""><option value="">— Belum ditentukan —</option>{ppbj.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
    </Field>
  );
}
