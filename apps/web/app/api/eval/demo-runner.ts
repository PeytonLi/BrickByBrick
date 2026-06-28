import type { AgentEvent } from "@brickbybrick/core";
import { demoTask } from "../agent/visual-loop/demo-runner";

export async function demoRunEval(
  runId: string,
  k: number,
  emit: (e: AgentEvent) => void,
): Promise<void> {
  emit({ type: "eval_started", k });
  for (let i = 0; i < k; i++) {
    emit({
      type: "eval_task_result",
      result: {
        task: demoTask,
        base_score: 0.4,
        tuned_score: 0.8,
        base_passed_criteria: ["action-visible"],
        tuned_passed_criteria: ["no-horizontal-overflow", "action-visible"],
        winner: "tuned",
      },
    });
  }
  emit({
    type: "eval_complete",
    report: {
      runId,
      k,
      base_model: "gemma-base",
      tuned_model: "tuned",
      wins: k,
      ties: 0,
      losses: 0,
      mean_score_delta: 0.4,
      tasks: [],
    },
  });
}
