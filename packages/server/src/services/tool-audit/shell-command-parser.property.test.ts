import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseShellCommand } from "./shell-command-parser.js";

// Letters only: no quotes, separators, `=`, `/`, `-`, so none of the parser's
// special cases (keywords, wrappers, env assignments) can trigger. A prefix
// keeps generated names off keywords, wrappers and `cd`.
const program = fc.stringMatching(/^[a-z]{1,8}$/).map((s) => `p${s}`);
const arg = fc.stringMatching(/^[a-z0-9.]{1,8}$/);
const simpleCommand = fc.record({
  program,
  args: fc.array(arg, { maxLength: 3 }),
});
const render = (c: { program: string; args: string[] }) => [c.program, ...c.args].join(" ");

describe("parseShellCommand properties", () => {
  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.stringMatching(/^[a-z"'&|;() =\-/]{0,30}$/)),
        (command) => {
          const parsed = parseShellCommand(command);
          expect(typeof parsed.normalized).toBe("string");
        },
      ),
    );
  });

  it("finds the first command's program when two commands are joined by any separator", () => {
    fc.assert(
      fc.property(
        simpleCommand,
        simpleCommand,
        fc.constantFrom("&&", "||", ";", "|", "&"),
        (first, second, separator) => {
          const joined = parseShellCommand(`${render(first)} ${separator} ${render(second)}`);
          expect(joined.program).toBe(first.program);
        },
      ),
    );
  });

  it("skips a leading cd so the second command's program wins", () => {
    fc.assert(
      fc.property(arg, simpleCommand, fc.constantFrom("&&", ";"), (dir, second, separator) => {
        expect(parseShellCommand(`cd ${dir} ${separator} ${render(second)}`).program).toBe(second.program);
      }),
    );
  });

  it("is insensitive to whitespace around separators", () => {
    fc.assert(
      fc.property(
        simpleCommand,
        simpleCommand,
        fc.constantFrom("&&", "||", ";", "|", "&"),
        fc.stringMatching(/^[ \t]{1,3}$/),
        (first, second, separator, gap) => {
          const spaced = parseShellCommand(`${render(first)}${gap}${separator}${gap}${render(second)}`);
          const tight = parseShellCommand(`${render(first)}${separator}${render(second)}`);
          expect(spaced.program).toBe(tight.program);
        },
      ),
    );
  });

  it("keeps a quoted program name containing separators as one token", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^p[a-z]{0,4}[&|;]{1,3}[a-z]{0,4}$/),
        arg,
        (quoted, rest) => {
          expect(parseShellCommand(`"${quoted}" ${rest}`).program).toBe(quoted);
        },
      ),
    );
  });

  it("strips directories from the program path", () => {
    fc.assert(
      fc.property(fc.array(program, { minLength: 1, maxLength: 3 }), program, (dirs, name) => {
        expect(parseShellCommand(`/${dirs.join("/")}/${name} x`).program).toBe(name);
      }),
    );
  });
});
