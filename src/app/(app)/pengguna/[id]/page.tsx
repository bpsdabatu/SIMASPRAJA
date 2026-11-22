import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireModule } from "@/lib/auth/guard";
import { loadTempPasswords } from "@/lib/auth/temp-credential";
import { EVENT_LABEL, loadAccountHistory } from "@/lib/account-history";
import { userClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/action-utils";
import { ROLE_LABEL } from "@/lib/nav";
import { formatDateTimeWIB } from "@/lib/format";
import { Badge, Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Flash, PageHeader } from "@/components/ui/page";
import { ConfirmSubmit, SubmitButton } from "@/components/ui/submit-button";
import { deleteUserAction, resetPasswordAction, setRolesAction, setUserStatusAction, updateUserAction } from "../actions";
import { PasswordInput, SecretCell } from "../account-tools";
import { RoleChecks } from "../role-checks";

export const metadata: Metadata = { title: "Kelola Pengguna" };
export const dynamic = "force-dynamic";
const STATUS = { active: ["Aktif", "green"], suspended: ["Ditangguhkan", "amber"], disabled: ["Nonaktif", "slate"] } as const;

interface Row { id: string; username: string; full_name: string; nip: string | null; position_title: string | null; status: keyof typeof STATUS; last_login_at: string | null; must_change_password: boolean; user_roles: { role_code: string }[] }

/** Halaman khusus untuk mengubah, menonaktifkan, mereset, dan menghapus satu akun (Admin). */
export default async function KelolaPenggunaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { user } = await requireModule("users.manage");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const sb = await userClient();
  const { data } = await sb.from("profiles").select("id, username, full_name, nip, position_title, status, last_login_at, must_change_password, user_roles(role_code)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as unknown as Row;
  const self = r.id === user.id;
  const roles = r.user_roles.map((x) => x.role_code);
  const [label, tone] = STATUS[r.status] ?? ["—", "slate"];
  const [temp, hist] = await Promise.all([
    r.must_change_password ? loadTempPasswords([r.id]) : Promise.resolve({ map: new Map<string, string>() }),
    loadAccountHistory(user.organizationId, { username: r.username, limit: 15 }),
  ]);
  const back = `/pengguna/${r.id}`;
  const hidden = (<><input type="hidden" name="userId" value={r.id} /><input type="hidden" name="back" value={back} /></>);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/pengguna" className={buttonVariants({ variant: "outline", size: "sm" })}><ArrowLeft size={14} aria-hidden /> Kembali ke daftar pengguna</Link>
      <PageHeader eyebrow="Pengguna & Peran" title={r.full_name} description={`@${r.username}${r.nip ? ` · NIP ${r.nip}` : ""}${r.position_title ? ` · ${r.position_title}` : ""}`} />
      <Flash ok={sp.ok} err={sp.err} />

      <Card>
        <dl className="grid gap-4 p-5 sm:grid-cols-4">
          <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</dt><dd className="mt-1"><Badge tone={tone}>{label}</Badge></dd></div>
          <div className="sm:col-span-2"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Peran</dt><dd className="mt-1 flex flex-wrap gap-1">{roles.map((x) => <Badge key={x} tone="navy">{ROLE_LABEL[x] ?? x}</Badge>)}{roles.length === 0 && <span className="text-slate-400">—</span>}</dd></div>
          <div><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Terakhir masuk</dt><dd className="mt-1 text-sm">{r.last_login_at ? formatDateTimeWIB(r.last_login_at) : "Belum pernah"}</dd></div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Ubah data akun" description="Nama lengkap, username, NIP, dan jabatan. Username baru berlaku untuk masuk berikutnya." />
        <form action={updateUserAction} className="grid gap-4 p-5 sm:grid-cols-2">
          {hidden}
          <Field label="Nama lengkap" htmlFor="fullName"><Input id="fullName" name="fullName" required maxLength={150} defaultValue={r.full_name} /></Field>
          <Field label="Username" htmlFor="username"><Input id="username" name="username" required maxLength={32} autoCapitalize="none" spellCheck={false} defaultValue={r.username} /></Field>
          <Field label="NIP" htmlFor="nip"><Input id="nip" name="nip" maxLength={30} inputMode="numeric" defaultValue={r.nip ?? ""} /></Field>
          <Field label="Jabatan" htmlFor="position"><Input id="position" name="position" maxLength={150} defaultValue={r.position_title ?? ""} /></Field>
          <div className="sm:col-span-2"><SubmitButton variant="primary" pendingText="Menyimpan...">Simpan data</SubmitButton></div>
        </form>
      </Card>

      {self ? (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">Peran, kata sandi, status, dan penghapusan akun sendiri tidak dapat diubah dari sini (pengaman agar admin tidak terkunci). Ganti kata sandi melalui menu profil.</p>
      ) : (
        <>
          <Card>
            <CardHeader title="Peran" description="Peran menentukan menu dan hak akses. Perubahan berlaku pada sesi berikutnya." />
            <form action={setRolesAction} className="space-y-3 p-5">{hidden}<RoleChecks current={roles} /><SubmitButton variant="primary">Simpan peran</SubmitButton></form>
          </Card>

          <Card>
            <CardHeader title="Kata sandi sementara" description="Atur ulang menghasilkan kata sandi sementara baru; semua sesi pengguna ini diakhiri." />
            <div className="space-y-3 p-5">
              {temp.map.get(r.id) && <p className="text-sm">Saat ini: <SecretCell value={temp.map.get(r.id)!} /></p>}
              <form action={resetPasswordAction} className="space-y-2">{hidden}
                <Field label="Kata sandi sementara baru" htmlFor="pw" hint="Kosongkan untuk dibuat acak otomatis."><PasswordInput id="pw" required={false} /></Field>
                <ConfirmSubmit variant="outline" message="Atur ulang kata sandi? Semua sesi pengguna ini akan diakhiri.">Atur ulang kata sandi</ConfirmSubmit>
              </form>
            </div>
          </Card>

          <Card>
            <CardHeader title="Status akun" description="Tangguhkan = sementara. Nonaktifkan = akun tidak dipakai lagi (tidak bisa masuk, tidak muncul pada pilihan penugasan), tetapi riwayat dan data tetap ada." />
            <div className="flex flex-wrap gap-3 p-5">
              {r.status === "active" ? (
                <>
                  <form action={setUserStatusAction}>{hidden}<input type="hidden" name="to" value="suspended" /><ConfirmSubmit variant="outline" message="Tangguhkan akun ini sementara? Pengguna tidak dapat masuk dan sesinya diakhiri; dapat diaktifkan kembali.">Tangguhkan</ConfirmSubmit></form>
                  <form action={setUserStatusAction}>{hidden}<input type="hidden" name="to" value="disabled" /><ConfirmSubmit variant="danger" message="Nonaktifkan akun ini (tidak diperlukan lagi)? Pengguna tidak dapat masuk dan tidak muncul pada pilihan penugasan; data yang pernah dibuat tetap utuh.">Nonaktifkan akun</ConfirmSubmit></form>
                </>
              ) : (
                <form action={setUserStatusAction}>{hidden}<input type="hidden" name="to" value="active" /><SubmitButton variant="primary">Aktifkan kembali</SubmitButton></form>
              )}
            </div>
          </Card>

          <Card className="border-red-200">
            <CardHeader title="Hapus akun permanen" description="Untuk akun yang tidak diperlukan lagi. Tindakan tidak dapat dibatalkan." />
            <form action={deleteUserAction} className="space-y-3 p-5">
              {hidden}
              <Field label={`Ketik username "${r.username}" untuk mengonfirmasi`} htmlFor="confirm"><Input id="confirm" name="confirm" required autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={r.username} /></Field>
              <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" name="detach" value="1" className="mt-1 accent-navy-700" /> <span><b>Lepaskan keterkaitan dengan data lain.</b> Bila akun sudah pernah dipakai (anggaran, realisasi, dokumen), kolom pembuat/penanggung jawab pada data lama dikosongkan agar akun dapat dihapus. Data itu sendiri tidak dihapus. Jika masih ditolak, gunakan Nonaktifkan.</span></label>
              <ConfirmSubmit variant="danger" message="Hapus akun ini secara permanen? Tindakan tidak dapat dibatalkan. Bila akun sudah dipakai pada data lain, penghapusan ditolak kecuali opsi “Lepaskan keterkaitan” dicentang; alternatif yang lebih aman: Nonaktifkan.">Hapus akun permanen</ConfirmSubmit>
            </form>
          </Card>
        </>
      )}

      {hist.ready && hist.rows.length > 0 && (
        <Card>
          <CardHeader title="Riwayat terbaru akun ini" />
          <ul className="divide-y divide-slate-100 text-sm">
            {hist.rows.map((h) => <li key={h.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5"><span>{EVENT_LABEL[h.event] ?? h.event}{h.actor_username ? <span className="text-slate-500"> · oleh @{h.actor_username}</span> : null}</span><span className="text-xs text-slate-500">{formatDateTimeWIB(h.occurred_at)}</span></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
