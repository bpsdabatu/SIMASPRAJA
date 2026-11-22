import type { Metadata } from "next";
import { Download, Plus, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { loadTempPasswords } from "@/lib/auth/temp-credential";
import { EVENT_LABEL, loadAccountHistory, loadAccountSummaries } from "@/lib/account-history";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/nav";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { ConfirmSubmit, SubmitButton } from "@/components/ui/submit-button";
import { createUserAction, deleteUserAction, resetPasswordAction, setRolesAction, setUserStatusAction, updateUserAction } from "./actions";
import { AccountDiagnostics, PasswordInput, SecretCell } from "./account-tools";

export const metadata: Metadata = { title: "Pengguna & Peran" };
export const dynamic = "force-dynamic";
const ROLES = ["admin", "ppk", "pptk", "ppbj"];
const STATUS = { active: ["Aktif", "green"], suspended: ["Ditangguhkan", "amber"], disabled: ["Nonaktif", "slate"] } as const;

function RoleChecks({ current = [] }: { current?: string[] }) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-1.5 text-sm font-medium text-slate-700">Peran</legend>
      {ROLES.map((r) => (
        <label key={r} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50">
          <input type="checkbox" name="roles" value={r} defaultChecked={current.includes(r)} className="accent-navy-700" /> {ROLE_LABEL[r]}
        </label>
      ))}
    </fieldset>
  );
}

interface Row { id: string; username: string; full_name: string; nip: string | null; position_title: string | null; status: keyof typeof STATUS; last_login_at: string | null; must_change_password: boolean; user_roles: { role_code: string }[] }

export default async function PenggunaPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; u?: string; status?: string }> }) {
  const { user } = await requireModule("users.manage");
  const sp = await searchParams;
  const sb = await userClient();
  const { data, error } = await sb.from("profiles").select("id, username, full_name, nip, position_title, status, last_login_at, must_change_password, user_roles(role_code)").order("full_name").limit(1000);
  const allRows = (data ?? []) as unknown as Row[];
  const statusFilter = sp.status && sp.status in STATUS ? sp.status : "";
  const rows = statusFilter ? allRows.filter((r) => r.status === statusFilter) : allRows;
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
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman.</EmptyState> : rows.length === 0 ? <EmptyState title="Belum ada pengguna" /> : (
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>Pengguna</th><th>Username</th><th>Peran</th><th>Status</th><th>Kata sandi sementara</th><th>Dibuat</th><th>Reset terakhir</th><th>Terakhir masuk</th><th className="text-right">Aksi</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const roles = r.user_roles.map((x) => x.role_code);
                  const self = r.id === user.id;
                  const [label, tone] = STATUS[r.status] ?? ["—", "slate"];
                  return (
                    <tr key={r.id}>
                      <td><span className="font-medium">{r.full_name}</span>{self && <Badge tone="gold" className="ml-2">Anda</Badge>}<span className="block text-xs text-slate-500">@{r.username}{r.nip ? ` · NIP ${r.nip}` : ""}{r.position_title ? ` · ${r.position_title}` : ""}</span></td>
                      <td className="whitespace-nowrap font-mono text-[13px]">{r.username}</td>
                      <td><div className="flex flex-wrap gap-1">{roles.map((x) => <Badge key={x} tone="navy">{ROLE_LABEL[x] ?? x}</Badge>)}{roles.length === 0 && <span className="text-slate-400">—</span>}</div></td>
                      <td><Badge tone={tone}>{label}</Badge></td>
                      <td className="text-[13px]">{temp.map.get(r.id) ? <SecretCell value={temp.map.get(r.id)!} /> : r.must_change_password ? <span className="text-amber-700">Belum diganti (klik Reset untuk membuat yang baru)</span> : <span className="text-slate-400">Sudah diganti pengguna</span>}</td>
                      <td className="whitespace-nowrap text-[13px] text-slate-600">{sums.map.get(r.id)?.createdAt ? <>{formatDateTimeWIB(sums.map.get(r.id)!.createdAt!)}<span className="block text-xs text-slate-400">{sums.map.get(r.id)!.createdBy ? `oleh @${sums.map.get(r.id)!.createdBy}` : ""}</span></> : <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap text-[13px] text-slate-600">{sums.map.get(r.id)?.lastResetAt ? <>{formatDateTimeWIB(sums.map.get(r.id)!.lastResetAt!)}<span className="block text-xs text-slate-400">{sums.map.get(r.id)!.lastResetBy ? `oleh @${sums.map.get(r.id)!.lastResetBy}` : ""} · {sums.map.get(r.id)!.resets}×</span></> : <span className="text-slate-400">Belum pernah</span>}</td>
                      <td className="whitespace-nowrap text-[13px] text-slate-600">{r.last_login_at ? formatDateTimeWIB(r.last_login_at) : "Belum pernah"}</td>
                      <td className="text-right">
                        {(
                          <details className="relative text-left">
                            <summary className="ml-auto inline-flex h-8 cursor-pointer list-none items-center rounded-lg bg-navy-50 px-3 text-xs font-semibold text-navy-700 hover:bg-navy-100 [&::-webkit-details-marker]:hidden">Kelola</summary>
                            <div className="absolute right-0 z-20 mt-2 w-[min(92vw,24rem)] space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-lift">
                              <form action={updateUserAction} className="grid gap-2 sm:grid-cols-2">
                                <input type="hidden" name="userId" value={r.id} />
                                <p className="text-sm font-semibold text-navy-800 sm:col-span-2">Ubah data akun</p>
                                <Field label="Nama lengkap" htmlFor={`fn-${r.id}`} className="sm:col-span-2"><Input id={`fn-${r.id}`} name="fullName" required maxLength={150} defaultValue={r.full_name} /></Field>
                                <Field label="Username" htmlFor={`un-${r.id}`} className="sm:col-span-2"><Input id={`un-${r.id}`} name="username" required maxLength={32} autoCapitalize="none" spellCheck={false} defaultValue={r.username} /></Field>
                                <Field label="NIP" htmlFor={`nip-${r.id}`}><Input id={`nip-${r.id}`} name="nip" maxLength={30} inputMode="numeric" defaultValue={r.nip ?? ""} /></Field>
                                <Field label="Jabatan" htmlFor={`jb-${r.id}`}><Input id={`jb-${r.id}`} name="position" maxLength={150} defaultValue={r.position_title ?? ""} /></Field>
                                <div className="sm:col-span-2"><SubmitButton size="sm" variant="outline">Simpan data</SubmitButton></div>
                              </form>
                              {self ? <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">Peran, kata sandi, status, dan penghapusan akun sendiri tidak dapat diubah dari sini (pengaman agar admin tidak terkunci). Ganti kata sandi melalui menu profil.</p> : <>
                              <form action={setRolesAction} className="space-y-3 border-t border-slate-100 pt-3">
                                <input type="hidden" name="userId" value={r.id} />
                                <RoleChecks current={roles} />
                                <SubmitButton size="sm">Simpan peran</SubmitButton>
                              </form>
                              <form action={resetPasswordAction} className="space-y-2 border-t border-slate-100 pt-3">
                                <input type="hidden" name="userId" value={r.id} />
                                <Field label="Atur ulang kata sandi sementara" htmlFor={`pw-${r.id}`} hint="Kosongkan untuk dibuat acak otomatis."><PasswordInput id={`pw-${r.id}`} required={false} /></Field>
                                <ConfirmSubmit size="sm" variant="outline" message="Atur ulang kata sandi? Semua sesi pengguna ini akan diakhiri.">Atur ulang</ConfirmSubmit>
                              </form>
                              <div className="space-y-2 border-t border-slate-100 pt-3">
                                <p className="text-sm font-semibold text-navy-800">Status akun</p>
                                {r.status === "active" ? (
                                  <div className="flex flex-wrap gap-2">
                                    <form action={setUserStatusAction}><input type="hidden" name="userId" value={r.id} /><input type="hidden" name="to" value="suspended" />
                                      <ConfirmSubmit size="sm" variant="outline" message="Tangguhkan akun ini sementara? Pengguna tidak dapat masuk dan sesinya diakhiri; dapat diaktifkan kembali.">Tangguhkan</ConfirmSubmit></form>
                                    <form action={setUserStatusAction}><input type="hidden" name="userId" value={r.id} /><input type="hidden" name="to" value="disabled" />
                                      <ConfirmSubmit size="sm" variant="danger" message="Nonaktifkan akun ini (tidak diperlukan lagi)? Pengguna tidak dapat masuk dan tidak muncul pada pilihan penugasan; data yang pernah dibuat tetap utuh.">Nonaktifkan</ConfirmSubmit></form>
                                  </div>
                                ) : (
                                  <form action={setUserStatusAction}><input type="hidden" name="userId" value={r.id} /><input type="hidden" name="to" value="active" /><SubmitButton size="sm" variant="soft">Aktifkan akun</SubmitButton></form>
                                )}
                                <p className="text-xs text-slate-500">Tangguhkan = sementara. Nonaktifkan = tidak dipakai lagi, tetapi riwayat dan data tetap ada.</p>
                              </div>
                              <form action={deleteUserAction} className="space-y-2 border-t border-slate-100 pt-3">
                                <input type="hidden" name="userId" value={r.id} />
                                <Field label="Hapus akun permanen" htmlFor={`del-${r.id}`} hint={`Hanya untuk akun yang belum dipakai pada data lain. Ketik @${r.username} (tanpa @) untuk mengonfirmasi.`}><Input id={`del-${r.id}`} name="confirm" required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={r.username} /></Field>
                                <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" name="detach" value="1" className="mt-0.5 accent-navy-700" /> Lepaskan keterkaitan dengan data lain (kolom pembuat/penanggung jawab pada data lama dikosongkan). Dibutuhkan bila akun sudah pernah dipakai; data itu sendiri tidak dihapus.</label>
                                <ConfirmSubmit size="sm" variant="danger" message="Hapus akun ini secara permanen? Tindakan tidak dapat dibatalkan. Bila akun sudah dipakai pada data lain, penghapusan ditolak kecuali opsi “Lepaskan keterkaitan” dicentang; alternatif yang lebih aman: Nonaktifkan.">Hapus akun</ConfirmSubmit>
                              </form>
                              </>}
                            </div>
                          </details>
                        )}
                      </td>
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
