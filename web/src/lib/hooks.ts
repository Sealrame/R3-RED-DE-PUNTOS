import { useEffect, useState, type DependencyList } from "react";
import { onSnapshot, type DocumentReference, type Query } from "firebase/firestore";
import type { WithId } from "./types";

interface Live<T> { data: T; loading: boolean; error: Error | null }

/** Suscripción en tiempo real a un documento. */
export function useDoc<T>(factory: () => DocumentReference | null, deps: DependencyList): Live<WithId<T> | null> {
  const [state, set] = useState<Live<WithId<T> | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    const ref = factory();
    if (!ref) { set({ data: null, loading: false, error: null }); return; }
    set((s) => ({ ...s, loading: true }));
    return onSnapshot(
      ref,
      (snap) => set({ data: snap.exists() ? ({ id: snap.id, ...(snap.data() as T) }) : null, loading: false, error: null }),
      (error) => set({ data: null, loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Suscripción en tiempo real a una consulta. */
export function useQuery<T>(factory: () => Query | null, deps: DependencyList): Live<WithId<T>[]> {
  const [state, set] = useState<Live<WithId<T>[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = factory();
    if (!q) { set({ data: [], loading: false, error: null }); return; }
    set((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      (snap) => set({ data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })), loading: false, error: null }),
      (error) => { console.error(error); set({ data: [], loading: false, error }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
