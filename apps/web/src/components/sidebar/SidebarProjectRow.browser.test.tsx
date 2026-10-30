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
import { isSidebarBadgeLegendAvailable, openSidebarBadgeLegend } from "../../sidebarBadgeLegend";

vi.mock(import("../ProjectFavicon"), () => ({ ProjectFavicon: () => <span /> }));
vi.mock(import("../../hooks/useSettings"), () => ({
  useClientSettings: (<T,>(select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => T) =>
    select(DEFAULT_CLIENT_SETTINGS)) as never,
  getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
  subscribeClientSettings: () => () => undefined,
  updateClientSettings: async () => undefined,
}));

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

function ProjectList({ badges = [] }: { readonly badges?: readonly SidebarProjectBadge[] }) {
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
  const modifier = isMacPlatform(navigator.platform) ? "Meta" : "Control";
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
  await screen.getByRole("button", { name: "Project filter options" }).click();
  await page.getByRole("menuitem", { name: /Clear selection\s*1/ }).click();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  expect(useUiStateStore.getState().sidebarProjectScopeKeys).toEqual(["Remote"]);
  await userEvent.keyboard("{Escape}");
  await screen.getByRole("button", { name: /^Beta(?:, hidden)?$/, exact: true }).click();
  await screen.getByRole("button", { name: "Project filter options" }).click();
  await page.getByRole("menuitemradio", { name: "Hide selected" }).click();
  await expect.element(threads.getByText("Alpha thread")).toBeVisible();
  await expect.element(threads.getByText("Beta thread")).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
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
  const badge = more.element().querySelector('[data-project-row="thread-badge"]');
  expect(badge?.textContent).toBe("2");
  expect(badge?.className).toBe("text-warning-foreground");
  const moreBox = more.element().getBoundingClientRect();
  const badgeBox = badge!.getBoundingClientRect();
  expect(badgeBox.width).toBeGreaterThan(0);
  expect(badgeBox.right).toBeLessThanOrEqual(moreBox.right + 1);
  expect(badgeBox.top).toBeGreaterThanOrEqual(moreBox.top - 1);
  await expect.element(badge as HTMLElement).toBeVisible();
  await more.hover();
  await expect
    .element(page.getByText("2 more projects · 1 approval · 1 done · 3 working", { exact: true }))
    .toBeVisible();
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
  const badge = more.element().querySelector('[data-project-row="thread-badge"]');
  expect(badge?.hasAttribute("data-working")).toBe(true);
  expect(badge?.textContent).toBe("");
  expect(badge?.className).toBe("text-info-foreground");
});

it("explains the badges from the options menu and from a legend request", async () => {
  useUiStateStore.setState({
    sidebarProjectScopeKeys: [],
    sidebarProjectExcludeKeys: [],
    sidebarProjectFilterMode: "include",
  });
  await using screen = await render(<ProjectList />);
  const options = screen.getByRole("button", { name: "Project filter options" });
  options.element().focus();
  await userEvent.keyboard("{Enter}");
  await page.getByRole("menuitem", { name: "Badge legend" }).click();
  const legend = page.getByRole("dialog", { name: "Project badges" });
  await expect.element(legend).toBeVisible();
  const rows = [...legend.element().querySelectorAll("li")].map((row) => ({
    label: row.children[1]?.textContent,
    badge: row.querySelector('[data-project-row="thread-badge"]')?.className,
    count: row.querySelector('[data-project-row="thread-badge"]')?.textContent,
  }));
  expect(rows).toEqual([
    { label: "Approval", badge: "text-warning-foreground", count: "1" },
    { label: "Needs input", badge: "text-indigo-600 dark:text-indigo-300", count: "1" },
    { label: "Request", badge: "text-guest-foreground", count: "1" },
    { label: "Failed", badge: "text-error-foreground", count: "1" },
    { label: "Limited", badge: "text-warning-foreground", count: "1" },
    { label: "Woke", badge: "text-warning-foreground", count: "1" },
    { label: "Done", badge: "text-success-foreground", count: "1" },
    { label: "Working", badge: "text-info-foreground", count: "" },
  ]);
  await userEvent.keyboard("{Escape}");
  await expect.element(legend).not.toBeInTheDocument();
  await expect.element(options).toHaveFocus();

  openSidebarBadgeLegend();
  await expect.element(legend).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(legend).not.toBeInTheDocument();
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
        onProjectSettings={() => undefined}
      />
    </div>
  );
}

it("offers no legend without projects and never opens it on its own later", async () => {
  const projects = ["Alpha", "Beta"].map(makeProject);
  await using screen = await render(<BareRow projects={[]} />);
  expect(screen.container.querySelector('[data-project-row="root"]')).toBeNull();
  expect(isSidebarBadgeLegendAvailable()).toBe(false);
  openSidebarBadgeLegend();

  await screen.rerender(<BareRow projects={projects} />);
  await expect.element(screen.getByRole("group", { name: "Filter projects" })).toBeVisible();
  expect(isSidebarBadgeLegendAvailable()).toBe(true);
  const legend = page.getByRole("dialog", { name: "Project badges" });
  await expect.element(legend).not.toBeInTheDocument();

  openSidebarBadgeLegend();
  await expect.element(legend).toBeVisible();
  await screen.rerender(<BareRow projects={[]} />);
  await expect.element(legend).not.toBeInTheDocument();
  expect(isSidebarBadgeLegendAvailable()).toBe(false);
  await screen.rerender(<BareRow projects={projects} />);
  await expect.element(screen.getByRole("group", { name: "Filter projects" })).toBeVisible();
  await expect.element(legend).not.toBeInTheDocument();
});

it("moves a project ahead when its activity breaks a name-ordered tie", async () => {
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
  const activity = Atom.make((get) => buildSidebarProjectActivity(projects, get(source))).pipe(
    Atom.withEquality(sameSidebarProjectActivity),
  );
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
    registry.set(source, [{ ...threads[0]!, updatedAt: "2026-11-03T11:00:00.000Z" }, threads[1]!]);
    await screen.rerender(<BareRow projects={projects} activity={registry.get(activity)} />);
    await vi.waitFor(() => expect(iconLabels()).toEqual(["Zulu", "Alpha"]));
  } finally {
    release();
    registry.dispose();
  }
});
