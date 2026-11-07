import { collection, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useQuery } from "@/lib/hooks";
import type { Distributor } from "@/lib/types";

export function useAllDistributors() {
  return useQuery<Distributor>(() => query(collection(db, "distributors"), orderBy("name")), []);
}
