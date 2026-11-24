import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bookFacts, isXianxia, pickXianxia, shortlistText, xianxiaBasis, type PoolBook, type PoolSnapshot } from "./drama-ip-pool.ts";

const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/fanqie-ip-pool.json", import.meta.url)), "utf8")) as PoolSnapshot;

describe("the 番茄 IP 池 a drama's S0 picks a book from", () => {
  it("holds real `/open/ip/recall` rows, with the API's own field names and value shapes", () => {
    expect(snapshot.books.length).toBeGreaterThanOrEqual(10);
    expect(snapshot.request).toEqual({ category_ids: [1140, 124, 258], per_pool: 10 });
    for (const book of snapshot.books) {
      expect(book.fanqieBookId).toMatch(/^\d{15,20}$/);
      expect(book.bookName.length).toBeGreaterThan(1);
      expect(typeof book.tags).toBe("string");
      expect([1, 2, 3]).toContain(book.tier);
    }
    expect(new Set(snapshot.books.map((book) => book.categoryName))).toEqual(new Set(["东方仙侠", "都市修真", "传统玄幻"]));
  });

  it("counts a book as 修仙 by its 分类 or by one of its tags, and says which", () => {
    expect(isXianxia({ fanqieBookId: "1", bookName: "a", categoryName: "东方仙侠" })).toBe(true);
    expect(isXianxia({ fanqieBookId: "2", bookName: "b", categoryName: "现代言情", tags: "甜宠,仙侠" })).toBe(true);
    expect(isXianxia({ fanqieBookId: "3", bookName: "c", categoryName: "现代言情", tags: "甜宠,豪门" })).toBe(false);
    expect(isXianxia({ fanqieBookId: "4", bookName: "d" })).toBe(false);
    expect(xianxiaBasis({ fanqieBookId: "1", bookName: "a", categoryName: "都市修真" })).toBe("分类 都市修真");
    expect(xianxiaBasis({ fanqieBookId: "2", bookName: "b", categoryName: "历史古代", tags: "穿越,修真" })).toBe("标签 修真");
    expect(xianxiaBasis({ fanqieBookId: "3", bookName: "c", categoryName: "悬疑灵异" })).toBe("不是修仙");
  });

  it("picks 精品 first, then by 评分 and 在读, and never leaves 修仙 out or lets another 题材 in", () => {
    const picked = pickXianxia(snapshot.books, 5);
    expect(picked).toHaveLength(5);
    expect(picked.every(isXianxia)).toBe(true);
    expect(picked[0]).toMatchObject({ categoryName: "都市修真", score: 9.5, tier: 2, fanqieBookId: "7028204375155674147" });
    expect(picked.map((book) => book.score)).toEqual([9.5, 9.3, 9.2, 8.5, 8.5]);
    expect(picked.slice(3).map((book) => book.reader14d)).toEqual([515026, 311880]);
    expect(pickXianxia(snapshot.books, 50).every((book) => book.tier !== 1)).toBe(true);
    expect(pickXianxia(snapshot.books, 50).at(-1)).toMatchObject({ bookName: "开局退师被囚禁，师尊你砸是病娇", tier: 3 });
    expect(pickXianxia([], 5)).toEqual([]);
  });

  it("orders a 精品 book above a 潜力 one whatever their scores, and is stable for equal rows", () => {
    const books: PoolBook[] = [
      { fanqieBookId: "b", bookName: "潜力", categoryName: "东方仙侠", tier: 3, score: 9.9 },
      { fanqieBookId: "a", bookName: "精品", categoryName: "东方仙侠", tier: 2, score: 6.1 },
      { fanqieBookId: "d", bookName: "同分甲", categoryName: "东方仙侠", tier: 2, score: 7 },
      { fanqieBookId: "c", bookName: "同分乙", categoryName: "东方仙侠", tier: 2, score: 7 },
    ];
    expect(pickXianxia(books).map((book) => book.bookName)).toEqual(["同分乙", "同分甲", "精品", "潜力"]);
  });

  it("writes a shortlist the lead can choose from, one numbered line a book", () => {
    const [first] = pickXianxia(snapshot.books, 1);
    const line = shortlistText([first!]);
    expect(line).toBe(`1. 《道医馆笔记》 · 都市修真 · 9.5 分 · 在读 22.6 万 · 108.5 万字 · 完结 · 分类 都市修真 · 7028204375155674147`);
    expect(bookFacts({ fanqieBookId: "1", bookName: "x" })).toBe("");
  });
});
