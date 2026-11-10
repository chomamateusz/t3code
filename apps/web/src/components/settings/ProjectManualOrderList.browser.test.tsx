import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";

const fixtures = vi.hoisted(() => {
  const project = (name: string, pinned: boolean) =>
    ({
      id: name,
      environmentId: "local",
      title: name,
      workspaceRoot: `/projects/${name}`,
      projectKey: name,
      displayName: name,
      pinned,
      archived: false,
      updatedAt: "2026-11-01T00:00:00.000Z",
      memberProjects: [
        { physicalProjectKey: `local:/projects/${name}`, workspaceRoot: `/projects/${name}` },
      ],
      memberProjectRefs: [{ environmentId: "local", projectId: name }],
    }) as unknown as SidebarProjectSnapshot;
  return { projects: [project("Pinned", true), project("Alpha", false), project("Zulu", false)] };
});

vi.mock(import("../ProjectFavicon"), () => ({ ProjectFavicon: () => <span /> }));
vi.mock(import("~/hooks/useSidebarProjectRowData"), async () => {
  const { buildSidebarProjectActivity, sidebarProjectManualRanks } =
    await import("~/sidebarProjectRow");
  const { selectSidebarProjectManualOrder, useUiStateStore } = await import("~/uiStateStore");
  return {
    useSidebarProjectIconOrder: () => ({
      projects: fixtures.projects,
      activity: buildSidebarProjectActivity(
        fixtures.projects,
        [],
        "manual",
        sidebarProjectManualRanks(
          fixtures.projects,
          useUiStateStore(selectSidebarProjectManualOrder),
        ),
      ),
    }),
  } as never;
});

import { render } from "../../../test/render";
import { useUiStateStore } from "~/uiStateStore";
import { ProjectManualOrderList } from "./ProjectManualOrderList";

it("moves a project up by keyboard and stores the manual order", async () => {
  useUiStateStore.setState({ sidebarProjectIconOrder: "manual", projectOrder: [] });
  await using screen = await render(<ProjectManualOrderList />);
  await userEvent.click(screen.getByRole("button", { name: "Reorder Zulu, position 3" }));
  await userEvent.keyboard(" ");
  await userEvent.keyboard("{ArrowUp}");
  await userEvent.keyboard(" ");

  await expect
    .element(screen.getByRole("button", { name: "Reorder Zulu, position 2" }))
    .toBeVisible();
  expect(useUiStateStore.getState().projectOrder).toEqual([
    "local:/projects/Zulu",
    "local:/projects/Alpha",
    "local:/projects/Pinned",
  ]);
});
