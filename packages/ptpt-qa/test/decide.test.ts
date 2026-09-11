import { describe, expect, it } from "vitest";
import type { GateDecision, JudgeResult, ValidatorReport } from "@imovel/core";
import { GATE_THRESHOLDS } from "@imovel/core";
import { decide } from "../src/index";

const ok = (name: string, severity: "hard" | "soft" = "hard"): ValidatorReport => ({ name, ok: true, severity, issues: [], details: {} });
const fail = (name: string, severity: "hard" | "soft" = "hard"): ValidatorReport => ({ name, ok: false, severity, issues: [`${name} failed`], details: {} });
const judge = (score: number): JudgeResult => ({ pt_pt_score: score, register_score: null, flagged_spans: [], summary: null });
const allOk = ["facts", "lexicon", "grammar", "shape", "claims"].map((n) => ok(n)).concat(ok("edit_ratio", "soft"));

interface Case {
  name: string;
  validators: ValidatorReport[];
  judge: JudgeResult | null;
  loop: number;
  attempt: number;
  expected: GateDecision;
  reason?: RegExp;
}

const cases: Case[] = [
  { name: "all ok, judge 95", validators: allOk, judge: judge(95), loop: 1, attempt: 1, expected: "pass" },
  { name: "all ok, judge exactly 90", validators: allOk, judge: judge(GATE_THRESHOLDS.judgePass), loop: 1, attempt: 1, expected: "pass" },
  { name: "all ok, no judge", validators: allOk, judge: null, loop: 1, attempt: 1, expected: "pass" },
  { name: "lexicon fails, attempt 1", validators: [...allOk, fail("lexicon")], judge: judge(95), loop: 1, attempt: 1, expected: "retry_amalia", reason: /lexicon/ },
  { name: "edit ratio soft fail, attempt 1", validators: [ok("lexicon"), fail("edit_ratio", "soft")], judge: null, loop: 1, attempt: 1, expected: "retry_amalia" },
  { name: "facts fail, attempt 2, loop 1", validators: [fail("facts")], judge: null, loop: 1, attempt: 2, expected: "regenerate" },
  { name: "grammar fails, attempt 2, loop 2", validators: [fail("grammar")], judge: judge(95), loop: 2, attempt: 2, expected: "needs_review" },
  { name: "all ok, judge 85 (soft), loop 1", validators: allOk, judge: judge(85), loop: 1, attempt: 1, expected: "regenerate", reason: /judge: 85 < 90/ },
  { name: "all ok, judge 85 (soft), loop 2", validators: allOk, judge: judge(85), loop: 2, attempt: 1, expected: "needs_review" },
  { name: "lexicon fails and judge 70 (hard) skips the retry", validators: [fail("lexicon")], judge: judge(70), loop: 1, attempt: 1, expected: "regenerate", reason: /judge: 70 < 80/ },
  { name: "all ok, judge 79, loop 2", validators: allOk, judge: judge(79), loop: 2, attempt: 1, expected: "needs_review" },
  { name: "unknown validator fails, attempt 1", validators: [fail("tenant_style")], judge: null, loop: 1, attempt: 1, expected: "regenerate" },
  { name: "retryable and unknown fail together", validators: [fail("lexicon"), fail("tenant_style")], judge: null, loop: 1, attempt: 1, expected: "regenerate" },
];

describe("decide", () => {
  for (const c of cases) {
    it(c.name, () => {
      const out = decide({ validators: c.validators, judge: c.judge, loop: c.loop, attempt: c.attempt });
      expect(out.decision).toBe(c.expected);
      expect(out.reasons.length).toBeGreaterThan(0);
      if (c.reason) expect(out.reasons.join("\n")).toMatch(c.reason);
    });
  }

  it("honours custom thresholds", () => {
    const out = decide({
      validators: allOk,
      judge: judge(85),
      loop: 1,
      attempt: 1,
      thresholds: { ...GATE_THRESHOLDS, judgePass: 80 },
    });
    expect(out.decision).toBe("pass");
  });
});
