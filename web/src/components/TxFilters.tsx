import { Input, Select } from "./ui";

export interface TxFilterState { from: string; to: string; type: string; status: string }
export const EMPTY_FILTERS: TxFilterState = { from: "", to: "", type: "", status: "" };

export function TxFilters({ value, onChange, children }: { value: TxFilterState; onChange: (v: TxFilterState) => void; children?: React.ReactNode }) {
  const set = (k: keyof TxFilterState, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
      <label className="text-xs font-semibold text-muted">Desde<Input type="date" value={value.from} onChange={(e) => set("from", e.target.value)} className="mt-1 h-10 sm:w-40" /></label>
      <label className="text-xs font-semibold text-muted">Hasta<Input type="date" value={value.to} onChange={(e) => set("to", e.target.value)} className="mt-1 h-10 sm:w-40" /></label>
      <label className="text-xs font-semibold text-muted">Tipo
        <Select value={value.type} onChange={(e) => set("type", e.target.value)} className="mt-1 h-10 sm:w-36">
          <option value="">Todos</option><option value="purchase">Compras</option><option value="reversal">Reversos</option><option value="redemption">Canjes</option><option value="adjustment">Ajustes</option>
        </Select>
      </label>
      <label className="text-xs font-semibold text-muted">Estado
        <Select value={value.status} onChange={(e) => set("status", e.target.value)} className="mt-1 h-10 sm:w-36">
          <option value="">Todos</option><option value="confirmed">Confirmada</option><option value="reversed">Revertida</option>
        </Select>
      </label>
      {children}
    </div>
  );
}
