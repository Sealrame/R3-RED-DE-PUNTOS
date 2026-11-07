import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useDoc, useQuery } from "@/lib/hooks";
import { useSession } from "@/auth/AuthProvider";
import type { Affiliate, Redemption, Transaction, Wallet } from "@/lib/types";

export function useMyAffiliate() {
  const { affiliateId } = useSession();
  const aff = useDoc<Affiliate>(() => (affiliateId ? doc(db, "affiliates", affiliateId) : null), [affiliateId]);
  const wallet = useDoc<Wallet>(() => (affiliateId ? doc(db, "points_wallets", affiliateId) : null), [affiliateId]);
  return { affiliateId, aff, wallet };
}

export function useMyTransactions(n: number) {
  const { affiliateId } = useSession();
  return useQuery<Transaction>(
    () => (affiliateId ? query(collection(db, "transactions"), where("affiliateId", "==", affiliateId), orderBy("createdAt", "desc"), limit(n)) : null),
    [affiliateId, n],
  );
}

export function useMyRedemptions(n: number) {
  const { affiliateId } = useSession();
  return useQuery<Redemption>(
    () => (affiliateId ? query(collection(db, "redemptions"), where("affiliateId", "==", affiliateId), orderBy("requestedAt", "desc"), limit(n)) : null),
    [affiliateId, n],
  );
}
