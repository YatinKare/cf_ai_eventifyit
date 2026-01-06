// src/services/calendar.ts - Google Calendar API Integration
// Handles OAuth, conflict detection, and event creation

import { ValidatedEvent, toGoogleCalendarEvent } from './validation';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface CalendarEventResponse {
  id: string;
  htmlLink: string;
  status: string;
  summary: string;
}

export interface ConflictingEvent {
  title: string;
  start: string;
  end: string;
  googleEventId?: string;
}

// ============================================
// CALENDAR EVENT CREATION
// ============================================

/**
 * Create a new event in Google Calendar
 * 
 * @param accessToken - OAuth access token
 * @param event - Validated event data
 * @param calendarId - Calendar ID (default: "primary")
 * @returns Created event details including the htmlLink
 */
export async function createGoogleCalendarEvent(
  accessToken: string,
  event: ValidatedEvent,
  calendarId: string = 'primary'
): Promise<CalendarEventResponse> {
  const googleEvent = toGoogleCalendarEvent(event);
  
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(googleEvent),
    }
  );
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[Calendar] API Error:', response.status, errorBody);
    
    // Handle specific error cases
    if (response.status === 401) {
      throw new Error('OAUTH_EXPIRED');
    }
    
    throw new Error(`Google Calendar API error: ${response.status} - ${errorBody}`);
  }
  
  const result = await response.json() as CalendarEventResponse;
  
  return {
    id: result.id,
    htmlLink: result.htmlLink,
    status: result.status,
    summary: result.summary,
  };
}

// ============================================
// CONFLICT DETECTION
// ============================================

/**
 * Check for conflicting events in the local database
 * 
 * This checks D1 for events that overlap with the proposed time slot.
 * In production, you might also want to check Google Calendar directly.
 * 
 * @param db - D1 database binding
 * @param userId - User ID
 * @param startDateTime - Start time (ISO 8601)
 * @param endDateTime - End time (ISO 8601)
 * @returns Array of conflicting events
 */
export async function checkCalendarConflicts(
  db: D1Database,
  userId: string,
  startDateTime: string,
  endDateTime: string
): Promise<ConflictingEvent[]> {
  // Query for overlapping events
  // An event overlaps if:
  // - Its start is before our end AND its end is after our start
  const result = await db.prepare(`
    SELECT title, start_datetime, end_datetime, google_event_id
    FROM events
    WHERE user_id = ?
      AND start_datetime < ?
      AND end_datetime > ?
    ORDER BY start_datetime
    LIMIT 10
  `).bind(userId, endDateTime, startDateTime).all();
  
  if (!result.results) {
    return [];
  }
  
  return result.results.map(row => ({
    title: row.title as string,
    start: row.start_datetime as string,
    end: row.end_datetime as string,
    googleEventId: row.google_event_id as string | undefined,
  }));
}

/**
 * Check conflicts directly with Google Calendar API
 * Use this if you want real-time conflict detection
 */
export async function checkGoogleCalendarConflicts(
  accessToken: string,
  startDateTime: string,
  endDateTime: string,
  calendarId: string = 'primary'
): Promise<ConflictingEvent[]> {
  const params = new URLSearchParams({
    timeMin: startDateTime,
    timeMax: endDateTime,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '10',
  });
  
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );
  
  if (!response.ok) {
    console.error('[Calendar] Failed to fetch events for conflict check');
    return [];
  }
  
  const data = await response.json() as {
    items: Array<{
      summary: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      id: string;
    }>;
  };
  
  return data.items.map(item => ({
    title: item.summary,
    start: item.start.dateTime || item.start.date || '',
    end: item.end.dateTime || item.end.date || '',
    googleEventId: item.id,
  }));
}

// ============================================
// OAUTH TOKEN MANAGEMENT
// ============================================

/**
 * Refresh an expired OAuth token
 * 
 * @param db - D1 database binding
 * @param clientId - Google OAuth client ID
 * @param clientSecret - Google OAuth client secret
 * @param userId - User ID
 * @param refreshToken - The refresh token
 * @returns New token data
 */
export async function refreshOAuthToken(
  db: D1Database,
  clientId: string,
  clientSecret: string,
  userId: string,
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('[OAuth] Token refresh failed:', error);
    throw new Error('Failed to refresh OAuth token');
  }
  
  const tokens = await response.json() as {
    access_token: string;
    expires_in: number;
    refresh_token?: string; // Sometimes Google returns a new refresh token
  };
  
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const newRefreshToken = tokens.refresh_token || refreshToken;
  
  // Update the database with new tokens
  await db.prepare(`
    UPDATE user_tokens
    SET access_token_encrypted = ?,
        refresh_token_encrypted = ?,
        expires_at = ?
    WHERE user_id = ?
  `).bind(tokens.access_token, newRefreshToken, expiresAt, userId).run();
  
  return {
    accessToken: tokens.access_token,
    refreshToken: newRefreshToken,
    expiresAt,
  };
}

/**
 * Revoke OAuth tokens (for logout/disconnect)
 */
export async function revokeOAuthToken(
  accessToken: string
): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
    method: 'POST',
  });
}
