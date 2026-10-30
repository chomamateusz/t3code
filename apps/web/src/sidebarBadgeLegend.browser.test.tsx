import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../test/render";
import { openCommandPalette } from "./commandPaletteBus";
import { useCommandPaletteStore } from "./commandPaletteStore";
import { CommandPalette } from "./components/CommandPalette";
import { onSidebarBadgeLegendRequest } from "./sidebarBadgeLegend";

vi.mock("./state/entities", async (original) => ({
  ...(await original<typeof import("./state/entities")>()),
  useProjects: () => [],
  useVisibleThreadShells: () => [],
}));

it("offers the project badge legend in the palette only while a project row listens", async () => {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
  openCommandPalette({ query: "badge legend" });
  await expect
    .element(page.getByPlaceholder("Search commands, projects, and threads..."))
    .toHaveFocus();
  expect(page.getByRole("option", { name: /Show project badge legend/ }).all()).toHaveLength(0);
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();

  const openLegend = vi.fn();
  using _listener = { [Symbol.dispose]: onSidebarBadgeLegendRequest(openLegend) };
  openCommandPalette({ query: "badge legend" });
  await page.getByRole("option", { name: /Show project badge legend/ }).click();
  await expect.element(page.getByTestId("command-palette")).not.toBeInTheDocument();
  await vi.waitFor(() => expect(openLegend).toHaveBeenCalledOnce());
});
