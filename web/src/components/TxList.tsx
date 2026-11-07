import { ArrowDownLeft, ArrowUpRight, Gift, RotateCcw, SlidersHorizontal, AlertTriangle } from "lucide-react";
import type { Transaction, WithId } from "@/lib/types";
import { fmtDateTime, formatPoints, formatUsd } from "@/lib/format";
import { Badge, cx } from "./ui";
import { TX_TYPE_LABEL } from "@shared/domain";

const ICON = { purchase: ArrowDownLeft, redemption: Gift, adjustment: SlidersHorizontal, reversal: RotateCcw };

/** Lista compacta de movimientos, pensada para móviles. */
export function TxList({ items, perspective, onSelect }: { items: WithId<Transaction>[]; perspective: "affiliate" | "distributor" | "admin"; onSelect?: (t: WithId<Transaction>) => void }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((t) => {
        const Icon = t.points >= 0 ? ICON[t.type] ?? ArrowDownLeft : t.type === "purchase" ? ArrowUpRight : ICON[t.type];
        const positive = t.points >= 0;
        const title =
          t.type === "purchase" ? (perspective === "affiliate" ? t.distributorName : t.affiliateName)
          : t.type === "redemption" ? `Canje · ${t.rewardName ?? ""}`
          : t.type === "reversal" ? `Reverso · ${perspective === "affiliate" ? t.distributorName : t.affiliateName}`
          : perspective === "affiliate" ? "Ajuste de puntos" : `Ajuste · ${t.affiliateName}`;
        return (
          <li key={t.id}>
            <button type="button" onClick={() => onSelect?.(t)} disabled={!onSelect}
              className="flex w-full items-center gap-3 py-3 text-left enabled:hover:bg-paper/60 sm:px-2 rounded-xl">
              <span className={cx("grid size-10 shrink-0 place-items-center rounded-2xl", positive ? "bg-brand-50 text-brand-700" : "bg-bad-bg text-bad")}>
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[14.5px] font-semibold">{title}</span>
                  {t.status === "reversed" && <Badge tone="bad">Revertida</Badge>}
                  {t.flags?.includes("possible_duplicate") && perspective !== "affiliate" && <Badge tone="warn" icon={<AlertTriangle className="size-3" />}>Duplicado?</Badge>}
                </span>
                <span className="block truncate text-xs text-muted">
                  {fmtDateTime(t.createdAt)}
                  {t.type === "purchase" && ` · ${formatUsd(t.amountCents)}`}
                  {perspective === "admin" && t.type === "purchase" && ` · ${t.distributorName}`}
                </span>
              </span>
              <span className="text-right">
                <span className={cx("tabular block text-[15px] font-extrabold", positive ? "text-brand-700" : "text-bad")}>
                  {positive ? "+" : "−"}{formatPoints(Math.abs(t.points))}
                </span>
                <span className="block text-[11px] font-medium text-muted">{TX_TYPE_LABEL[t.type]}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
