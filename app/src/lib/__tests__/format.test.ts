import { describe, expect, it } from "vitest";
import { csvCell, formatDateByPreference } from "../format";

describe("csvCell", () => {
  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('","=HYPERLINK("x")')).toBe('""",""=HYPERLINK(""x"")"');
    expect(csvCell("=1+1")).toBe("\"'=1+1\"");
    expect(csvCell("-5")).toBe("\"'-5\"");
    expect(csvCell(null)).toBe('""');
  });
});

describe("formatDateByPreference", () => {
  it("follows the user's date-format setting", () => {
    const iso = new Date(2026, 10, 3, 15, 30).toISOString();
    expect(formatDateByPreference(iso, "ymd")).toBe("2026-11-03");
    expect(formatDateByPreference(iso, "dmy")).toBe("03/11/2026");
    expect(formatDateByPreference(iso, "mdy")).toBe("11/03/2026");
    expect(formatDateByPreference(iso, "system")).toBe(new Date(iso).toLocaleDateString());
  });
});
