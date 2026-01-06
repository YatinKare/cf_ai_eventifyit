import {
	WorkflowEntrypoint,
	WorkflowEvent,
	WorkflowStep,
} from "cloudflare:workers";

import { validateAndNormalizeEvent, type ValidatedEvent } from './services/validation';
import type { Env } from "./types";

export type Params = Record<string, never>;

interface WorkflowResult {
  success: boolean;
  event?: ValidatedEvent;
  calendarLink?: string;
  conflicts?: Array<{ title: string; start: string; end: string }>;
  error?: string;
}

export class MyWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<WorkflowResult> {
        const {
            imageKey,
            userId,
            timezone = this.env.DEFAULT_TIMEZONE || "America/New_York",
            calendar = 'primary',
        } = event.payload;

        console.log(`[Workflow] Starting for user ${userId}, image ${imageKey}`);

        // ----------------------------------------
        // STEP 1: Extract Event Data from Image
        // Replaces: Data Extraction Agent
        // ----------------------------------------
        const rawEventData = await step.do('extract-event-data', async () => {
            console.log('[Step 1] Extracting event data from image...');
        });

        // ----------------------------------------
        // STEP 2: Validate and Normalize Event
        // Replaces: JSON Validator Agent + Info Validator Agent
        // ----------------------------------------
        const validatedEvent = await step.do('validate-event', async () => {
            console.log('[Step 2] Validating and normalizing event...');
        });

        // ----------------------------------------
        // STEP 3: Create Google Calendar Event
        // Replaces: Google Calendar Agent
        // ----------------------------------------
        const calendarResult = await step.do('create-calendar-event', async () => {
            console.log('[Step 3] Creating Google Calendar event...');
        });

        // ----------------------------------------
        // STEP 5: Save to Database & Cleanup
        // Persist the event record and clean up R2
        // ----------------------------------------
        
        await step.do('save-and-cleanup', async () => {
              console.log('[Step 5] Saving event record and cleaning up...');
        });


        // ----------------------------------------
        // RETURN RESULT
        // ----------------------------------------
        return {
          success: true,
          event: validatedEvent,
          calendarLink: calendarResult.htmlLink,
          conflicts: conflicts.length > 0 ? conflicts : undefined,
        };
      

	}
}
