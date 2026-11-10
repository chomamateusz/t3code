import "~/index.css";

import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useEnvironmentScope } from "../../state/session";
import { makeThreadFixture } from "../../test-fixtures";
import { SortableThreadRow } from "./SidebarThreadRow";

vi.mock("../../state/session", { spy: true });

const noop = () => undefined;

function Row(props: {
  readonly title: string;
  readonly variant?: "card" | "folder";
  readonly branch?: string;
  readonly machineLabel?: string;
}) {
  return (
    <ul style={{ width: 280 }}>
      <SortableThreadRow
        sortableId="row"
        sortableDisabled
        contextDrag={false}
        thread={makeThreadFixture({
          id: ThreadId.make("row"),
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("project"),
          title: props.title,
          branch: props.branch ?? null,
        })}
        variant={props.variant ?? "folder"}
        variantAction="settle"
        settlementSupported
        snoozeSupported
        pinningSupported={false}
        isPinned={false}
        dropVerb={null}
        dragOverPinned={false}
        sweepAction={null}
        snoozeWakeLabelText={null}
        wokeAt={null}
        isActive={false}
        isRouteThread={false}
        openPullRequestsInRightPanel={false}
        jumpLabel={null}
        currentEnvironmentId="local"
        environmentLabel={null}
        environmentMachine="laptop"
        machineLabel={props.machineLabel ?? null}
        project={null}
        projectDisplayName={null}
        providerEntryByInstanceId={new Map()}
        timestampFormat="locale"
        onThreadClick={noop}
        onThreadActivate={noop}
        onStartRename={noop}
        onRenameTitleChange={noop}
        onCommitRename={noop}
        onCancelRename={noop}
        isRenaming={false}
        renamingTitle=""
        onContextMenu={noop}
        onSettle={noop}
        onActionSweepStart={noop}
        onUnsettle={noop}
        onSnooze={noop}
        onUnsnooze={noop}
        onUnpin={noop}
        onAcknowledgeWoke={noop}
        onReadAction={noop}
      />
      <li>Outside</li>
    </ul>
  );
}

it("keeps the folder row title width when hover reveals Snooze and Settle", async () => {
  vi.mocked(useEnvironmentScope).mockReturnValue(true);
  const title = "A long thread title that has to truncate before the row actions";
  await using screen = await render(<Row title={title} />);
  const row = screen.getByTestId("sidebar-row-folder");
  await expect.element(row).toBeVisible();
  const titleElement = [...row.element().querySelectorAll<HTMLElement>("span[aria-hidden]")].find(
    (element) => element.textContent === title,
  )!;
  const restWidth = titleElement.getBoundingClientRect().width;
  expect(restWidth).toBeGreaterThan(0);

  const actions = screen.getByRole("button", { name: "Settle thread" }).element().parentElement!;
  expect(getComputedStyle(actions).opacity).toBe("0");

  await row.hover();
  await expect.poll(() => getComputedStyle(actions).opacity).toBe("1");
  expect(titleElement.getBoundingClientRect().width).toBe(restWidth);

  await userEvent.hover(screen.getByText("Outside"));
  await expect.poll(() => getComputedStyle(actions).opacity).toBe("0");
  expect(titleElement.getBoundingClientRect().width).toBe(restWidth);
});

it("shows the machine instead of the branch when the filter spans machines", async () => {
  vi.mocked(useEnvironmentScope).mockReturnValue(true);
  await using screen = await render(
    <Row title="Thread" variant="card" branch="main" machineLabel="MacBook Pro (Mateusz)" />,
  );
  await expect.element(screen.getByText("MacBook Pro (Mateusz)")).toBeVisible();
  expect(screen.getByTestId("sidebar-row-card").element().textContent).not.toContain("main");
});

it("shows the branch when the filter is one machine", async () => {
  vi.mocked(useEnvironmentScope).mockReturnValue(true);
  await using screen = await render(<Row title="Thread" variant="card" branch="main" />);
  await expect.element(screen.getByText("main")).toBeVisible();
});
