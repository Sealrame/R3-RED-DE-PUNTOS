import { Link } from "react-router-dom";
import { ChevronRight, Gift, History, QrCode } from "lucide-react";
import { Button, Card, Empty, PageLoader, SectionTitle, StatusBadge } from "@/components/ui";
import { TxList } from "@/components/TxList";
import { fmtDate, formatPoints } from "@/lib/format";
import { useMyAffiliate, useMyRedemptions, useMyTransactions } from "./data";
import { WalletCard } from "./WalletCard";
import { InstallApp } from "@/components/InstallApp";

export default function AffiliateHome() {
  const { aff, wallet } = useMyAffiliate();
  const tx = useMyTransactions(5);
  const reds = useMyRedemptions(3);
  if (aff.loading || wallet.loading) return <PageLoader />;
  const first = aff.data?.fullName.split(" ")[0];
  return (
    <div className="mx-auto max-w-xl space-y-6 lg:max-w-4xl">
      <p className="text-[15px] font-semibold text-ink-2 animate-rise">Hola, {first} 👋</p>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <WalletCard aff={aff.data} wallet={wallet.data} className="animate-rise" />
          <div className="grid grid-cols-2 gap-3">
            <Link to="/socio/qr"><Button size="lg" variant="dark" block className="whitespace-nowrap px-3 text-sm sm:text-base"><QrCode className="size-5" /> Mostrar mi QR</Button></Link>
            <Link to="/socio/recompensas"><Button size="lg" variant="secondary" block className="whitespace-nowrap px-3 text-sm sm:text-base"><Gift className="size-5" /> Ver recompensas</Button></Link>
          </div>
          <InstallApp />
        </div>
        <div className="space-y-6">
          <Card className="p-4 sm:p-5">
            <SectionTitle action={<Link to="/socio/movimientos" className="flex items-center text-sm font-semibold text-brand-700">Ver todo <ChevronRight className="size-4" /></Link>}>Últimos movimientos</SectionTitle>
            {tx.loading ? <PageLoader /> : tx.data.length ? <TxList items={tx.data} perspective="affiliate" /> : (
              <Empty icon={<History className="size-5" />} title="Aún no tienes movimientos">Muestra tu QR en tu próxima compra y empieza a sumar.</Empty>
            )}
          </Card>
          {reds.data.length > 0 && (
            <Card className="p-4 sm:p-5">
              <SectionTitle action={<Link to="/socio/recompensas?tab=canjes" className="flex items-center text-sm font-semibold text-brand-700">Mis canjes <ChevronRight className="size-4" /></Link>}>Estado de canjes</SectionTitle>
              <ul className="divide-y divide-line">
                {reds.data.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0"><p className="truncate text-sm font-semibold">{r.rewardName}</p><p className="text-xs text-muted">{fmtDate(r.requestedAt)} · {formatPoints(r.pointsCost)} pts</p></div>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
