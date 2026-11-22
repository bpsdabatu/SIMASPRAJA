import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { loadTempPasswords } from "@/lib/auth/temp-credential";
import { EVENT_LABEL, loadAccountHistory, loadAccountSummaries } from "@/lib/account-history";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { loadUserRows, type UserRow } from "@/lib/user-rows";
import { ROLE_LABEL } from "@/lib/nav";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { createUserAction } from "./actions";
import { AccountDiagnostics, PasswordInput, SecretCell } from "./account-tools";
import { RoleChecks } from "./role-checks";

export const metadata: Metadata = { title: "Pengguna & Peran" };
export const dynamic = "force-dynamic";
const STATUS = { active: ["Aktif", "green"], suspended: ["Ditangguhkan", "amber"], disabled: ["Nonaktif", "slate"] } as const;


export default async function PenggunaPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; u?: string; status?: string }> }) {
  const { user } = await requireModule("users.manage");
  const sp = await searchParams;
  const sb = await userClient();
  const { rows: allRows, error } = await loadUserRows(sb, { organizationId: user.organizationId });
  const statusFilter = sp.status && sp.status in STATUS ? sp.status : "";
  const rows = statusFilter ? allRows.filter((r: UserRow) => r.status === statusFilter) : allRows;
  const counts = { active: 0, suspended: 0, disabled: 0 } as Record<string, number>;
  for (const r of allRows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const [temp, sums, hist] = await Promise.all([
    loadTempPasswords(rows.filter((r) => r.must_change_password).map((r) => r.id)),
    loadAccountSummaries(user.organizationId),
    loadAccountHistory(user.organizationId, { username: /^[a-z0-9._-]{3,32}$/.test(sp.u ?? "") ? sp.u : undefined, limit: 100 }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Administrasi" title="Pengguna & Peran" description="Rekap seluruh akun (username, peran, status) dan kata sandi sementara bagi akun yang belum menggantinya. Reset cepat per akun menghasilkan kata sandi acak yang langsung tampil di sini. Anda tidak dapat mengubah peran atau status akun sendiri." />
      <Flash ok={sp.ok} err={sp.err} />

      <Card>
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><Plus size={16} aria-hidden /> Tambah pengguna</summary>
          <form action={createUserAction} className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-2">
            <Field label="Username" htmlFor="username" hint="Huruf kecil, angka, titik, garis bawah, strip (3–32)."><Input id="username" name="username" required maxLength={32} autoCapitalize="none" spellCheck={false} /></Field>
            <Field label="Nama lengkap" htmlFor="fullName"><Input id="fullName" name="fullName" required maxLength={150} /></Field>
            <Field label="NIP" htmlFor="nip"><Input id="nip" name="nip" maxLength={30} inputMode="numeric" /></Field>
            <Field label="Jabatan" htmlFor="position"><Input id="position" name="position" maxLength={150} /></Field>
            <div className="sm:col-span-2"><RoleChecks /><p className="mt-1.5 text-xs text-slate-500">Peran <b>PPTK</b> otomatis menampilkan akun ini di <a href="/master?tab=pptk" className="font-semibold text-navy-700 underline">Data Master › PPTK</a> dan pada pilihan PPTK di Input Anggaran.</p></div>
            <Field label="Kata sandi sementara" htmlFor="password" hint="Minimal 10 karakter, huruf besar, huruf kecil, angka. Pengguna wajib menggantinya saat masuk pertama." className="sm:col-span-2">
              <PasswordInput id="password" />
            </Field>
            <div className="sm:col-span-2"><SubmitButton pendingText="Membuat...">Buat pengguna</SubmitButton></div>
          </form>
        </details>
      </Card>

      <Card>
        <details>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-navy-800 [&::-webkit-details-marker]:hidden"><ShieldCheck size={16} aria-hidden /> Periksa kesiapan pembuatan akun</summary>
          <AccountDiagnostics />
        </details>
      </Card>

      <Card>
        <CardHeader title={`Pengguna (${rows.length})`} description="Kata sandi yang sudah diganti pengguna sendiri tidak dapat dilihat (hanya tersimpan sebagai hash di Supabase Auth); gunakan Reset untuk membuat yang baru. Akun yang tidak diperlukan lagi: Nonaktifkan (data tetap utuh) atau Hapus (hanya bila belum dipakai pada data lain)." actions={<><form action="/pengguna" className="flex gap-2"><Select name="status" defaultValue={statusFilter} aria-label="Filter status akun" className="h-8 w-44 text-xs"><option value="">Semua ({allRows.length})</option><option value="active">Aktif ({counts.active})</option><option value="suspended">Ditangguhkan ({counts.suspended})</option><option value="disabled">Nonaktif ({counts.disabled})</option></Select><button className={buttonVariants({ variant: "outline", size: "sm" })}>Terapkan</button></form><a href="/pengguna/export?format=xlsx" className={buttonVariants({ variant: "outline", size: "sm" })}><Download size={14} aria-hidden /> Excel</a><a href="/pengguna/export?format=csv" className={buttonVariants({ variant: "outline", size: "sm" })}><Download size={14} aria-hidden /> CSV</a></>} />
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman. Bila tetap gagal, sampaikan pesan berikut kepada pengembang: <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs">{error}</code></EmptyState> : rows.length === 0 ? <EmptyState title="Belum ada pengguna" /> : (
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>Pengguna</th><th>Aksi</th><th>Username</th><th>Peran</th><th>Status</th><th>Kata sandi sementara</th><th>Dibuat</th><th>Reset terakhir</th><th>Terakhir masuk</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const roles = r.user_roles.map((x) => x.role_code);
                  const self = r.id === user.id;
                  const [label, tone] = STATUS[r.status] ?? ["—", "slate"];
                  return (
                    <tr key={r.id}>
                      <td><span className="font-medium">{r.full_name}</span>{self && <Badge tone="gold" className="ml-2">Anda</Badge>}<span className="block text-xs text-slate-500">@{r.username}{r.nip ? ` · NIP ${r.nip}` : ""}{r.position_title ? ` · ${r.position_title}` : ""}</span></td>
                      <td className="whitespace-nowrap"><Link href={`/pengguna/${r.id}`} className={buttonVariants({ variant: "primary", size: "sm" })}>{self ? "Ubah data" : "Kelola / Hapus"}</Link></td>
                      <td className="whitespace-nowrap font-mono text-[13px]">{r.username}</td>
                      <td><div className="flex flex-wrap gap-1">{roles.map((x) => <Badge key={x} tone="navy">{ROLE_LABEL[x] ?? x}</Badge>)}{roles.length === 0 && <span className="text-slate-400">—</span>}</div></td>
                      <td><Badge tone={tone}>{label}</Badge></td>
                      <td className="text-[13px]">{temp.map.get(r.id) ? <SecretCell value={temp.map.get(r.id)!} /> : r.must_change_password ? <span className="text-amber-700">Belum diganti (klik Reset untuk membuat yang baru)</span> : <span className="text-slate-400">Sudah diganti pengguna</span>}</td>
                      <td className="whitespace-nowrap text-[13px] text-slate-600">{sums.map.get(r.id)?.createdAt ? <>{formatDateTimeWIB(sums.map.get(r.id)!.createdAt!)}<span className="block text-xs text-slate-400">{sums.map.get(r.id)!.createdBy ? `oleh @${sums.map.get(r.id)!.createdBy}` : ""}</span></> : <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap text-[13px] text-slate-600">{sums.map.get(r.id)?.lastResetAt ? <>{formatDateTimeWIB(sums.map.get(r.id)!.lastResetAt!)}<span className="block text-xs text-slate-400">{sums.map.get(r.id)!.lastResetBy ? `oleh @${sums.map.get(r.id)!.lastResetBy}` : ""} · {sums.map.get(r.id)!.resets}×</span></> : <span className="text-slate-400">Belum pernah</span>}</td>
                      <td className="whitespace-nowrap text-[13px] text-slate-600">{r.last_login_at ? formatDateTimeWIB(r.last_login_at) : "Belum pernah"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader title={sp.u ? `Riwayat akun @${sp.u}` : "Riwayat akun"} description="Catatan permanen (tidak dapat diubah) kapan akun dibuat, kata sandi diatur ulang/diganti, status dan peran berubah, beserta pelakunya. Kata sandi tidak pernah dicatat di sini." actions={sp.u ? <a href="/pengguna" className={buttonVariants({ variant: "outline", size: "sm" })}>Semua akun</a> : undefined} />
        {!hist.ready ? <EmptyState title="Riwayat akun belum aktif">Jalankan migrasi <code>0017_riwayat_akun.sql</code> di Supabase, lalu muat ulang.</EmptyState> : hist.rows.length === 0 ? <EmptyState title="Belum ada riwayat" /> : (
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>Waktu (WIB)</th><th>Akun</th><th>Kejadian</th><th>Oleh</th></tr></thead>
              <tbody>
                {hist.rows.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap text-[13px]">{formatDateTimeWIB(h.occurred_at)}</td>
                    <td><a href={`/pengguna?u=${h.username}`} className="font-mono text-[13px] text-navy-700 underline-offset-2 hover:underline">@{h.username}</a>{h.full_name ? <span className="block text-xs text-slate-500">{h.full_name}</span> : null}</td>
                    <td>{EVENT_LABEL[h.event] ?? h.event}</td>
                    <td className="text-[13px] text-slate-600">{h.actor_username ? `@${h.actor_username}` : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
