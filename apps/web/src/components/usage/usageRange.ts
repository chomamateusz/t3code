import { UsageDay, type UsageSummaryInput } from "@t3tools/contracts";
import { enumerateDays, makeWindow } from "@t3tools/shared/usageFormat";

export type UsageRange = 1 | 7 | 30 | 90 | "all";

export const ALL_USAGE_SINCE_DAY = UsageDay.make("1970-01-01");

export function makeUsageWindow(range: UsageRange, now = new Date()): UsageSummaryInput {
  const window = makeWindow(range === "all" ? 1 : range, now, range === 1 ? "hour" : "day");
  return range === "all" ? { ...window, sinceDay: ALL_USAGE_SINCE_DAY } : window;
}

export function usageChartDays(
  window: Pick<UsageSummaryInput, "sinceDay" | "untilDay">,
  daily: readonly { readonly day: string }[],
): readonly string[] {
  const sinceDay =
    window.sinceDay === ALL_USAGE_SINCE_DAY
      ? (daily.reduce<string | undefined>(
          (earliest, entry) =>
            earliest === undefined || entry.day < earliest ? entry.day : earliest,
          undefined,
        ) ?? window.untilDay)
      : window.sinceDay;
  return enumerateDays(sinceDay, window.untilDay);
}
