import type { PageData } from '../types';

export interface PageMeta {
  key: string;
  title: string;
  itemId: number;
  updatedAt: string;
}

export interface PageMetaStore {
  save(meta: PageMeta): Promise<void>;
  get(key: string): Promise<PageMeta | null>;
  list(): Promise<PageMeta[]>;
  delete(key: string): Promise<void>;
}

export const createPageMeta = (
  key: string,
  page: PageData,
  options?: { updatedAt?: string }
): PageMeta => {
  return {
    key,
    title: page.title,
    itemId: page.item_id,
    updatedAt: options?.updatedAt ?? new Date().toISOString(),
  };
};
