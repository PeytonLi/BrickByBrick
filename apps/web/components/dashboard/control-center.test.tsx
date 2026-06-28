import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingPair, VisualTask } from "@brickbybrick/core";

import { initialAgentState, useAgentStore } from "@/lib/store";

import { ControlCenter } from "./control-center";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({ children }: { children: ReactNode }) => (
    <div data-testid="livekit-room">{children}</div>
  ),
  RoomAudioRenderer: () => <div data-testid="room-audio-renderer" />,
  useMultibandTrackVolume: () => [],
  useTracks: () => [],
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="loss-chart">{children}</div>
  ),
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: () => <span />,
  Tooltip: () => <span />,
  XAxis: () => <span />,
  YAxis: () => <span />,
}));

const screenshot =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lF0QJwAAAABJRU5ErkJggg==";

const task: VisualTask = {
  id: "task-1",
  prompt: "Find layout collapse in the pricing matrix.",
  target_mechanism: "responsive-grid",
  criteria: [
    { id: "layout", description: "Layout holds on mobile", weight: 1 },
  ],
};

const pair: TrainingPair = {
  id: "pair-1",
  task,
  weak_code: "<Pricing />",
  strong_code: '<Pricing className="min-w-0" />',
  defect: {
    screenshot,
    dom_trace: "card overflow",
    category: "overflow",
    severity: "high",
  },
  u_score: 0.68,
};

describe("ControlCenter", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAgentStore.setState({
      ...initialAgentState,
      currentTask: task,
      weakCode: pair.weak_code,
      strongCode: pair.strong_code,
      latestDiff: "+ min-w-0",
      latestScreenshotSrc: `data:image/png;base64,${screenshot}`,
      committedPairs: [pair],
      committedCount: 1,
      targetPairs: 4,
      uScore: pair.u_score,
      training: {
        status: "training",
        instance: "h100-80gb-a",
        cost_microcents: 75,
        loss: [{ step: 1, epoch: 0.1, loss: 1.9 }],
      },
    });
  });

  it("renders the dashboard sections with mocked store state", () => {
    render(<ControlCenter />);

    expect(
      screen.getByRole("heading", { name: /Watch it work/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /What it learned/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Train it better/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("/ 4")).toBeInTheDocument();
    expect(screen.getByText("h100-80gb-a")).toBeInTheDocument();
    expect(
      screen.getByAltText("Latest visual audit screenshot"),
    ).toBeInTheDocument();
  });

  it("shows trainingRunId in the instance display when surfaced from store", () => {
    useAgentStore.setState({
      trainingRunId: "bbb-gemma-1719000000000",
    });

    render(<ControlCenter />);

    // The trainingRunId from the store is used as the default run ID
    // for training stream; the HF search input is separate.
    expect(
      screen.getByPlaceholderText(/Browse trained models/i),
    ).toBeInTheDocument();
  });

  it("shows the HF model search when no trainingRunId", () => {
    useAgentStore.setState({ trainingRunId: null });

    render(<ControlCenter />);

    expect(
      screen.getByPlaceholderText(/Browse trained models/i),
    ).toBeInTheDocument();
  });
});
