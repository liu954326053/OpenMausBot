// The hot-video 番茄 IP 池 as the drama-ip skill reads it: rows of `POST /open/ip/recall`, narrowed to one 题材.
// A row's 题材 is its 分类 (`categoryName`, a 番茄 分类 id) plus its `tags`, a comma-separated string the API sends.
// Nothing here calls the network; a caller reads a snapshot with readPoolSnapshot or fetches one itself.

/** The fields of an `/open/ip/recall` row this repo reads. The API sends more; unknown keys are left alone. */
export interface PoolBook {
  fanqieBookId: string;
  bookName: string;
  bookAuthor?: string;
  categoryId?: number;
  categoryName?: string;
  /** Comma-separated 番茄 tags, as the API sends them ("东方仙侠,穿越,洪荒"). */
  tags?: string;
  /** 0 无 / 1 典藏 / 2 精品 / 3 潜力. */
  tier?: number;
  score?: number;
  ratingCount?: number;
  reader14d?: number;
  wordCount?: number;
  /** 1 完结 / 2 连载. */
  finished?: number;
  /** The recall pools the row was drawn from (`blue_ocean`, `mid_remake`, ...). */
  pools?: string[];
  desc?: string;
}

/** A pool snapshot: what `/open/ip/recall` answered, kept as a file. */
export interface PoolSnapshot {
  computedAt?: string;
  request?: Record<string, unknown>;
  scanned?: number;
  total?: number;
  books: PoolBook[];
}

/** 番茄 分类 names that are 修仙 题材, from `/open/ip/meta`: 东方仙侠 1140, 都市修真 124, 传统玄幻 258. */
export const XIANXIA_CATEGORIES = new Set(["东方仙侠", "都市修真", "传统玄幻"]);

/** 番茄 tags that name 修仙 题材 on their own, whatever the 分类. */
export const XIANXIA_TAGS = ["仙侠", "修真", "修仙", "玄幻", "洪荒", "剑道"] as const;

export const tagsOf = (book: PoolBook): string[] =>
  (book.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);

/** Whether a row is 修仙: its 分类, or one of its tags, says so. */
export function isXianxia(book: PoolBook): boolean {
  if (book.categoryName && XIANXIA_CATEGORIES.has(book.categoryName.trim())) return true;
  return tagsOf(book).some((tag) => XIANXIA_TAGS.includes(tag as (typeof XIANXIA_TAGS)[number]));
}

/** Why a row counts as 修仙, for the report: its 分类, else the tag that matched. */
export function xianxiaBasis(book: PoolBook): string {
  if (book.categoryName && XIANXIA_CATEGORIES.has(book.categoryName.trim())) return `分类 ${book.categoryName}`;
  const tag = tagsOf(book).find((one) => XIANXIA_TAGS.includes(one as (typeof XIANXIA_TAGS)[number]));
  return tag ? `标签 ${tag}` : "不是修仙";
}

const tierRank = (tier: number | undefined): number => (tier === 2 ? 0 : tier === 1 ? 1 : tier === 3 ? 2 : 3);

/**
 * The 修仙 rows of a pool, best first: 精品 before 典藏 before 潜力 before 无, then the 番茄 score, then how many read it
 * in the last 14 days, then the id so the order never depends on the order the API listed rows in.
 */
export function pickXianxia(books: readonly PoolBook[], limit = 10): PoolBook[] {
  return books
    .filter(isXianxia)
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier)
      || (b.score ?? 0) - (a.score ?? 0)
      || (b.reader14d ?? 0) - (a.reader14d ?? 0)
      || a.fanqieBookId.localeCompare(b.fanqieBookId))
    .slice(0, limit);
}

/** `8.5 分 · 在读 51.5 万 · 30.6 万字 · 连载` — what a shortlist line says beside the title. */
export function bookFacts(book: PoolBook): string {
  const parts: string[] = [];
  if (typeof book.score === "number") parts.push(`${book.score} 分`);
  if (typeof book.reader14d === "number") parts.push(`在读 ${(book.reader14d / 10_000).toFixed(1)} 万`);
  if (typeof book.wordCount === "number") parts.push(`${(book.wordCount / 10_000).toFixed(1)} 万字`);
  if (book.finished === 1) parts.push("完结");
  else if (book.finished === 2) parts.push("连载");
  return parts.join(" · ");
}

/** The shortlist as one message the lead can choose from, numbered from 1. */
export function shortlistText(books: readonly PoolBook[]): string {
  return books
    .map((book, index) => `${index + 1}. 《${book.bookName}》 · ${book.categoryName ?? "未分类"} · ${bookFacts(book)} · ${xianxiaBasis(book)} · ${book.fanqieBookId}`)
    .join("\n");
}
