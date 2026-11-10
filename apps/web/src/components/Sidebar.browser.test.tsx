import { getProjectOrderKey } from "@t3tools/client-runtime/state/project-grouping";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { readProjects, useProjects, useQuietThreadShells } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import { useUiStateStore } from "../uiStateStore";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("sidebar header new thread", () => {
  it.each([
    { mode: "normal", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: false, picker: true },
    { mode: "boring", count: 2, shift: true, picker: false },
    { mode: "boring", count: 1, shift: false, picker: false },
  ] as const)("$mode sidebar, $count projects, shift=$shift: picker=$picker", async (scenario) => {
    using stack = new DisposableStack();
    useUiStateStore.setState(useUiStateStore.getInitialState(), true);
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
    });
    const projects = [project("active"), project("idle")].slice(0, scenario.count);
    const currentProjectRef = {
      environmentId: projects[0]!.environmentId,
      projectId: projects[0]!.id,
    };
    const startThread = vi.fn().mockResolvedValue(null);
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(readProjects).mockReturnValue(projects);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: currentProjectRef,
      handleNewThread: startThread,
      routeDraftId: null,
      routeThreadRef: null,
    });
    vi.mocked(openCommandPalette).mockClear();
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "New thread", exact: true }), {
      modifiers: scenario.shift ? ["Shift"] : [],
    });

    if (scenario.picker) {
      expect(openCommandPalette).toHaveBeenCalledExactlyOnceWith({
        open: "new-thread-in",
        newThreadTarget: { kind: "full" },
      });
      expect(startThread).not.toHaveBeenCalled();
    } else {
      expect(openCommandPalette).not.toHaveBeenCalled();
      expect(startThread).toHaveBeenCalledExactlyOnceWith(currentProjectRef);
    }
  });
});

describe("grouped sidebar", () => {
  it("lists full thread cards under project headers in the icon order and Alt+Enter or Alt+Space toggles every header", async () => {
    using stack = new DisposableStack();
    const previousSettings = getClientSettings();
    stack.defer(() => __setClientSettingsForTests(previousSettings));
    __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, boringSidebarEnabled: true });
    const projects = [project("alpha"), project("beta")];
    useUiStateStore.setState(
      {
        ...useUiStateStore.getInitialState(),
        sidebarProjectIconOrder: "manual",
        projectOrder: projects.toReversed().map(getProjectOrderKey),
      },
      true,
    );
    vi.mocked(useProjects).mockReturnValue(projects);
    vi.mocked(readProjects).mockReturnValue(projects);
    vi.mocked(useQuietThreadShells).mockReturnValue([
      ...projects.map((entry) =>
        makeThreadFixture({
          id: ThreadId.make(`thread-${entry.id}`),
          environmentId: entry.environmentId,
          projectId: entry.id,
          title: `Task in ${entry.id}`,
          activeOrderKey: "m",
          latestUserAuthoredMessageAt: "2026-01-02T00:00:00.000Z",
        }),
      ),
      makeThreadFixture({
        id: ThreadId.make("thread-alpha-later"),
        environmentId: projects[0]!.environmentId,
        projectId: projects[0]!.id,
        title: "Later task in alpha",
        activeOrderKey: "t",
        latestUserAuthoredMessageAt: "2026-01-03T00:00:00.000Z",
      }),
    ]);
    vi.mocked(useHandleNewThread).mockReturnValue({
      activeDraftThread: null,
      activeThread: null,
      defaultProjectRef: null,
      handleNewThread: vi.fn(),
      routeDraftId: null,
      routeThreadRef: null,
    });
    await using screen = await render(
      <SidebarProvider>
        <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
      </SidebarProvider>,
    );
    const alpha = screen.getByRole("button", { name: /^alpha/ });
    const beta = screen.getByRole("button", { name: /^beta/ });

    await expect.element(screen.getByTestId("sidebar-row-card").nth(2)).toBeVisible();
    expect(screen.getByTestId("sidebar-row-folder").elements()).toHaveLength(0);
    expect(
      beta.element().compareDocumentPosition(alpha.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const cards = screen.getByTestId("sidebar-row-card").elements();
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Task in beta"),
      expect.stringContaining("Task in alpha"),
      expect.stringContaining("Later task in alpha"),
    ]);
    for (const card of [cards[0]!, cards[1]!]) {
      expect(
        card.closest("li")?.previousElementSibling?.matches("[data-testid=sidebar-project-folder]"),
      ).toBe(true);
    }

    (alpha.element() as HTMLElement).focus();
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    await expect.element(alpha).toHaveAttribute("aria-expanded", "false");
    await expect.element(beta).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("sidebar-row-card").elements()).toHaveLength(0);

    await userEvent.keyboard("{Alt>} {/Alt}");
    await expect.element(alpha).toHaveAttribute("aria-expanded", "true");
    await expect.element(beta).toHaveAttribute("aria-expanded", "true");
  });
});
