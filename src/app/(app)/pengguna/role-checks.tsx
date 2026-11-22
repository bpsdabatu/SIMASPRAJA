import { ROLE_LABEL } from "@/lib/nav";

export const ROLES = ["admin", "ppk", "pptk", "ppbj"];

export function RoleChecks({ current = [] }: { current?: string[] }) {
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
