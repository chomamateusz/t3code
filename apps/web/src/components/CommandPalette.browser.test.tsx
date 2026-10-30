import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { makeThreadFixture } from "../test-fixtures";
import type { Project, Thread } from "../types";
import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useUiStateStore } from "../uiStateStore";
import type { NewThreadTarget } from "../newThreadTarget";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects, useVisibleThreadShells } from "../state/entities";
import { useNewThreadTargetInput } from "../newThreadTargetState";
import { useScratchProject } from "../hooks/useScratchProject";
import { useSortedProjectGroups } from "./CommandPaletteLookups";
import { CommandPalette } from "./CommandPalette";

vi.mock("../state/entities", { spy: true });
vi.mock("../newThreadTargetState", { spy: true });
vi.mock("../hooks/useScratchProject", { spy: true });
vi.mock("./CommandPaletteLookups", { spy: true });

function setup(state: { projects?: ReadonlyArray<Project>; threads?: ReadonlyArray<Thread> } = {}) {
  vi.mocked(useProjects).mockReturnValue(state.projects ?? []);
  vi.mocked(useVisibleThreadShells).mockReturnValue(state.threads ?? []);
  vi.mocked(useSortedProjectGroups).mockReturnValue(
    buildSidebarProjectSnapshots({
      projects: state.projects ?? [],
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
      primaryEnvironmentId: EnvironmentId.make("local"),
      resolveEnvironmentLabel: () => null,
    }),
  );
  vi.mocked(useNewThreadTargetInput).mockReturnValue({
    groups: [],
    environments: [],
    environmentScopeKeys: [],
    selection: { include: [], exclude: [] },
    primaryEnvironmentId: null,
  });
  vi.mocked(useScratchProject).mockReturnValue({
    scratchEnvironmentId: () => EnvironmentId.make("local"),
    scratchWorkspaceRootFor: () => "/scratch",
    startScratchThread: async () => {},
    openScratchProject: async () => null,
  });
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  useUiStateStore.setState(useUiStateStore.getInitialState(), true);
}

function restrictedTarget(): Extract<NewThreadTarget, { kind: "restricted" }> {
  return {
    kind: "restricted",
    title: "Choose a machine for print3d",
    members: ["clone-a", "clone-b"].map((id) => ({
      id: ProjectId.make(id),
      environmentId: EnvironmentId.make("offline-machine"),
      title: "print3d",
      displayName: "print3d",
      projectKey: "print3d",
      environmentLabel: "Offline machine",
      online: false,
      workspaceRoot: `/work/${id}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scripts: [],
      defaultModelSelection: null,
    })),
  };
}

describe("CommandPalette open intents", () => {
  it.each(["full", "unreachable-note", "root-filtered", "root-unfiltered"] as const)(
    "keeps upstream grouped rows, manual order, No project position and offline choices for %s",
    async (kind) => {
      setup();
      const local = EnvironmentId.make("local");
      const remote = EnvironmentId.make("remote");
      const offline = EnvironmentId.make("offline");
      const projects = [
        ["z-local", "Zulu", local],
        ["z-remote", "Zulu", remote],
        ["a-remote", "Alpha", offline],
        ["b-local", "Beta", local],
        ["old-local", "Archived", local],
      ].map(([id, title, environmentId]) => ({
        id: ProjectId.make(id!),
        environmentId: EnvironmentId.make(environmentId!),
        title: title!,
        archivedAt: title === "Archived" ? "2026-01-02T00:00:00Z" : null,
        pinnedAt: kind === "full" && title === "Zulu" ? "2026-01-02T00:00:00Z" : null,
        workspaceRoot: `/work/${id}`,
        scripts: [],
        defaultModelSelection: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        repositoryIdentity: {
          canonicalKey: `github.com/example/${title}`,
          locator: {
            source: "git-remote" as const,
            remoteName: "origin",
            remoteUrl: `https://github.com/example/${title}.git`,
          },
        },
      }));
      const groups = buildSidebarProjectSnapshots({
        projects,
        settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
        primaryEnvironmentId: local,
        resolveEnvironmentLabel: () => null,
      });
      vi.mocked(useProjects).mockReturnValue(projects);
      vi.mocked(useSortedProjectGroups).mockReturnValue(groups);
      vi.mocked(useNewThreadTargetInput).mockReturnValue({
        groups,
        environments: [
          { environmentId: local, label: "Local", online: true },
          { environmentId: remote, label: "Remote", online: true },
          { environmentId: offline, label: "Offline", online: false },
        ],
        environmentScopeKeys: [],
        selection: {
          include: kind === "root-filtered" ? ["github.com/example/Beta"] : [],
          exclude: [],
        },
        primaryEnvironmentId: local,
      });
      await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
      if (kind === "root-filtered" || kind === "root-unfiltered") {
        openCommandPalette({ query: ">New thread in" });
        await userEvent.click(page.getByRole("option", { name: "New thread in..." }));
        await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
      } else {
        openCommandPalette({
          open: "new-thread-in",
          newThreadTarget:
            kind === "full"
              ? { kind }
              : { kind, note: "No project in the current filter is reachable" },
        });
      }
      await vi.waitFor(() => {
        expect(
          page
            .getByRole("option")
            .all()
            .map((item) => item.element().textContent),
        ).toEqual(
          (kind === "full"
            ? ["Zulu", "Alpha", "No project", "Beta"]
            : kind === "root-filtered"
              ? ["Beta", "No project", "Zulu", "Alpha"]
              : ["Zulu", "No project", "Alpha", "Beta"]
          ).map((title) => expect.stringContaining(title)),
        );
      });
      await expect
        .element(page.getByRole("option", { name: /Alpha/ }))
        .not.toHaveAttribute("aria-disabled", "true");
      if (kind === "root-filtered" || kind === "root-unfiltered") {
        const updatedProjects = projects.map((project) => ({
          ...project,
          title: project.title === "Zulu" ? "Zulu renamed" : project.title,
        }));
        vi.mocked(useProjects).mockReturnValue(updatedProjects);
        vi.mocked(useSortedProjectGroups).mockReturnValue(
          buildSidebarProjectSnapshots({
            projects: updatedProjects,
            settings: {
              sidebarProjectGroupingMode: "repository",
              sidebarProjectGroupingOverrides: {},
            },
            primaryEnvironmentId: local,
            resolveEnvironmentLabel: () => null,
          }),
        );
        await userEvent.fill(page.getByPlaceholder("Search..."), "Zulu");
        await userEvent.fill(page.getByPlaceholder("Search..."), "");
        await expect.element(page.getByRole("option", { name: /Zulu renamed/ })).toBeVisible();
        await expect.element(page.getByRole("option", { name: /No project/ })).toBeVisible();
        expect(
          page
            .getByRole("option")
            .all()
            .map((item) => item.element().textContent),
        ).toEqual([
          expect.stringContaining(kind === "root-filtered" ? "Beta" : "Zulu renamed"),
          expect.stringContaining("No project"),
          expect.stringContaining(kind === "root-filtered" ? "Zulu renamed" : "Alpha"),
          expect.stringContaining(kind === "root-filtered" ? "Alpha" : "Beta"),
        ]);
      }
    },
  );

  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
  });

  it("highlights the first project when New thread in... opens from the root list", async () => {
    const environmentId = EnvironmentId.make("local");
    const project = (id: string, title: string): Project => ({
      id: ProjectId.make(id),
      environmentId,
      title,
      workspaceRoot: `/work/${id}`,
      repositoryIdentity: null,
      defaultModelSelection: null,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      scripts: [],
    });
    setup({
      projects: [project("acme", "Acme"), project("beta", "Beta"), project("gamma", "Gamma")],
    });
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({});
    await expect
      .element(page.getByPlaceholder("Search commands, projects, and threads..."))
      .toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(page.getByRole("option", { name: /^New thread in\.\.\./ }))
      .toHaveAttribute("data-highlighted");
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
    await expect.element(page.getByRole("option").first()).toHaveAttribute("data-highlighted");
    await expect.element(page.getByRole("option").nth(1)).not.toHaveAttribute("data-highlighted");
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
  });

  it("opens a searched project's latest listed thread, not a newer subagent", async () => {
    const environmentId = EnvironmentId.make("local");
    const projectId = ProjectId.make("acme");
    const parentId = ThreadId.make("parent");
    setup({
      projects: [
        {
          id: projectId,
          environmentId,
          title: "Acme",
          workspaceRoot: "/work/acme",
          repositoryIdentity: null,
          defaultModelSelection: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          scripts: [],
        },
      ],
      threads: [
        makeThreadFixture({
          id: parentId,
          environmentId,
          projectId,
          latestUserMessageAt: "2026-03-02T00:00:00.000Z",
        }),
        makeThreadFixture({
          id: ThreadId.make("subagent"),
          environmentId,
          projectId,
          updatedAt: "2026-03-03T00:00:00.000Z",
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "subagent",
          },
        }),
      ],
    });
    await using screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "Acme" });
    await page.getByRole("option", { name: /Acme/ }).first().click();

    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/local/parent"));
  });

  it.each(["Backspace", "All projects…"])(
    "widens the frozen restricted list through %s",
    async (wayBack) => {
      setup();
      await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
      openCommandPalette({ open: "new-thread-in", newThreadTarget: restrictedTarget() });
      await expect.element(page.getByText("Choose a machine for print3d")).toBeVisible();
      await expect.element(page.getByText("/work/clone-a", { exact: true })).toBeVisible();
      await expect.element(page.getByText("/work/clone-b", { exact: true })).toBeVisible();
      expect(page.getByRole("option", { name: /print3d/ }).all()).toHaveLength(0);

      useUiStateStore.getState().setSidebarProjectScopeKeys(["another-project"]);
      await expect.element(page.getByText("/work/clone-a", { exact: true })).toBeVisible();
      const input = page.getByPlaceholder("Search...");
      await userEvent.fill(input, "nonexistent-project");
      await expect
        .element(page.getByText("/work/clone-a", { exact: true }))
        .not.toBeInTheDocument();
      await expect.element(page.getByRole("option", { name: "All projects…" })).toBeVisible();
      expect(page.getByRole("option").all()).toHaveLength(1);
      await userEvent.fill(input, "");
      if (wayBack === "Backspace") await userEvent.keyboard("{Backspace}");
      else await userEvent.click(page.getByRole("option", { name: "All projects…" }));

      await expect.element(page.getByText("Projects", { exact: true })).toBeVisible();
      await expect
        .element(page.getByText("/work/clone-a", { exact: true }))
        .not.toBeInTheDocument();
      await expect.element(input).toHaveFocus();
    },
  );

  it("cancels a restricted picker with Escape and displays the unreachable note on a full picker", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
    openCommandPalette({ open: "new-thread-in", newThreadTarget: restrictedTarget() });
    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
    const modifier = navigator.platform.includes("Mac") ? "Meta" : "Control";
    await userEvent.keyboard(`{${modifier}>}n{/${modifier}}`);
    await expect.element(page.getByText("Choose a machine for print3d")).toBeVisible();
    await expect.element(page.getByText("/work/clone-a", { exact: true })).toBeVisible();
    openCommandPalette({ open: "new-thread-in", newThreadTarget: restrictedTarget() });
    await expect.element(page.getByText("Choose a machine for print3d")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();
    openCommandPalette({
      open: "new-thread-in",
      newThreadTarget: {
        kind: "unreachable-note",
        note: "No project in the current filter is reachable",
      },
    });
    await expect
      .element(page.getByText("No project in the current filter is reachable"))
      .toBeVisible();
  });
});
