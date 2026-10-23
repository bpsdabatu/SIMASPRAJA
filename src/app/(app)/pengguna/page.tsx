import type { Metadata } from "next";
import { Plus, ShieldCheck } from "lucide-react";
import { requireModule } from "@/lib/auth/guard";
import { userClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/nav";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, Flash, PageHeader, TableWrap } from "@/components/ui/page";
import { ConfirmSubmit, SubmitButton } from "@/components/ui/submit-button";
import { createUserAction, resetPasswordAction, setRolesAction, setUserStatusAction } from "./actions";
import { AccountDiagnostics, PasswordInput } from "./account-tools";

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

interface Row { id: string; username: string; full_name: string; nip: string | null; position_title: string | null; status: keyof typeof STATUS; last_login_at: string | null; user_roles: { role_code: string }[] }

export default async function PenggunaPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { user } = await requireModule("users.manage");
  const sp = await searchParams;
  const sb = await userClient();
  const { data, error } = await sb.from("profiles").select("id, username, full_name, nip, position_title, status, last_login_at, user_roles(role_code)").order("full_name").limit(1000);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Administrasi" title="Pengguna & Peran" description="Kelola akun, peran, dan kata sandi sementara. Anda tidak dapat mengubah peran atau status akun sendiri." />
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
        <CardHeader title={`Pengguna (${rows.length})`} />
        {error ? <EmptyState title="Data tidak dapat dimuat">Muat ulang halaman.</EmptyState> : rows.length === 0 ? <EmptyState title="Belum ada pengguna" /> : (
          <TableWrap>
            <table className="table-base">
              <thead><tr><th>Pengguna</th><th>Peran</th><th>Status</th><th>Terakhir masuk</th><th className="text-right">Aksi</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const roles = r.user_roles.map((x) => x.role_code);
                  const self = r.id === user.id;
                  const [label, tone] = STATUS[r.status] ?? ["—", "slate"];
                  return (
                    <tr key={r.id}>
                      <td><span className="font-medium">{r.full_name}</span>{self && <Badge tone="gold" className="ml-2">Anda</Badge>}<span className="block text-xs text-slate-500">@{r.username}{r.nip ? ` · NIP ${r.nip}` : ""}{r.position_title ? ` · ${r.position_title}` : ""}</span></td>
                      <td><div className="flex flex-wrap gap-1">{roles.map((x) => <Badge key={x} tone="navy">{ROLE_LABEL[x] ?? x}</Badge>)}{roles.length === 0 && <span className="text-slate-400">—</span>}</div></td>
                      <td><Badge tone={tone}>{label}</Badge></td>
                      <td className="whitespace-nowrap text-[13px] text-slate-600">{r.last_login_at ? formatDateTimeWIB(r.last_login_at) : "Belum pernah"}</td>
                      <td className="text-right">
                        {self ? <span className="text-xs text-slate-400">—</span> : (
                          <details className="relative text-left">
                            <summary className="ml-auto inline-flex h-8 cursor-pointer list-none items-center rounded-lg bg-navy-50 px-3 text-xs font-semibold text-navy-700 hover:bg-navy-100 [&::-webkit-details-marker]:hidden">Kelola</summary>
                            <div className="absolute right-0 z-20 mt-2 w-[min(92vw,24rem)] space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-lift">
                              <form action={setRolesAction} className="space-y-3">
                                <input type="hidden" name="userId" value={r.id} />
                                <RoleChecks current={roles} />
                                <SubmitButton size="sm">Simpan peran</SubmitButton>
                              </form>
                              <form action={resetPasswordAction} className="space-y-2 border-t border-slate-100 pt-3">
                                <input type="hidden" name="userId" value={r.id} />
                                <Field label="Atur ulang kata sandi sementara" htmlFor={`pw-${r.id}`}><PasswordInput id={`pw-${r.id}`} /></Field>
                                <ConfirmSubmit size="sm" variant="outline" message="Atur ulang kata sandi? Semua sesi pengguna ini akan diakhiri.">Atur ulang</ConfirmSubmit>
                              </form>
                              <form action={setUserStatusAction} className="border-t border-slate-100 pt-3">
                                <input type="hidden" name="userId" value={r.id} /><input type="hidden" name="to" value={r.status === "active" ? "suspended" : "active"} />
                                {r.status === "active"
                                  ? <ConfirmSubmit size="sm" variant="danger" message="Tangguhkan akun ini? Pengguna tidak dapat masuk dan sesinya diakhiri.">Tangguhkan akun</ConfirmSubmit>
                                  : <SubmitButton size="sm" variant="soft">Aktifkan akun</SubmitButton>}
                              </form>
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
    </div>
  );
}
