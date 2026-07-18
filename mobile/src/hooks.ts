import { useQuery } from '@tanstack/react-query';
import {
  AnalyticsSummary,
  CategoryRow,
  fetchCategories,
  fetchSummary,
  fetchTagAnalytics,
  fetchTransactions,
  filterTxns,
  TagTotal,
  TxnFilters,
  TxnRow,
} from './api/client';
import { CATEGORIES } from './config';
import { getAllCachedTags, getCachedTxn, getCachedTxns } from './db/database';

/**
 * All category names (built-in + user-added), ordered with the standard taxonomy
 * first and custom categories after. Falls back to the built-in list offline.
 */
export function useCategories(): string[] {
  const { data } = useQuery<CategoryRow[]>({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    staleTime: 5 * 60 * 1000,
  });
  if (!data?.length) return [...CATEGORIES];
  const rank = (n: string) => {
    const i = (CATEGORIES as readonly string[]).indexOf(n);
    return i === -1 ? 999 : i;
  };
  return data.map((c) => c.name).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Transactions: prefer backend, fall back to local cache when offline. The
 * offline path applies the identical filter matrix so results match online. */
export function useTransactions(params?: TxnFilters) {
  return useQuery<TxnRow[]>({
    queryKey: ['transactions', params],
    queryFn: async () => {
      try {
        return await fetchTransactions(params);
      } catch {
        const cached = await getCachedTxns();
        return filterTxns(cached, params);
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

export function useTagAnalytics(params?: { from?: string; to?: string }) {
  return useQuery<TagTotal[]>({
    queryKey: ['tagAnalytics', params],
    queryFn: () => fetchTagAnalytics(params),
  });
}

/** All distinct tags ever used — autocomplete source. Backend (all-time) with a
 * local-cache fallback so tagging works offline. */
export function useAllTags(): string[] {
  const { data } = useQuery<string[]>({
    queryKey: ['allTags'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      try {
        return (await fetchTagAnalytics()).map((t) => t.tag);
      } catch {
        return getAllCachedTags();
      }
    },
  });
  return data ?? [];
}
