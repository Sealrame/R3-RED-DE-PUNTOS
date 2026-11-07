import { useState } from "react";
import { History } from "lucide-react";
import { Button, Card, Empty, PageHeader, PageLoader, Sheet } from "@/components/ui";
import { TxList } from "@/components/TxList";
import type { Transaction, WithId } from "@/lib/types";
import { fmtDateTime, formatPoints, formatUsd } from "@/lib/format";
import { TX_TYPE_LABEL } from "@shared/domain";
import { useMyAffiliate, useMyTransactions } from "./data";

export default function Movements() {
  const [n, setN] = useState(30);
  const tx = useMyTransactions(n);
  const { wallet } = useMyAffiliate();
  const [sel, setSel] = useState<WithId<Transaction> | null>(null);
  const w = wallet.data;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Movimientos" subtitle="Compras que generan puntos, canjes y ajustes." />
      {w && (
        <div className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[["Ganados", w.totalEarned], ["Canjeados", w.totalRedeemed], ["Saldo", w.balance]].map(([l, v]) => (
            <Card key={l} className="p-3"><p className="text-[11px] font-semibold text-muted">{l}</p><p className="tabular text-lg font-extrabold">{formatPoints(v as number)}</p></Card>
          ))}
        </div>
      )}
      <Card className="p-3 sm:p-4">
        {tx.loading && !tx.data.length ? <PageLoader /> : tx.data.length ? <TxList items={tx.data} perspective="affiliate" onSelect={setSel} /> : <Empty icon={<History className="size-5" />} title="Sin movimientos todavía" />}
        {tx.data.length >= n && <Button variant="ghost" block className="mt-2" onClick={() => setN(n + 30)}>Cargar más</Button>}
      </Card>
      <Sheet open={!!sel} onClose={() => setSel(null)} title="Detalle del movimiento">
        {sel && (
          <dl className="divide-y divide-line text-sm">
            {[
              ["Tipo", TX_TYPE_LABEL[sel.type]],
              ["Fecha", fmtDateTime(sel.createdAt)],
              ...(sel.distributorName ? [["Distribuidor", sel.distributorName]] : []),
              ...(sel.type === "purchase" ? [["Monto de compra", formatUsd(sel.amountCents)]] : []),
              ["Puntos", `${sel.points > 0 ? "+" : ""}${formatPoints(sel.points)}`],
              ["Saldo después", formatPoints(sel.balanceAfter)],
              ...(sel.rewardName ? [["Recompensa", sel.rewardName]] : []),
              ...(sel.reason ? [["Motivo", sel.reason]] : []),
              ["Estado", sel.status === "reversed" ? "Revertida" : "Confirmada"],
              ["ID", sel.id],
            ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="break-all text-right font-semibold">{v}</dd></div>)}
          </dl>
        )}
      </Sheet>
    </div>
  );
}
