// src/services/validation.ts - Event Validation & Normalization
// Replaces Pydantic validation from the original Python project

import { z } from 'zod';
import { RawEventData } from './vision';

// ============================================
// ZOD SCHEMAS
// ============================================

/**
 * Schema for validated events
 * This ensures all required fields are present and properly formatted
 */
export const ValidatedEventSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  startDateTime: z.string().datetime({ offset: true }),
  endDateTime: z.string().datetime({ offset: true }),
  isAllDay: z.boolean(),
  location: z.string().optional(),
  description: z.string().optional(),
  timezone: z.string(),
});

export type ValidatedEvent = z.infer<typeof ValidatedEventSchema>;

/**
 * Schema for Google Calendar API event format
 */
export const GoogleCalendarEventSchema = z.object({
  summary: z.string(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string(),
  }),
  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string(),
  }),
  location: z.string().optional(),
  description: z.string().optional(),
});

export type GoogleCalendarEvent = z.infer<typeof GoogleCalendarEventSchema>;

// ============================================
// DATE/TIME PARSING UTILITIES
// ============================================

/**
 * Parse a date string into YYYY-MM-DD format
 * Handles various formats: MM/DD/YYYY, Month DD, YYYY, etc.
 */
function parseDate(dateStr: string | undefined, defaultYear: number = 2025): string | null {
  if (!dateStr) return null;
  
  const cleaned = dateStr.trim();
  
  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  
  // Try MM/DD/YYYY or M/D/YYYY
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Try "Month DD, YYYY" or "Month DD"
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const monthMatch = cleaned.toLowerCase().match(
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i
  );
  if (monthMatch) {
    const [, monthName, day, year] = monthMatch;
    const monthIndex = monthNames.indexOf(monthName.toLowerCase()) + 1;
    const fullYear = year || String(defaultYear);
    return `${fullYear}-${String(monthIndex).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Try parsing with Date object as last resort
  try {
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch {
    // Ignore parsing errors
  }
  
  return null;
}

/**
 * Parse a time string into HH:MM (24-hour) format
 * Handles: "3:00 PM", "15:00", "3pm", etc.
 */
function parseTime(timeStr: string | undefined): string | null {
  if (!timeStr) return null;
  
  const cleaned = timeStr.trim().toLowerCase();
  
  // Try 24-hour format (HH:MM)
  if (/^\d{1,2}:\d{2}$/.test(cleaned)) {
    const [hours, mins] = cleaned.split(':');
    return `${hours.padStart(2, '0')}:${mins}`;
  }
  
  // Try 12-hour format with AM/PM
  const ampmMatch = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (ampmMatch) {
    let [, hours, mins = '00', ampm] = ampmMatch;
    let hour24 = parseInt(hours, 10);
    
    if (ampm.toLowerCase() === 'pm' && hour24 !== 12) {
      hour24 += 12;
    } else if (ampm.toLowerCase() === 'am' && hour24 === 12) {
      hour24 = 0;
    }
    
    return `${String(hour24).padStart(2, '0')}:${mins}`;
  }
  
  return null;
}

/**
 * Get timezone offset string (e.g., "-05:00" for EST)
 */
function getTimezoneOffset(timezone: string): string {
  // Common timezone offsets
  const offsets: Record<string, string> = {
    'America/New_York': '-05:00',
    'America/Chicago': '-06:00',
    'America/Denver': '-07:00',
    'America/Los_Angeles': '-08:00',
    'America/Phoenix': '-07:00',
    'America/Anchorage': '-09:00',
    'Pacific/Honolulu': '-10:00',
    'UTC': '+00:00',
    'Europe/London': '+00:00',
    'Europe/Paris': '+01:00',
    'Asia/Tokyo': '+09:00',
  };
  
  return offsets[timezone] || '-05:00'; // Default to EST
}

// ============================================
// MAIN VALIDATION FUNCTION
// ============================================

/**
 * Validate and normalize raw event data into a structured format
 * 
 * @param raw - Raw event data from vision extraction
 * @param timezone - Target timezone (e.g., "America/New_York")
 * @returns Validated and normalized event
 */
export function validateAndNormalizeEvent(
  raw: RawEventData,
  timezone: string = 'America/New_York'
): ValidatedEvent {
  const currentYear = new Date().getFullYear();
  
  // Parse dates
  const startDate = parseDate(raw.start_date, currentYear) || getTodayDate();
  const endDate = parseDate(raw.end_date, currentYear) || startDate;
  
  // Parse times
  const startTime = parseTime(raw.start_time);
  const endTime = parseTime(raw.end_time);
  
  // Determine if it's an all-day event
  const isAllDay = !startTime;
  
  // Build ISO datetime strings
  const tzOffset = getTimezoneOffset(timezone);
  
  let startDateTime: string;
  let endDateTime: string;
  
  if (isAllDay) {
    // For all-day events, use just the date
    startDateTime = `${startDate}T00:00:00${tzOffset}`;
    endDateTime = `${endDate}T23:59:59${tzOffset}`;
  } else {
    // For timed events, include the time
    const start = startTime || '09:00';
    const end = endTime || addOneHour(start);
    
    startDateTime = `${startDate}T${start}:00${tzOffset}`;
    endDateTime = `${endDate}T${end}:00${tzOffset}`;
  }
  
  // Build the validated event
  const event: ValidatedEvent = {
    title: raw.title || 'Untitled Event',
    startDateTime,
    endDateTime,
    isAllDay,
    timezone,
    location: raw.location?.trim() || undefined,
    description: buildDescription(raw),
  };
  
  // Validate with Zod schema
  const result = ValidatedEventSchema.safeParse(event);
  
  if (!result.success) {
    console.error('[Validation] Schema validation failed:', result.error);
    throw new Error(`Validation failed: ${result.error.message}`);
  }
  
  return result.data;
}

/**
 * Convert validated event to Google Calendar API format
 */
export function toGoogleCalendarEvent(event: ValidatedEvent): GoogleCalendarEvent {
  if (event.isAllDay) {
    // All-day events use 'date' instead of 'dateTime'
    return {
      summary: event.title,
      start: {
        date: event.startDateTime.split('T')[0],
        timeZone: event.timezone,
      },
      end: {
        date: event.endDateTime.split('T')[0],
        timeZone: event.timezone,
      },
      location: event.location,
      description: event.description,
    };
  }
  
  return {
    summary: event.title,
    start: {
      dateTime: event.startDateTime,
      timeZone: event.timezone,
    },
    end: {
      dateTime: event.endDateTime,
      timeZone: event.timezone,
    },
    location: event.location,
    description: event.description,
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function addOneHour(time: string): string {
  const [hours, mins] = time.split(':').map(Number);
  const newHours = (hours + 1) % 24;
  return `${String(newHours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function buildDescription(raw: RawEventData): string | undefined {
  const parts: string[] = [];
  
  if (raw.description) {
    parts.push(raw.description);
  }
  
  parts.push('---');
  parts.push('Created by EventifyIt on Cloudflare');
  
  return parts.join('\n');
}
