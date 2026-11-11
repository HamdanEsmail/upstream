import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { handOver, legId } from "../src/trace/workflow";

/** A stand-in for the Workflow binding: it keeps what was asked of it. */
function binding(o: { createFails?: boolean; exists?: boolean } = {}) {
  const made: unknown[] = [];
  const asked: string[] = [];
  const workflow = {
    create: async (options: unknown) => {
      made.push(options);
      if (o.createFails) throw new Error("instance.already_exists");
      return {};
    },
    get: async (id: string) => {
      asked.push(id);
      if (!o.exists) throw new Error("instance.not_found");
      return { status: async () => ({ status: "running" }) };
    },
  };
  return { made, asked, env: { ...env, TRACE_WORKFLOW: workflow } as unknown as Env };
}

describe("handing a trace over to a fresh Workflow run", () => {
  it("gives every leg a run id of its own, built from the trace's", () => {
    expect(legId("qg55tfayga", { part: "start" })).toBe("qg55tfayga");
    expect(legId("qg55tfayga", { part: "wait", turn: 40 })).toBe("qg55tfayga-wait-40");
    expect(legId("qg55tfayga", { part: "check", from: 8, count: 12 })).toBe("qg55tfayga-check-8");
    expect(legId("qg55tfayga", { part: "book" })).toBe("qg55tfayga-book");
  });

  it("starts the run with the trace and the leg it is to carry", async () => {
    const b = binding();
    await handOver(b.env, "t1", { part: "wait", turn: 0 });
    expect(b.made).toEqual([{ id: "t1-wait-0", params: { traceId: "t1", leg: { part: "wait", turn: 0 } } }]);
  });

  it("leaves a run alone that exists already: a hand-over tried twice starts one run", async () => {
    const b = binding({ createFails: true, exists: true });
    await expect(handOver(b.env, "t1", { part: "book" })).resolves.toBeUndefined();
    expect(b.asked).toEqual(["t1-book"]);
  });

  it("passes the failure on when the run was not started", async () => {
    const b = binding({ createFails: true, exists: false });
    await expect(handOver(b.env, "t1", { part: "book" })).rejects.toThrow("instance.already_exists");
  });
});
