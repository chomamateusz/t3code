import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { ChevronDownIcon, MonitorSmartphoneIcon } from "lucide-react";
import { useState } from "react";

import { isMacPlatform } from "../../lib/utils";
import {
  buildSidebarEnvironmentScopeItems,
  nextSidebarEnvironmentScopeKeys,
} from "../../sidebarEnvironmentScope";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import "./SidebarMachineRow.css";

export function SidebarMachineRow({
  environments,
  primaryEnvironmentId,
  machineById,
  selectedIds,
  onChange,
}: {
  readonly environments: Parameters<typeof buildSidebarEnvironmentScopeItems>[0]["environments"];
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly machineById: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const isMac = isMacPlatform(navigator.platform);
  const items = buildSidebarEnvironmentScopeItems({ environments, primaryEnvironmentId });
  if (items.length === 0) return null;
  const selected = items.filter(
    (item) => item.environmentId !== null && selectedIds?.has(item.environmentId),
  );
  const label =
    selected.length === 0 ? "All machines" : selected.map((item) => item.label).join(", ");
  const icon = (id: EnvironmentId | null) =>
    id === null ? (
      <MonitorSmartphoneIcon className="size-4 shrink-0" />
    ) : (
      <EnvironmentMachineIcon kind={machineById.get(id) ?? "server"} className="size-4 shrink-0" />
    );

  return (
    <div data-machine-row="root">
      <Menu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <button
                    type="button"
                    data-machine-row="trigger"
                    aria-label={`Filter threads by machine: ${label}`}
                  />
                }
              />
            }
          >
            {selected.length === 0
              ? icon(null)
              : selected.map((item) => <span key={item.value}>{icon(item.environmentId)}</span>)}
            <span data-machine-row="label">{label}</span>
            <ChevronDownIcon className="size-3.5 shrink-0" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">{label}</TooltipPopup>
        </Tooltip>
        <MenuPopup align="start">
          <MenuItem onClick={() => onChange([])}>
            <span className="flex min-w-0 items-center gap-2">
              {icon(null)}
              <span>All machines</span>
            </span>
          </MenuItem>
          <MenuSeparator />
          {items
            .filter(
              (item): item is typeof item & { environmentId: EnvironmentId } =>
                item.environmentId !== null,
            )
            .map((item) => (
              <MenuCheckboxItem
                key={item.value}
                checked={selectedIds?.has(item.environmentId) ?? false}
                closeOnClick={false}
                onCheckedChange={(_, details) => {
                  const event = details.event;
                  if (isMac && event instanceof MouseEvent && event.ctrlKey) {
                    details.cancel();
                    return;
                  }
                  const additive =
                    event instanceof MouseEvent && (isMac ? event.metaKey : event.ctrlKey);
                  onChange(
                    nextSidebarEnvironmentScopeKeys(
                      [...(selectedIds ?? [])],
                      item.environmentId,
                      additive,
                      environments.map((environment) => environment.environmentId),
                    ),
                  );
                  if (!additive) setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {icon(item.environmentId)}
                  <span className="min-w-0 truncate">{item.label}</span>
                </span>
              </MenuCheckboxItem>
            ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}
