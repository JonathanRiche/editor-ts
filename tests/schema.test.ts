import { describe, expect, it } from 'bun:test';
import { pageFiles, pages } from '../src/server/schema';

const getColumnNames = (table: unknown): string[] => {
  return Object.keys(table as Record<string, unknown>).filter((key) => typeof (table as Record<string, unknown>)[key] === 'object');
};

describe('schema', () => {
  it('defines pages and page_files columns', () => {
    const pagesColumns = getColumnNames(pages);
    const fileColumns = getColumnNames(pageFiles);

    expect(pagesColumns).toEqual(expect.arrayContaining(['id', 'key', 'title', 'itemId', 'body', 'createdAt', 'updatedAt']));
    expect(fileColumns).toEqual(expect.arrayContaining(['id', 'pageId', 'path', 'content', 'updatedAt']));
  });
});
