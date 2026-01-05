import {
	WorkflowEntrypoint,
	WorkflowEvent,
	WorkflowStep,
} from "cloudflare:workers";
import type { Env } from "./types";

export type Params = Record<string, never>;

export class MyWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		await step.do("my first step", async () => {
			console.log("[DEBUG] THIS IS THE FIRST WORKFLOW STEP");
		});

		await step.do("my second step", async () => {
			console.log("[DEBUG] THIS IS THE SECOND WORKFLOW STEP");
		});
	}
}
