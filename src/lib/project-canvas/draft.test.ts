import { describe, expect, it } from "vitest";
import { projectRelativePath } from "./draft";

describe("a picked file's path in the project folder", () => {
  it("is relative to the folder that holds the export folder, with forward slashes", () => {
    expect(projectRelativePath("/dramas/Rain City/产出", "/dramas/Rain City/产出/film.mp4")).toBe("产出/film.mp4");
    expect(projectRelativePath("/dramas/Rain City/产出/", "/dramas/Rain City/素材/cut/film.mp4")).toBe("素材/cut/film.mp4");
    expect(projectRelativePath("D:\\Dramas\\Rain City\\产出", "D:\\Dramas\\Rain City\\产出\\成片\\film.mp4")).toBe("产出/成片/film.mp4");
    expect(projectRelativePath("D:\\Dramas\\Rain City\\产出", "d:\\dramas\\rain city\\产出\\film.mp4")).toBe("产出/film.mp4");
  });

  it("is nothing for a file outside the project folder, the folder itself, or no path at all", () => {
    expect(projectRelativePath("/dramas/Rain City/产出", "/dramas/Rain City 2/产出/film.mp4")).toBeNull();
    expect(projectRelativePath("/dramas/Rain City/产出", "/dramas/film.mp4")).toBeNull();
    expect(projectRelativePath("/dramas/Rain City/产出", "/dramas/Rain City/../film.mp4")).toBeNull();
    expect(projectRelativePath("/dramas/Rain City/产出", "/dramas/Rain City")).toBeNull();
    expect(projectRelativePath("/dramas/Rain City/产出", "")).toBeNull();
    expect(projectRelativePath("产出", "/dramas/film.mp4")).toBeNull();
  });
});
