// @effect-diagnostics globalDate:off -- A fixed instant keeps calendar-window assertions deterministic.
import { UsageDay } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeUsageWindow, usageChartDays } from "./usageRange";

describe("all-time usage range", () => {
  it("requests daily usage from the fixed early day through today", () => {
    vi.stubEnv("TZ", "UTC");
    try {
      expect(makeUsageWindow("all", new Date("2026-10-03T12:00:00Z"))).toEqual({
        sinceDay: "1970-01-01",
        untilDay: "2026-10-03",
        timeZone: "UTC",
        resolution: "day",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("starts the all-time chart on its earliest day with data", () => {
    expect(
      usageChartDays(
        { sinceDay: UsageDay.make("1970-01-01"), untilDay: UsageDay.make("2026-01-05") },
        [{ day: "2026-01-03" }, { day: "2026-01-02" }],
      ),
    ).toEqual(["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
    expect(
      usageChartDays(
        { sinceDay: UsageDay.make("1970-01-01"), untilDay: UsageDay.make("2026-01-05") },
        [],
      ),
    ).toEqual(["2026-01-05"]);
  });
  it("keeps the full finite displayed window while another range loads", () => {
    expect(
      usageChartDays(
        { sinceDay: UsageDay.make("2026-01-01"), untilDay: UsageDay.make("2026-01-03") },
        [{ day: "2026-01-03" }],
      ),
    ).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });
});
