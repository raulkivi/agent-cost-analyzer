import { describe, expect, it } from "vitest";
import { exportStatement } from "./statement-export.js";
import { statementSchema } from "./statement.js";
import { sampleStatement } from "./test-support/statement-sample.js";

// Phase 15 step 15.11 (plan §8.5): CSV (lines), JSON (full) and Markdown
// (for a client email). Session ids and titles, never message text; titles
// can be left out.

describe("exportStatement", () => {
  it("writes CSV with one row per line, unknown and fixed line, and the totals", () => {
    const csv = exportStatement(sampleStatement(), "csv");
    expect(csv.split("\n")).toEqual([
      "kind,basis,currency,channel,model,price_version,sessions,turns,uncached_input,cache_read,cache_write,reasoning,output,amount,note",
      "line,billed,AI_CREDITS,github-copilot,gpt-5.5,,2,5,1000,3000,0,,400,120.00,",
      "unknown,,,,,,1,1,,,,,,,Cannot price: unknown model",
      "markup,,AI_CREDITS,,,,,,,,,,,12.00,10% of 120.00",
      "fixed,,USD,,,,,,,,,,,39.00,Seats",
      "total,,AI_CREDITS,,,,,,,,,,,132.00,",
      "total,,USD,,,,,,,,,,,39.00,",
      "total,,EUR,,,,,,,,,,,36.29,1 USD = 0.9 EUR (the project's fixed rate); 1 AI Credit = $0.01.",
      "",
    ]);
  });

  it("quotes CSV fields that need it, and neutralises spreadsheet formulas", () => {
    const statement = sampleStatement({ unknown: [{ reason: '=HYPERLINK("x"), "quoted"', turns: 1, sessions: 1 }] });
    expect(exportStatement(statement, "csv")).toContain(`unknown,,,,,,1,1,,,,,,,"'=HYPERLINK(""x""), ""quoted"""`);
  });

  it("writes the full statement as JSON that parses back", () => {
    expect(statementSchema.parse(JSON.parse(exportStatement(sampleStatement(), "json")))).toEqual(sampleStatement());
  });

  it("writes Markdown for an email: header, lines, unknown cost, totals, provenance and the sessions with titles", () => {
    const markdown = exportStatement(sampleStatement(), "markdown");
    expect(markdown).toContain("# Statement: Customer portal, October 2026");
    expect(markdown).toContain("Client: ACME · Billing code: AC-7 · 2026-10-01 to 2026-10-31 (Europe/Tallinn) · Draft");
    expect(markdown).toContain("| GitHub Copilot | gpt-5.5 | billed | 5 | 120.00 AI Credits |");
    expect(markdown).toContain("1 turn with no known cost (Cannot price: unknown model): not included in the totals.");
    expect(markdown).toContain("| AI Credits | 120.00 | 12.00 | 0.00 | **132.00** |");
    expect(markdown).toContain("EUR 36.29");
    expect(markdown).toContain("- vscode:s1 Fix the bug");
  });

  it("leaves session titles out when asked", () => {
    const markdown = exportStatement(sampleStatement(), "markdown", { includeTitles: false });
    expect(markdown).toContain("- vscode:s1\n");
    expect(markdown).not.toContain("Fix the bug");
    const json = JSON.parse(exportStatement(sampleStatement(), "json", { includeTitles: false }));
    expect(json.provenance.sessions[0]).toEqual({ providerId: "vscode", sessionId: "s1" });
  });

  it("escapes backslashes and pipes in Markdown table cells, so a title can't break the table", () => {
    const statement = sampleStatement({ lines: [{ ...sampleStatement().lines[0]!, model: "odd\\|model\\" }] });
    expect(exportStatement(statement, "markdown")).toContain("| odd\\\\\\|model\\\\ | billed |");
  });
});
