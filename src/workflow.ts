// src/workflow.ts - EventifyIt Cloudflare Workflow
// This replaces the Google ADK Sequential Agents

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { extractEventFromImage } from './services/vision';
import { validateAndNormalizeEvent, type ValidatedEvent } from './services/validation';
import { createGoogleCalendarEvent, checkCalendarConflicts, refreshOAuthToken } from './services/calendar';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface Env {
  AI: Ai;
  SESSION_KV: KVNamespace;
  DB: D1Database;
  IMAGES: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  DEFAULT_TIMEZONE: string;
}

interface WorkflowParams {
  imageKey: string;
  userId: string;
  timezone?: string;
  calendarId?: string;
}

interface WorkflowResult {
  success: boolean;
  event?: ValidatedEvent;
  calendarLink?: string;
  conflicts?: Array<{ title: string; start: string; end: string }>;
  error?: string;
}

// ============================================
// WORKFLOW DEFINITION
// ============================================

/**
 * EventifyIt Workflow
 * 
 * This workflow processes an uploaded image and creates a Google Calendar event.
 * It replaces the Google ADK sequential agent pipeline:
 * 
 * Original:  Data Extraction → JSON Validator → Info Validator → Calendar Agent
 * Cloudflare: Step 1         → Step 2         → Step 3        → Step 4 → Step 5
 */
export class EventifyWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<WorkflowResult> {
    const { 
      imageKey, 
      userId, 
      timezone = this.env.DEFAULT_TIMEZONE || 'America/New_York',
      calendarId = 'primary'
    } = event.payload;

    console.log(`[Workflow] Starting for user ${userId}, image ${imageKey}`);

    // ----------------------------------------
    // STEP 1: Extract Event Data from Image
    // Replaces: Data Extraction Agent
    // ----------------------------------------
    const rawEventData = await step.do('extract-event-data', async () => {
      console.log('[Step 1] Extracting event data from image...');

      // Fetch image from R2
      const imageObject = await this.env.IMAGES.get(imageKey);
      if (!imageObject) {
        throw new Error(`Image not found: ${imageKey}`);
      }

      const imageBytes = await imageObject.arrayBuffer();
      console.log(`[Step 1] Image size: ${imageBytes.byteLength} bytes`);

      // Use Vision AI to extract event details
      const extracted = await extractEventFromImage(this.env.AI, imageBytes);
      console.log('[Step 1] Extracted data:', JSON.stringify(extracted));

      return extracted;
    });

    // ----------------------------------------
    // STEP 2: Validate and Normalize Event
    // Replaces: JSON Validator Agent + Info Validator Agent
    // ----------------------------------------
    const validatedEvent = await step.do('validate-event', async () => {
      console.log('[Step 2] Validating and normalizing event...');
      
      const validated = validateAndNormalizeEvent(rawEventData, timezone);
      console.log('[Step 2] Validated event:', JSON.stringify(validated));
      
      // Cache in KV for potential recovery
      await this.env.SESSION_KV.put(
        `workflow:${event.instanceId}:event`,
        JSON.stringify(validated),
        { expirationTtl: 86400 } // 24 hours
      );
      
      return validated;
    });

    // ----------------------------------------
    // STEP 3: Check for Calendar Conflicts
    // New feature! Checks D1 for overlapping events
    // ----------------------------------------
    const conflicts = await step.do('check-conflicts', async () => {
      console.log('[Step 3] Checking for calendar conflicts...');
      
      const overlapping = await checkCalendarConflicts(
        this.env.DB,
        userId,
        validatedEvent.startDateTime,
        validatedEvent.endDateTime
      );
      
      if (overlapping.length > 0) {
        console.log(`[Step 3] Found ${overlapping.length} conflicts`);
      }
      
      return overlapping;
    });

    // ----------------------------------------
    // STEP 4: Create Google Calendar Event
    // Replaces: Google Calendar Agent
    // ----------------------------------------
    const calendarResult = await step.do('create-calendar-event', async () => {
      console.log('[Step 4] Creating Google Calendar event...');
      
      // Get OAuth token (refresh if needed)
      let token = await this.getOAuthToken(userId);
      
      if (!token) {
        throw new Error('No OAuth token found. Please authenticate with Google first.');
      }
      
      // Check if token is expired
      if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
        console.log('[Step 4] Token expired, refreshing...');
        token = await refreshOAuthToken(
          this.env.DB,
          this.env.GOOGLE_CLIENT_ID,
          this.env.GOOGLE_CLIENT_SECRET,
          userId,
          token.refreshToken
        );
      }
      
      // Create the event
      const result = await createGoogleCalendarEvent(
        token.accessToken,
        validatedEvent,
        calendarId
      );
      
      console.log('[Step 4] Event created:', result.htmlLink);
      return result;
    });

    // ----------------------------------------
    // STEP 5: Save to Database & Cleanup
    // Persist the event record and clean up R2
    // ----------------------------------------
    await step.do('save-and-cleanup', async () => {
      console.log('[Step 5] Saving event record and cleaning up...');
      
      // Save to D1
      await this.env.DB.prepare(`
        INSERT INTO events (
          id, user_id, title, start_datetime, end_datetime, 
          is_all_day, location, description, google_event_id, 
          google_calendar_link, image_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        userId,
        validatedEvent.title,
        validatedEvent.startDateTime,
        validatedEvent.endDateTime,
        validatedEvent.isAllDay ? 1 : 0,
        validatedEvent.location || null,
        validatedEvent.description || null,
        calendarResult.id,
        calendarResult.htmlLink,
        imageKey
      ).run();
      
      // Clean up the image from R2
      await this.env.IMAGES.delete(imageKey);
      
      // Clean up KV cache
      await this.env.SESSION_KV.delete(`workflow:${event.instanceId}:event`);
      
      console.log('[Step 5] Cleanup complete');
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

  // ----------------------------------------
  // HELPER METHODS
  // ----------------------------------------

  /**
   * Retrieve OAuth token from D1 database
   */
  private async getOAuthToken(userId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  } | null> {
    const result = await this.env.DB.prepare(`
      SELECT access_token_encrypted, refresh_token_encrypted, expires_at
      FROM user_tokens
      WHERE user_id = ?
    `).bind(userId).first();

    if (!result) return null;

    return {
      accessToken: result.access_token_encrypted as string,
      refreshToken: result.refresh_token_encrypted as string,
      expiresAt: result.expires_at as string,
    };
  }
}
