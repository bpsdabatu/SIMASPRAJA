export type IconName =
  | "layout-dashboard" | "wallet" | "calendar-clock" | "receipt" | "table-properties"
  | "file-bar-chart" | "files" | "database" | "users" | "scroll-text" | "presentation";

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  permission: string;
  /** Keterangan singkat (palet menu & bantuan). */
  hint: string;
  group: "Utama" | "Perencanaan & Pelaksanaan" | "Pelaporan" | "Pengadaan" | "Administrasi";
  /** Hanya tampil untuk akun berperan admin (selain izin). */
  adminOnly?: boolean;
}

/** Seluruh menu aktif. Tampil hanya bila pengguna memiliki izin (kenyamanan UI; RLS tetap penentu akses). */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dasbor", href: "/dashboard", hint: "Ringkasan capaian dan peringkat realisasi", icon: "layout-dashboard", permission: "dashboard.view", group: "Utama" },
  { label: "Input Anggaran", href: "/anggaran", hint: "Pagu per butir, versi, dan tahun anggaran", icon: "wallet", permission: "budget.view", group: "Perencanaan & Pelaksanaan" },
  { label: "Anggaran Kas", href: "/anggaran-kas", hint: "Rencana penarikan kas triwulanan", icon: "calendar-clock", permission: "cashplan.view", group: "Perencanaan & Pelaksanaan" },
  { label: "Input Realisasi", href: "/realisasi", hint: "Input realisasi (tanggal SP2D) dan daftar transaksi", icon: "receipt", permission: "realization.view", group: "Perencanaan & Pelaksanaan" },
  { label: "Rekapitulasi", href: "/rekapitulasi", hint: "Pagu, realisasi, dan sisa anggaran + pencarian", icon: "table-properties", permission: "recap.view", group: "Pelaporan" },
  { label: "Laporan Realisasi Anggaran", href: "/lra", hint: "Laporan realisasi anggaran", icon: "file-bar-chart", permission: "lra.view", group: "Pelaporan", adminOnly: true },
  { label: "Laporan Triwulanan", href: "/laporan-triwulan", hint: "Capaian kinerja & anggaran per triwulan (PPTX/PDF)", icon: "presentation", permission: "recap.view", group: "Pelaporan" },
  { label: "Dokumen Pengadaan", href: "/dokumen", hint: "Dokumen proses pengadaan", icon: "files", permission: "document.view", group: "Pengadaan" },
  { label: "Data Master", href: "/master", hint: "Program, kegiatan, rekening, sumber dana, PPTK", icon: "database", permission: "master.view", group: "Administrasi" },
  { label: "Pengguna & Peran", href: "/pengguna", hint: "Akun, peran, dan penugasan", icon: "users", permission: "users.manage", group: "Administrasi" },
  { label: "Log Audit", href: "/audit", hint: "Jejak perubahan dan akses", icon: "scroll-text", permission: "audit.view", group: "Administrasi" },
];

/** Menu yang boleh tampil bagi pengguna: izin + (bila adminOnly) peran admin. */
export const canSeeNav = (item: NavItem, user: { roles: readonly string[]; permissions: ReadonlySet<string> }) =>
  user.permissions.has(item.permission) && (!item.adminOnly || user.roles.includes("admin"));

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  ppk: "PPK",
  pptk: "PPTK",
  ppbj: "PPBJ",
};
