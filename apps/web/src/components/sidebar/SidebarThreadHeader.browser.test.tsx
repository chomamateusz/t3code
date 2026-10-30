import { useRef } from "react";
import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { openCommandPalette } from "../../commandPaletteBus";
import { useCommandPaletteStore } from "../../commandPaletteStore";
import { useUiStateStore } from "../../uiStateStore";
import { CommandPalette } from "../CommandPalette";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarThreadHeader } from "./SidebarThreadHeader";

function Header({
  hasProjects,
  newThreadInCurrentProject = false,
}: {
  hasProjects: boolean;
  newThreadInCurrentProject?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <SidebarProvider>
      <SidebarThreadHeader
        hasProjects={hasProjects}
        onNewProject={() => openCommandPalette({ open: "add-project" })}
        onNewThread={() => openCommandPalette({ open: "new-thread-in" })}
        newThreadInCurrentProject={newThreadInCurrentProject}
        newThreadShortcutLabel={null}
        newThreadInProjectShortcutLabel={null}
        searchInputRef={inputRef}
        searchQuery=""
        onSearchQueryChange={() => undefined}
        onSearchKeyDown={() => undefined}
        isSearching={false}
        searchResultCount={0}
        activeSearchResultIndex={0}
        onClearSearch={() => undefined}
      />
      <button type="button">After header</button>
      <CommandPalette>{null}</CommandPalette>
    </SidebarProvider>
  );
}

it("skips New thread with no projects, then allows keyboard creation when projects arrive", async () => {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  useUiStateStore.setState(useUiStateStore.getInitialState(), true);
  await using screen = await render(<Header hasProjects={false} />);
  await userEvent.click(screen.getByRole("combobox", { name: "Search threads" }));
  await userEvent.tab();
  await expect.element(screen.getByRole("button", { name: "After header" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();

  await screen.rerender(<Header hasProjects />);
  await userEvent.click(screen.getByRole("combobox", { name: "Search threads" }));
  await userEvent.tab();
  await userEvent.tab();
  await expect
    .element(screen.getByRole("button", { name: "New thread", exact: true }))
    .toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
});

it.each([false, true])(
  "only hints at clicks that differ from the default when current-project routing is %s",
  async (newThreadInCurrentProject) => {
    useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
    useUiStateStore.setState(useUiStateStore.getInitialState(), true);
    await using screen = await render(
      <Header hasProjects newThreadInCurrentProject={newThreadInCurrentProject} />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Search threads" }));
    await userEvent.tab();
    await userEvent.tab();
    const tooltip = page.getByText(/^New thread/).first();
    await expect.element(tooltip).toBeVisible();
    if (newThreadInCurrentProject) {
      await expect.element(page.getByText(/⌥-click: all projects/)).toBeVisible();
      await expect.element(page.getByText(/Shift\+click/)).not.toBeInTheDocument();
    } else {
      await expect.element(page.getByText(/Shift\+click/)).toBeVisible();
      await expect.element(page.getByText(/⌥-click: all projects/)).not.toBeInTheDocument();
    }
  },
);
