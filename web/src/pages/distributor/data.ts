import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useDoc, useQuery } from "@/lib/hooks";
import { useSession } from "@/auth/AuthProvider";
import type { Distributor, MonthlyStats } from "@/lib/types";

export function useMyDistributor() {
  const { distributorId } = useSession();
  return useDoc<Distributor>(() => (distributorId ? doc(db, "distributors", distributorId) : null), [distributorId]);
}

export function useDistributorMonthly(distributorId: string | undefined | null, n = 6) {
  return useQuery<MonthlyStats>(
    () => (distributorId ? query(collection(db, "distributors", distributorId, "monthly"), orderBy("month", "desc"), limit(n)) : null),
    [distributorId, n],
  );
}

export function txByDistributor(distributorId: string, n: number) {
  return query(collection(db, "transactions"), where("distributorId", "==", distributorId), orderBy("createdAt", "desc"), limit(n));
}
