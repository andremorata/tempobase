import { describe, expect, it } from "vitest";
import { csvCell } from "../format";

describe("csvCell", () => {
  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('","=HYPERLINK("x")')).toBe('""",""=HYPERLINK(""x"")"');
    expect(csvCell("=1+1")).toBe("\"'=1+1\"");
    expect(csvCell("-5")).toBe("\"'-5\"");
    expect(csvCell(null)).toBe('""');
  });
});
