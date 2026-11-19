/**
 * The rule language of a decision table (Spec 85) — what `rules[].if` is written in.
 *
 * Bounded on purpose. A rule is parsed into a tree and the tree is walked:
 * nothing is ever handed to `eval`, `Function` or a regular expression built
 * from the document. It can compare, combine and take a maximum, and nothing
 * else: no assignment, no loop, no property a document did not declare.
 *
 *   rule     := "otherwise" | or
 *   or       := and ( "or" and )*
 *   and      := not ( "and" not )*
 *   not      := "not" not | compare
 *   compare  := sum [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) sum | "in" interval ]
 *   interval := ( "[" | "(" ) sum "," sum ( "]" | ")" )      [0.4, 0.6) holds 0.4 and not 0.6
 *   sum      := product ( ( "+" | "-" ) product )*
 *   product  := unary ( ( "*" | "/" ) unary )*
 *   unary    := "-" unary | primary
 *   primary  := number | string | "true" | "false" | call | ref | "(" or ")"
 *   call     := ( "max" | "min" | "answered" | "collected" ) "(" or ( "," or )* ")"
 *   ref      := name ( "." name | "[" string "]" )*
 *
 * A reference names an input, a bar, or one field of a required decision.
 * Which fields exist is the answer's type (`answers.ts`): `deletes.yes`,
 * `advance.confidence`, `band.outcome`. A decision's bare name is never a
 * value, so no rule can read a judgment as "the number".
 *
 * `and` and `or` stop at the first operand that settles them, so
 * `answered(advance) and advance.confidence >= 0.6` never reads a missing answer.
 *
 * Pure — no I/O.
 */

export type RuleValue = number | string | boolean;

export type RuleNode =
  | { t: "otherwise" }
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ref"; name: string; path: string[] }
  | { t: "call"; fn: RuleFunction; args: RuleNode[] }
  | { t: "not"; x: RuleNode }
  | { t: "neg"; x: RuleNode }
  | { t: "bin"; op: RuleOperator; l: RuleNode; r: RuleNode }
  | { t: "in"; x: RuleNode; lo: RuleNode; hi: RuleNode; loClosed: boolean; hiClosed: boolean };

export type RuleOperator = "and" | "or" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/";

export type RuleFunction = "max" | "min" | "answered" | "collected";

export const RULE_FUNCTIONS: readonly RuleFunction[] = ["max", "min", "answered", "collected"];

/** A rule longer or deeper than this is refused: a table rule is a line, not a program. */
export const RULE_LIMITS = { MAX_CHARS: 2000, MAX_DEPTH: 32 } as const;

const KEYWORDS = new Set(["and", "or", "not", "in", "true", "false", "otherwise"]);

interface Token {
  kind: "num" | "str" | "name" | "op" | "end";
  text: string;
  at: number;
}

function tokenize(text: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && text[i + 1] >= "0" && text[i + 1] <= "9")) {
      let j = i;
      let dots = 0;
      while (j < text.length && ((text[j] >= "0" && text[j] <= "9") || text[j] === ".")) {
        if (text[j] === ".") dots += 1;
        j += 1;
      }
      if (dots > 1) return `"${text.slice(i, j)}" at ${i + 1} is not a number`;
      out.push({ kind: "num", text: text.slice(i, j), at: i });
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = text.indexOf(c, i + 1);
      if (j < 0) return `the text opened at ${i + 1} is never closed`;
      out.push({ kind: "str", text: text.slice(i + 1, j), at: i });
      i = j + 1;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      out.push({ kind: "name", text: text.slice(i, j), at: i });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "==" || two === "!=") {
      out.push({ kind: "op", text: two, at: i });
      i += 2;
      continue;
    }
    if ("<>+-*/()[],.".includes(c)) {
      out.push({ kind: "op", text: c, at: i });
      i += 1;
      continue;
    }
    return `"${c}" at ${i + 1} is not part of the rule language`;
  }
  out.push({ kind: "end", text: "", at: text.length });
  return out;
}

class ParseError extends Error {}

export type RuleParse = { ok: true; ast: RuleNode } | { ok: false; error: string };

/** Parse one rule. Never throws: a rule that cannot be read comes back with why. */
export function parseRule(text: unknown): RuleParse {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "the rule is empty" };
  if (text.length > RULE_LIMITS.MAX_CHARS) return { ok: false, error: `the rule is longer than ${RULE_LIMITS.MAX_CHARS} characters` };
  const tokens = tokenize(text);
  if (typeof tokens === "string") return { ok: false, error: tokens };

  let p = 0;
  let depth = 0;
  const peek = (): Token => tokens[p];
  const isOp = (s: string): boolean => peek().kind === "op" && peek().text === s;
  const isWord = (s: string): boolean => peek().kind === "name" && peek().text === s;
  const fail = (what: string): never => {
    const t = peek();
    throw new ParseError(`${what} at ${t.at + 1}${t.kind === "end" ? " (the rule ends there)" : `, found "${t.text}"`}`);
  };
  const expectOp = (s: string): void => {
    if (!isOp(s)) fail(`expected "${s}"`);
    p += 1;
  };
  const deeper = <T>(f: () => T): T => {
    depth += 1;
    if (depth > RULE_LIMITS.MAX_DEPTH) throw new ParseError(`the rule nests deeper than ${RULE_LIMITS.MAX_DEPTH}`);
    try {
      return f();
    } finally {
      depth -= 1;
    }
  };

  const or = (): RuleNode =>
    deeper(() => {
      let l = and();
      while (isWord("or")) {
        p += 1;
        l = { t: "bin", op: "or", l, r: and() };
      }
      return l;
    });
  const and = (): RuleNode => {
    let l = not();
    while (isWord("and")) {
      p += 1;
      l = { t: "bin", op: "and", l, r: not() };
    }
    return l;
  };
  const not = (): RuleNode => {
    if (isWord("not")) {
      p += 1;
      return deeper(() => ({ t: "not", x: not() }));
    }
    return compare();
  };
  const compare = (): RuleNode => {
    const l = sum();
    const t = peek();
    if (t.kind === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.text)) {
      p += 1;
      return { t: "bin", op: t.text as RuleOperator, l, r: sum() };
    }
    if (isWord("in")) {
      p += 1;
      const loClosed = isOp("[");
      if (!loClosed && !isOp("(")) fail('expected an interval, "[" or "("');
      p += 1;
      const lo = sum();
      expectOp(",");
      const hi = sum();
      const hiClosed = isOp("]");
      if (!hiClosed && !isOp(")")) fail('expected "]" or ")" to close the interval');
      p += 1;
      return { t: "in", x: l, lo, hi, loClosed, hiClosed };
    }
    return l;
  };
  const sum = (): RuleNode => {
    let l = product();
    while (isOp("+") || isOp("-")) {
      const op = peek().text as RuleOperator;
      p += 1;
      l = { t: "bin", op, l, r: product() };
    }
    return l;
  };
  const product = (): RuleNode => {
    let l = unary();
    while (isOp("*") || isOp("/")) {
      const op = peek().text as RuleOperator;
      p += 1;
      l = { t: "bin", op, l, r: unary() };
    }
    return l;
  };
  const unary = (): RuleNode => {
    if (isOp("-")) {
      p += 1;
      return deeper(() => ({ t: "neg", x: unary() }));
    }
    return primary();
  };
  const primary = (): RuleNode => {
    const t = peek();
    if (t.kind === "num") {
      p += 1;
      return { t: "num", v: Number(t.text) };
    }
    if (t.kind === "str") {
      p += 1;
      return { t: "str", v: t.text };
    }
    if (isOp("(")) {
      p += 1;
      const inner = or();
      expectOp(")");
      return inner;
    }
    if (t.kind !== "name") return fail("expected a value");
    if (t.text === "true" || t.text === "false") {
      p += 1;
      return { t: "bool", v: t.text === "true" };
    }
    if (KEYWORDS.has(t.text)) return fail(`"${t.text}" cannot stand here`);
    p += 1;
    if (isOp("(")) {
      if (!RULE_FUNCTIONS.includes(t.text as RuleFunction)) {
        throw new ParseError(`"${t.text}" at ${t.at + 1} is not a function of the rule language (${RULE_FUNCTIONS.join(", ")})`);
      }
      p += 1;
      const args: RuleNode[] = [];
      if (!isOp(")")) {
        args.push(or());
        while (isOp(",")) {
          p += 1;
          args.push(or());
        }
      }
      expectOp(")");
      return { t: "call", fn: t.text as RuleFunction, args };
    }
    const path: string[] = [];
    for (;;) {
      if (isOp(".")) {
        p += 1;
        const seg = peek();
        if (seg.kind !== "name") fail('expected a field name after the dot (a key that is a number is written probabilities["2"])');
        path.push(seg.text);
        p += 1;
      } else if (isOp("[")) {
        p += 1;
        const seg = peek();
        if (seg.kind !== "str") fail('expected a quoted key, as in probabilities["2"]');
        path.push(seg.text);
        p += 1;
        expectOp("]");
      } else break;
    }
    return { t: "ref", name: t.text, path };
  };

  try {
    if (isWord("otherwise")) {
      p += 1;
      if (peek().kind !== "end") fail('"otherwise" stands alone');
      return { ok: true, ast: { t: "otherwise" } };
    }
    const ast = or();
    if (peek().kind !== "end") fail("the rule should end");
    return { ok: true, ast };
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, error: e.message };
    throw e;
  }
}

/** A reference as a rule writes it: `deletes.yes`, `owner_at`. */
export function refText(name: string, path: readonly string[]): string {
  return [name, ...path].join(".");
}

export interface RuleRef {
  name: string;
  path: string[];
  /** How the rule uses it: read as a value, or named in `answered()` or `collected()`. */
  use: "value" | "answered" | "collected";
}

/** Every name a rule reads, in the order it reads them. */
export function ruleRefs(ast: RuleNode): RuleRef[] {
  const out: RuleRef[] = [];
  const walk = (n: RuleNode): void => {
    switch (n.t) {
      case "ref":
        out.push({ name: n.name, path: n.path, use: "value" });
        return;
      case "call":
        if ((n.fn === "answered" || n.fn === "collected") && n.args[0]?.t === "ref") {
          out.push({ name: n.args[0].name, path: n.args[0].path, use: n.fn });
          n.args.slice(1).forEach(walk);
          return;
        }
        n.args.forEach(walk);
        return;
      case "not":
      case "neg":
        walk(n.x);
        return;
      case "bin":
        walk(n.l);
        walk(n.r);
        return;
      case "in":
        walk(n.x);
        walk(n.lo);
        walk(n.hi);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return out;
}

// ── Checking a rule before any run ───────────────────────────────────────────

/** What a reference is, as far as a document can say before a run. `any`: an input with no declared type. */
export type RuleType = "number" | "string" | "boolean" | "any";

export interface RuleEnv {
  /** The type of a reference, or why it cannot be read. */
  typeOf(name: string, path: string[]): RuleType | { error: string };
  /** Why `answered(name)` cannot be asked, if it cannot. */
  answerable(name: string): string | undefined;
  /** Why `collected(name, outcome)` cannot be asked, if it cannot. */
  collectable(name: string, outcome: string): string | undefined;
}

/** Everything wrong with a rule that a document alone shows. An empty list is a rule the evaluator can run. */
export function checkRule(ast: RuleNode, env: RuleEnv): string[] {
  const problems: string[] = [];
  const fits = (got: RuleType, want: RuleType): boolean => got === "any" || got === want;
  const show = (n: RuleNode): string => (n.t === "ref" ? refText(n.name, n.path) : n.t === "call" ? `${n.fn}(…)` : "the value");

  const typeOf = (n: RuleNode): RuleType => {
    switch (n.t) {
      case "otherwise":
      case "bool":
        return "boolean";
      case "num":
        return "number";
      case "str":
        return "string";
      case "ref": {
        const t = env.typeOf(n.name, n.path);
        if (typeof t === "object") {
          problems.push(t.error);
          return "any";
        }
        return t;
      }
      case "call": {
        if (n.fn === "answered") {
          const a = n.args[0];
          if (n.args.length !== 1 || a?.t !== "ref" || a.path.length) problems.push("answered() takes one question's name, as in answered(advance)");
          else {
            const why = env.answerable(a.name);
            if (why) problems.push(why);
          }
          return "boolean";
        }
        if (n.fn === "collected") {
          const [a, b] = n.args;
          if (n.args.length !== 2 || a?.t !== "ref" || a.path.length || b?.t !== "str") {
            problems.push('collected() takes a table\'s name and an outcome, as in collected(flags, "late")');
          } else {
            const why = env.collectable(a.name, b.v);
            if (why) problems.push(why);
          }
          return "boolean";
        }
        if (!n.args.length) problems.push(`${n.fn}() needs at least one number`);
        for (const a of n.args) if (!fits(typeOf(a), "number")) problems.push(`${n.fn}() takes numbers; ${show(a)} is not one`);
        return "number";
      }
      case "not":
        if (!fits(typeOf(n.x), "boolean")) problems.push(`"not" takes yes or no; ${show(n.x)} is neither`);
        return "boolean";
      case "neg":
        if (!fits(typeOf(n.x), "number")) problems.push(`"-" takes a number; ${show(n.x)} is not one`);
        return "number";
      case "in":
        for (const part of [n.x, n.lo, n.hi]) if (!fits(typeOf(part), "number")) problems.push(`"in" compares numbers; ${show(part)} is not one`);
        return "boolean";
      case "bin": {
        const l = typeOf(n.l);
        const r = typeOf(n.r);
        if (n.op === "and" || n.op === "or") {
          if (!fits(l, "boolean")) problems.push(`"${n.op}" joins yes-or-no tests; ${show(n.l)} is not one`);
          if (!fits(r, "boolean")) problems.push(`"${n.op}" joins yes-or-no tests; ${show(n.r)} is not one`);
          return "boolean";
        }
        if (n.op === "==" || n.op === "!=") {
          if (l !== "any" && r !== "any" && l !== r) problems.push(`"${n.op}" compares a ${l} with a ${r} (${show(n.l)} and ${show(n.r)})`);
          return "boolean";
        }
        if (!fits(l, "number")) problems.push(`"${n.op}" takes numbers; ${show(n.l)} is not one`);
        if (!fits(r, "number")) problems.push(`"${n.op}" takes numbers; ${show(n.r)} is not one`);
        return n.op === "<" || n.op === "<=" || n.op === ">" || n.op === ">=" ? "boolean" : "number";
      }
    }
  };

  if (!fits(typeOf(ast), "boolean")) problems.push("a rule is a yes-or-no test; this one gives a value");
  return [...new Set(problems)];
}

// ── Running a rule ───────────────────────────────────────────────────────────

/**
 * Why a rule could not be settled. `missing`: a question it reads has no valid
 * answer. `awaiting`: a person it reads has not ruled. `error`: the rule and
 * this run do not fit (an input with no value, a number compared with text).
 */
export class RuleStop extends Error {
  constructor(
    readonly kind: "missing" | "awaiting" | "error",
    message: string,
    readonly subject?: string,
  ) {
    super(message);
    this.name = "RuleStop";
  }
}

export interface RuleScope {
  /** The value of a reference. Throws a `RuleStop` when there is none. */
  read(name: string, path: string[]): RuleValue;
  answered(name: string): boolean;
  collected(name: string, outcome: string): boolean;
}

/**
 * Whether a rule holds in one run. Every value it read lands in `reads`, keyed
 * as the rule wrote it, so a trace can say what the rule saw. Throws a
 * `RuleStop` when the rule cannot be settled.
 */
export function evalRule(ast: RuleNode, scope: RuleScope, reads: Record<string, RuleValue> = {}): boolean {
  const num = (n: RuleNode, what: string): number => {
    const v = value(n);
    if (typeof v !== "number" || !Number.isFinite(v)) throw new RuleStop("error", `${what} takes numbers, and got ${JSON.stringify(v)}`);
    return v;
  };
  const bool = (n: RuleNode, what: string): boolean => {
    const v = value(n);
    if (typeof v !== "boolean") throw new RuleStop("error", `${what} takes yes or no, and got ${JSON.stringify(v)}`);
    return v;
  };
  const value = (n: RuleNode): RuleValue => {
    switch (n.t) {
      case "otherwise":
        return true;
      case "num":
      case "str":
      case "bool":
        return n.v;
      case "ref": {
        const v = scope.read(n.name, n.path);
        reads[refText(n.name, n.path)] = v;
        return v;
      }
      case "call": {
        if (n.fn === "answered") {
          const a = n.args[0];
          if (n.args.length !== 1 || a?.t !== "ref" || a.path.length) throw new RuleStop("error", "answered() takes one question's name");
          const v = scope.answered(a.name);
          reads[`answered(${a.name})`] = v;
          return v;
        }
        if (n.fn === "collected") {
          const [a, b] = n.args;
          if (n.args.length !== 2 || a?.t !== "ref" || a.path.length || b?.t !== "str") {
            throw new RuleStop("error", "collected() takes a table's name and an outcome");
          }
          const v = scope.collected(a.name, b.v);
          reads[`collected(${a.name}, "${b.v}")`] = v;
          return v;
        }
        if (!n.args.length) throw new RuleStop("error", `${n.fn}() needs at least one number`);
        const values = n.args.map((a) => num(a, `${n.fn}()`));
        return n.fn === "max" ? Math.max(...values) : Math.min(...values);
      }
      case "not":
        return !bool(n.x, '"not"');
      case "neg":
        return -num(n.x, '"-"');
      case "in": {
        const x = num(n.x, '"in"');
        const lo = num(n.lo, '"in"');
        const hi = num(n.hi, '"in"');
        return (n.loClosed ? x >= lo : x > lo) && (n.hiClosed ? x <= hi : x < hi);
      }
      case "bin": {
        if (n.op === "and") return bool(n.l, '"and"') && bool(n.r, '"and"');
        if (n.op === "or") return bool(n.l, '"or"') || bool(n.r, '"or"');
        if (n.op === "==" || n.op === "!=") {
          const l = value(n.l);
          const r = value(n.r);
          if (typeof l !== typeof r) throw new RuleStop("error", `"${n.op}" compares ${JSON.stringify(l)} with ${JSON.stringify(r)}, which are not the same kind of value`);
          return n.op === "==" ? l === r : l !== r;
        }
        const l = num(n.l, `"${n.op}"`);
        const r = num(n.r, `"${n.op}"`);
        switch (n.op) {
          case "<":
            return l < r;
          case "<=":
            return l <= r;
          case ">":
            return l > r;
          case ">=":
            return l >= r;
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          default:
            if (r === 0) throw new RuleStop("error", "the rule divides by zero");
            return l / r;
        }
      }
    }
  };
  const result = value(ast);
  if (typeof result !== "boolean") throw new RuleStop("error", `a rule is a yes-or-no test, and this one gives ${JSON.stringify(result)}`);
  return result;
}
