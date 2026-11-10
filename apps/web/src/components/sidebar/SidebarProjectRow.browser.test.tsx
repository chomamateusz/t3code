import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { Atom, AtomRegistry } from "effect/reactivity";

import { isMacPlatform } from "../../lib/utils";
import { render } from "../../../test/render";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  activeSidebarProjectSelection,
  buildSidebarProjectActivity,
  clearSidebarProjectSelection,
  isInSidebarProjectScope,
  sidebarProjectMemberScope,
  effectiveSidebarProjectSelection,
  sameSidebarProjectActivity,
  toggleSidebarProjectSelection,
} from "../../sidebarProjectRow";
import type { SidebarProjectBadge } from "../Sidebar.logic";
import { SidebarProjectRow } from "./SidebarProjectRow";
import { useUiStateStore } from "../../uiStateStore";
import type { SidebarProjectIconOrder } from "../../sidebarProjectRow";

const settingsMock = vi.hoisted(() => ({
  updateClientSettings: vi.fn(async (_patch: { readonly boringSidebarEnabled: boolean }) => {}),
}));

vi.mock(import("../ProjectFavicon"), () => ({ ProjectFavicon: () => <span /> }));
vi.mock(import("../../hooks/useSettings"), () => ({
  useClientSettings: (<T,>(select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => T) =>
    select(DEFAULT_CLIENT_SETTINGS)) as never,
  getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
  subscribeClientSettings: () => () => undefined,
  updateClientSettings: settingsMock.updateClientSettings as never,
}));

function setup() {
  settingsMock.updateClientSettings.mockClear();
  useUiStateStore.setState({
    sidebarProjectScopeKeys: [],
    sidebarProjectExcludeKeys: [],
    sidebarProjectFilterMode: "include",
  });
}

const selectionModifier = () => (isMacPlatform(navigator.platform) ? "Meta" : "Control");

function makeProject(name: string): SidebarProjectSnapshot {
  const project = {
    id: ProjectId.make(name),
    environmentId: EnvironmentId.make("local"),
    title: name,
    workspaceRoot: `/projects/${name}`,
    repositoryIdentity: null,
    defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    scripts: [],
  };
  return {
    ...project,
    projectKey: name,
    pinned: false,
    archived: false,
    displayName: name,
    groupedProjectCount: 1,
    environmentPresence: "local-only",
    allRemoteMembersAreDesktopLocal: false,
    allRemoteMembersAreWsl: false,
    memberProjects: [{ ...project, physicalProjectKey: name, environmentLabel: "This Mac" }],
    memberProjectRefs: [{ environmentId: project.environmentId, projectId: project.id }],
    remoteEnvironmentLabels: [],
  };
}

function ProjectList({
  badges = [],
  onOpenSidebarSettings = () => undefined,
}: {
  readonly badges?: readonly SidebarProjectBadge[];
  readonly onOpenSidebarSettings?: () => void;
}) {
  const projects = ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot"].map(makeProject);
  const state = useUiStateStore();
  const mode = state.sidebarProjectFilterMode;
  const selection = activeSidebarProjectSelection(
    {
      include: state.sidebarProjectScopeKeys,
      exclude: state.sidebarProjectExcludeKeys,
    },
    mode,
  );
  const availableKeys = new Set(projects.map((project) => project.projectKey));
  const effectiveSelection = effectiveSidebarProjectSelection(selection, availableKeys);
  const scope = sidebarProjectMemberScope(projects, effectiveSelection);
  return (
    <div style={{ width: 200 }}>
      <SidebarProjectRow
        projects={projects}
        badges={badges}
        activity={projects.map((project, index) => ({
          projectKey: project.projectKey,
          threadCount: 1,
          lastActivity: 100 - index,
        }))}
        selectedKeys={effectiveSelection[mode]}
        mode={mode}
        showMachines
        onToggle={(key, additive) => {
          const next = toggleSidebarProjectSelection(selection, mode, key, additive, {
            groups: projects,
            settings: DEFAULT_CLIENT_SETTINGS,
            effectiveKeys: effectiveSelection[mode],
          });
          if (mode === "include") state.setSidebarProjectScopeKeys(next);
          else state.setSidebarProjectExcludeKeys(next);
        }}
        onClear={() => {
          const next = clearSidebarProjectSelection(selection, mode, {
            groups: projects,
            settings: DEFAULT_CLIENT_SETTINGS,
            effectiveKeys: effectiveSelection[mode],
          });
          if (mode === "include") state.setSidebarProjectScopeKeys(next);
          else state.setSidebarProjectExcludeKeys(next);
        }}
        onModeChange={(mode) =>
          state.setSidebarProjectFilterMode(mode, {
            groups: projects,
            settings: DEFAULT_CLIENT_SETTINGS,
            availableKeys,
          })
        }
        onOpenSidebarSettings={onOpenSidebarSettings}
        onProjectSettings={(event) => event.preventDefault()}
      />
      <ul aria-label="Visible threads">
        {projects
          .filter((project) =>
            isInSidebarProjectScope(
              { environmentId: project.environmentId, projectId: project.id },
              scope,
              null,
            ),
          )
          .map((project) => (
            <li key={project.projectKey}>{project.title} thread</li>
          ))}
      </ul>
    </div>
  );
}

it("filters through plain and modifier selections, hide mode and overflow search", async () => {
  const modifier = selectionModifier();
  useUiStateStore.setState({
    sidebarProjectScopeKeys: ["Remote"],
    sidebarProjectExcludeKeys: ["Remote-hidden"],
    sidebarProjectFilterMode: "include",
  });
  await using screen = await render(<ProjectList />);
  const threads = screen.getByRole("list", { name: "Visible threads" });
  await expect.element(threads.getByText("Foxtrot thread")).toBeVisible();
  await screen.getByRole("button", { name: /^Alpha(?:, hidden)?$/, exact: true }).click();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  await expect.element(threads.getByText("Beta thread")).not.toBeInTheDocument();
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote", "Alpha"]);
  await userEvent.keyboard(`{${modifier}>}`);
  await screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true }).click();
  await userEvent.keyboard(`{/${modifier}}`);
  await expect.element(threads.getByText("Beta thread")).toBeVisible();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote", "Alpha", "Beta"]);
  await screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true }).click();
  await expect.element(threads.getByText("Alpha thread")).not.toBeInTheDocument();
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote", "Beta"]);
  await screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true }).click();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote"]);
  await screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true }).click();
  await screen.getByRole("button", { name: "Clear project selection" }).click();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote"]);
  await screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true }).click();
  await screen.getByRole("button", { name: "Showing selected projects" }).click();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  await expect.element(threads.getByText("Beta thread")).not.toBeInTheDocument();
  await screen.getByRole("combobox", { name: /more projects/ }).click();
  await page.getByRole("combobox", { name: "Search project row" }).fill("Foxtrot");
  await page.getByRole("option", { name: "Foxtrot" }).click();
  await expect.element(threads.getByText("Foxtrot thread")).not.toBeInTheDocument();
  expect(useUiStateStore.getState().sidebarProjectExcludeKeys).toEqual([
    "Remote-hidden",
    "Foxtrot",
  ]);
  await userEvent.keyboard("{Escape}");
  await screen.getByRole("button", { name: "Clear project selection" }).click();
  await expect.element(threads.getByText("Beta thread")).toBeVisible();
  await expect.element(threads.getByText("Foxtrot thread")).toBeVisible();
  expect(useUiStateStore.getState().sidebarProjectExcludeKeys).toEqual(["Remote-hidden"]);
  await screen.getByRole("combobox", { name: /more projects/ }).click();
  await userEvent.keyboard(`{${modifier}>}`);
  for (const name of ["Alpha", "Beta", "Gamma", "Foxtrot"]) {
    await page.getByRole("option", { name, exact: true }).click();
    await expect.element(threads.getByText(`${name} thread`)).not.toBeInTheDocument();
  }
  await userEvent.keyboard(`{/${modifier}}`);
  await userEvent.keyboard("{Escape}");
  await expect
    .element(screen.getByRole("button", { name: /^Alpha(?:, hidden)?$/, exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /^Gamma(?:, hidden)?$/, exact: true }))
    .toBeVisible();
  await screen.getByRole("combobox", { name: "3 more projects, 1 selected" }).click();
  await page.getByRole("combobox", { name: "Search project row" }).fill("Foxtrot");
  await page.getByRole("option", { name: "Foxtrot" }).click();
  await expect.element(threads.getByText("Foxtrot thread")).not.toBeInTheDocument();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  await page.getByRole("option", { name: "Foxtrot" }).click();
  await expect.element(threads.getByText("Foxtrot thread")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect
    .element(screen.getByRole("combobox", { name: "2 more projects", exact: true }))
    .toBeVisible();
});

it.each(["right click", "Shift+F10"])(
  "allows Enter, Space and click after settings via %s",
  async (openSettings) => {
    useUiStateStore.setState({
      sidebarProjectScopeKeys: ["Remote"],
      sidebarProjectExcludeKeys: [],
      sidebarProjectFilterMode: "include",
    });
    await using screen = await render(<ProjectList />);
    const alpha = screen.getByRole("button", { name: /^Alpha(?:, hidden)?$/, exact: true });
    const beta = screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true });
    await expect.element(alpha).toBeVisible();
    for (const activation of ["Enter", "Space", "click"]) {
      if (openSettings === "right click") await alpha.click({ button: "right" });
      else {
        alpha.element().focus();
        await userEvent.keyboard("{Shift>}{F10}{/Shift}");
      }
      if (activation === "click") await beta.click();
      else {
        beta.element().focus();
        await userEvent.keyboard(activation === "Enter" ? "{Enter}" : " ");
      }
      await expect.element(beta).toHaveAttribute("aria-pressed", "true");
      expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote", "Beta"]);
      await beta.click();
      await expect.element(beta).toHaveAttribute("aria-pressed", "false");
      expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote"]);
    }
  },
);

function badgeCounts(
  counts: Partial<SidebarProjectBadge["counts"]>,
): SidebarProjectBadge["counts"] {
  return {
    approval: 0,
    input: 0,
    request: 0,
    failed: 0,
    limited: 0,
    woke: 0,
    done: 0,
    working: 0,
    ...counts,
  };
}

it("shows the combined badge of hidden projects on +N", async () => {
  useUiStateStore.setState({
    sidebarProjectScopeKeys: [],
    sidebarProjectExcludeKeys: [],
    sidebarProjectFilterMode: "include",
  });
  await using screen = await render(
    <ProjectList
      badges={[
        { projectKey: "Alpha", counts: badgeCounts({ done: 2 }) },
        { projectKey: "Echo", counts: badgeCounts({ done: 1, working: 1 }) },
        { projectKey: "Foxtrot", counts: badgeCounts({ approval: 1, working: 2 }) },
      ]}
    />,
  );
  const more = screen.getByRole("combobox", {
    name: "2 more projects · 1 approval · 1 done · 3 working",
    exact: true,
  });
  await expect.element(more).toBeVisible();
  const badge = more.element().querySelector("[data-thread-badge]");
  expect(badge?.textContent).toBe("2");
  expect(badge?.className).toBe("text-warning-foreground");
  const moreBox = more.element().getBoundingClientRect();
  const badgeBox = badge!.getBoundingClientRect();
  expect(badgeBox.width).toBeGreaterThan(0);
  expect(badgeBox.right).toBeLessThanOrEqual(moreBox.right + 1);
  expect(badgeBox.top).toBeGreaterThanOrEqual(moreBox.top - 1);
  await expect.element(badge as HTMLElement).toBeVisible();
  await more.hover();
  await expect.element(page.getByText("2 more projects", { exact: true })).toBeVisible();
});

it("shows a working dot on +N when hidden projects are only working", async () => {
  useUiStateStore.setState({
    sidebarProjectScopeKeys: [],
    sidebarProjectExcludeKeys: [],
    sidebarProjectFilterMode: "include",
  });
  await using screen = await render(
    <ProjectList badges={[{ projectKey: "Echo", counts: badgeCounts({ working: 1 }) }]} />,
  );
  const more = screen.getByRole("combobox", { name: "2 more projects · 1 working", exact: true });
  await expect.element(more).toBeVisible();
  const badge = more.element().querySelector("[data-thread-badge]");
  expect(badge?.hasAttribute("data-working")).toBe(true);
  expect(badge?.textContent).toBe("");
  expect(badge?.className).toBe("text-info-foreground");
});

it("switches the mode on click, grouping with the selection modifier and settings with left Alt only", async () => {
  setup();
  const modifier = selectionModifier();
  const onOpenSidebarSettings = vi.fn();
  {
    await using screen = await render(
      <ProjectList onOpenSidebarSettings={onOpenSidebarSettings} />,
    );
    await screen.getByRole("button", { name: "Showing selected projects" }).click();
    expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("exclude");
    await screen.getByRole("button", { name: "Hiding selected projects" }).click();
    expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("include");

    await userEvent.keyboard("{AltRight>}");
    const showing = screen.getByRole("button", { name: "Showing selected projects" });
    await expect.element(showing).toHaveAttribute("data-face", "include");
    await showing.click();
    await userEvent.keyboard("{/AltRight}");
    expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("exclude");
    expect(onOpenSidebarSettings).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Hiding selected projects" }).click();

    await userEvent.keyboard(`{${modifier}>}`);
    await screen.getByRole("button", { name: "Group threads by project" }).click();
    await userEvent.keyboard(`{/${modifier}}`);
    expect(settingsMock.updateClientSettings).toHaveBeenCalledExactlyOnceWith({
      boringSidebarEnabled: true,
    });
    await userEvent.keyboard("{Alt>}");
    await screen.getByRole("button", { name: "Sidebar settings" }).click();
    await userEvent.keyboard("{/Alt}");
    expect(onOpenSidebarSettings).toHaveBeenCalledOnce();
    expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("include");

    screen.getByRole("button", { name: "Showing selected projects" }).element().focus();
    await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`);
    expect(settingsMock.updateClientSettings).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    expect(onOpenSidebarSettings).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Enter}");
    expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("exclude");
  }
  {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    await using screen = await render(<ProjectList />);
    const hiding = screen.getByRole("button", { name: "Hiding selected projects" });
    const altGraph = { altKey: true, ctrlKey: true };
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ...altGraph }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "AltGraph",
        code: "AltRight",
        modifierAltGraph: true,
        ...altGraph,
      }),
    );
    await expect.element(hiding).toHaveAttribute("data-face", "exclude");
    hiding
      .element()
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, modifierAltGraph: true, ...altGraph }),
      );
    expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("include");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "AltGraph", code: "AltRight" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(settingsMock.updateClientSettings).toHaveBeenCalledTimes(2);
  }
  {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await using screen = await render(<ProjectList />);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Alt",
        code: "AltLeft",
        altKey: true,
        modifierAltGraph: true,
      }),
    );
    await expect
      .element(screen.getByRole("button", { name: "Sidebar settings" }))
      .toHaveAttribute("data-face", "settings");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", code: "AltLeft" }));
  }
});

it("shows the held modifier's action anywhere and resets it when the window loses focus", async () => {
  setup();
  const modifier = selectionModifier();
  await using screen = await render(<ProjectList />);
  const showing = screen.getByRole("button", { name: "Showing selected projects" });
  await expect.element(showing).toBeVisible();
  await userEvent.keyboard(`{${modifier}>}`);
  await expect
    .element(screen.getByRole("button", { name: "Group threads by project" }))
    .toHaveAttribute("aria-pressed", "false");
  await userEvent.keyboard("{Alt>}");
  await expect
    .element(screen.getByRole("button", { name: "Group threads by project" }))
    .toBeVisible();
  await userEvent.keyboard(`{/${modifier}}`);
  await expect.element(screen.getByRole("button", { name: "Sidebar settings" })).toBeVisible();
  window.dispatchEvent(new Event("blur"));
  await expect.element(showing).toBeVisible();
  await userEvent.keyboard("{/Alt}");
  await expect.element(showing).toBeVisible();
});

it("opens the switch's secondary menu from the keyboard with its three actions", async () => {
  setup();
  const onOpenSidebarSettings = vi.fn();
  await using screen = await render(<ProjectList onOpenSidebarSettings={onOpenSidebarSettings} />);
  const showing = screen.getByRole("button", { name: "Showing selected projects" });
  showing.element().focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  await expect
    .element(page.getByRole("menuitemradio", { name: "Show selected" }))
    .toHaveAttribute("aria-checked", "true");
  await expect
    .element(page.getByRole("menuitemradio", { name: "Group threads by project" }))
    .toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitemradio", { name: "Hide selected" }).click();
  expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("exclude");

  const hiding = screen.getByRole("button", { name: "Hiding selected projects" });
  hiding.element().focus();
  await userEvent.keyboard("{ContextMenu}");
  await page.getByRole("menuitemradio", { name: "Group threads by project" }).click();
  expect(settingsMock.updateClientSettings).toHaveBeenCalledExactlyOnceWith({
    boringSidebarEnabled: true,
  });

  hiding.element().focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  await page.getByRole("menuitem", { name: "Sidebar settings" }).click();
  expect(onOpenSidebarSettings).toHaveBeenCalledOnce();
  expect(useUiStateStore.getState().sidebarProjectFilterMode).toBe("exclude");
});

function BareRow({
  projects,
  activity = projects.map((project) => ({
    projectKey: project.projectKey,
    threadCount: 1,
    lastActivity: 1,
  })),
}: {
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly activity?: readonly {
    readonly projectKey: string;
    readonly threadCount: number;
    readonly lastActivity: number;
  }[];
}) {
  return (
    <div style={{ width: 200 }}>
      <SidebarProjectRow
        projects={projects}
        badges={[]}
        activity={activity}
        selectedKeys={[]}
        mode="include"
        showMachines={false}
        onToggle={() => undefined}
        onClear={() => undefined}
        onModeChange={() => undefined}
        onOpenSidebarSettings={() => undefined}
        onProjectSettings={() => undefined}
      />
    </div>
  );
}

it.each<{ order: SidebarProjectIconOrder; expected: string[] }>([
  { order: "name", expected: ["Alpha", "Zulu"] },
  { order: "activity", expected: ["Zulu", "Alpha"] },
])("orders icons by $order when newer activity breaks a name tie", async ({ order, expected }) => {
  const projects = [
    { ...makeProject("Zulu"), projectKey: "a" },
    { ...makeProject("Alpha"), projectKey: "b" },
  ];
  const tiedAt = "2026-11-03T10:00:00.000Z";
  const threads = projects.map((project) => ({
    environmentId: project.environmentId,
    projectId: project.id,
    archivedAt: null,
    updatedAt: tiedAt,
  }));
  const source = Atom.make(threads);
  const activity = Atom.make((get) =>
    buildSidebarProjectActivity(projects, get(source), order),
  ).pipe(Atom.withEquality(sameSidebarProjectActivity));
  const registry = AtomRegistry.make();
  const release = registry.mount(activity);
  await using screen = await render(
    <BareRow projects={projects} activity={registry.get(activity)} />,
  );
  const iconLabels = () =>
    [...screen.container.querySelectorAll('[data-project-row="icon"]')].map((icon) =>
      icon.getAttribute("aria-label"),
    );
  try {
    await expect.element(screen.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
    expect(iconLabels()).toEqual(["Alpha", "Zulu"]);
    const tiedActivity = registry.get(activity);
    registry.set(source, [{ ...threads[0]!, updatedAt: "2026-11-03T11:00:00.000Z" }, threads[1]!]);
    expect(registry.get(activity) === tiedActivity).toBe(order === "name");
    await screen.rerender(<BareRow projects={projects} activity={registry.get(activity)} />);
    await vi.waitFor(() => expect(iconLabels()).toEqual(expected));
  } finally {
    release();
    registry.dispose();
  }
});
