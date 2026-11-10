import { memo } from "react";

import type { summarizeSidebarProjectBadge } from "../Sidebar.logic";
import "./SidebarThreadBadge.css";

export type SidebarThreadBadgeSummary = ReturnType<typeof summarizeSidebarProjectBadge>;

export const SidebarThreadBadge = memo(
  function SidebarThreadBadge({ badge }: { readonly badge: SidebarThreadBadgeSummary }) {
    if (badge === null) return null;
    return (
      <span
        aria-hidden
        data-thread-badge
        data-working={badge.count === 0 || undefined}
        className={badge.className}
      >
        {badge.label === null ? null : <span>{badge.label}</span>}
      </span>
    );
  },
  (previous, next) =>
    previous.badge?.count === next.badge?.count &&
    previous.badge?.label === next.badge?.label &&
    previous.badge?.className === next.badge?.className &&
    previous.badge?.description === next.badge?.description,
);
