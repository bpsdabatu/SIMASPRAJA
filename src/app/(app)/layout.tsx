import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/session";
import { NAV_ITEMS, ROLE_LABEL, canSeeNav } from "@/lib/nav";
import { STAGE_LABEL } from "@/lib/auth/context";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, context } = await requireContext();
  if (user.mustChangePassword) redirect("/ganti-password");

  // Menu ditampilkan hanya bila pengguna memiliki izin (kenyamanan UI; RLS tetap penentu akses).
  const items = NAV_ITEMS.filter((i) => canSeeNav(i, user));

  return (
    <AppShell
      user={{ fullName: user.fullName, username: user.username, roleLabels: user.roles.map((r) => ROLE_LABEL[r] ?? r) }}
      context={{ year: context.year, stageLabel: STAGE_LABEL[context.stage] }}
      items={items}
    >
      {children}
    </AppShell>
  );
}
