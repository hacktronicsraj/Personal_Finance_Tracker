import { useQuery } from '@tanstack/react-query';
import {
  AnalyticsSummary,
  fetchSummary,
  fetchTransactions,
  TxnRow,
} from './api/client';
import { getCachedTxn, getCachedTxns } from './db/database';

/** Transactions: prefer backend, fall back to local cache when offline. */
export function useTransactions(params?: { category?: string; q?: string }) {
  return useQuery<TxnRow[]>({
    queryKey: ['transactions', params],
    queryFn: async () => {
      try {
        return await fetchTransactions(params);
      } catch {
        const cached = await getCachedTxns();
        if (params?.category) return cached.filter((t) => t.category === params.category);
        return cached;
      }
    },
  });
}

export function useTransaction(id: string) {
  return useQuery<TxnRow | null>({
    queryKey: ['transaction', id],
    // Read the local SQLite cache first — instant, no network round-trip.
    queryFn: async () => {
      const cached = await getCachedTxn(id);
      if (cached) return cached;
      try {
        const all = await fetchTransactions();
        return all.find((t) => t.id === id) ?? null;
      } catch {
        return null;
      }
    },
  });
}

export function useSummary(params?: { from?: string; to?: string }) {
  return useQuery<AnalyticsSummary>({
    queryKey: ['summary', params],
    queryFn: () => fetchSummary(params),
  });
}
