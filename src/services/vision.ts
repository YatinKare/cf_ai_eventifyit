// src/services/vision.ts - Workers AI Vision Integration
// Replaces Google Gemini for image-to-text extraction

/**
 * Raw event data extracted from the image
 * This is the unvalidated output from the vision model
 */
export interface RawEventData {
  title?: string;
  start_date?: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  description?: string;
  raw_text?: string;
}

/**
 * The prompt used to extract event information from images
 * 
 * Key considerations:
 * - Be specific about the JSON format expected
 * - Handle missing fields gracefully
 * - Default to current year if not specified
 * - Support various date formats
 */
const EXTRACTION_PROMPT = `You are an expert at extracting event information from images of flyers, posters, invitations, and notes.

Analyze this image and extract any event details you can find.

Return ONLY a valid JSON object with the following structure (include only fields that are present):
{
  "title": "The name or title of the event",
  "start_date": "YYYY-MM-DD format",
  "end_date": "YYYY-MM-DD format (same as start_date if not specified)",
  "start_time": "HH:MM AM/PM format (12-hour)",
  "end_time": "HH:MM AM/PM format",
  "location": "Address or venue name",
  "description": "Any additional details about the event"
}

Important rules:
1. If the year is not specified, assume 2025
2. If end_date is not specified but start_date is, use the same date
3. If end_time is not specified but start_time is, assume 1 hour duration
4. Do NOT include any text before or after the JSON
5. If you cannot find any event information, return: {"title": "Unknown Event"}

Return ONLY the JSON object, no other text.`;

/**
 * Extract event data from an image using Workers AI Vision
 * 
 * @param ai - The Workers AI binding
 * @param imageBytes - The image as an ArrayBuffer
 * @returns Extracted event data (raw, unvalidated)
 */
export async function extractEventFromImage(
  ai: Ai,
  imageBytes: ArrayBuffer
): Promise<RawEventData> {
  // Convert ArrayBuffer to Uint8Array for the AI model
  const imageArray = Array.from(new Uint8Array(imageBytes));
  
  console.log('[Vision] Calling Llama 3.2 Vision model...');
  
  // Call the vision model
  // Using Llama 3.2 11B Vision Instruct - it's great for image understanding
  const response = await ai.run(
    '@cf/meta/llama-3.2-11b-vision-instruct',
    {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: imageArray,
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.1, // Low temperature for more consistent JSON output
    }
  );

  console.log('[Vision] Raw response:', response);

  // Extract the response text
  const responseText = typeof response === 'object' && 'response' in response
    ? (response as { response: string }).response
    : String(response);

  // Parse the JSON from the response
  return parseEventJson(responseText);
}

/**
 * Parse and clean JSON from the model's response
 * Handles various edge cases where the model might not return clean JSON
 */
function parseEventJson(responseText: string): RawEventData {
  // Try to extract JSON from the response
  let jsonString = responseText.trim();
  
  // Sometimes the model wraps JSON in markdown code blocks
  const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonString = jsonMatch[1].trim();
  }
  
  // Try to find JSON object in the response
  const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    jsonString = jsonObjectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonString);
    
    // Store the raw text for debugging
    return {
      ...parsed,
      raw_text: responseText.substring(0, 500), // Store first 500 chars
    };
  } catch (error) {
    console.error('[Vision] Failed to parse JSON:', error);
    console.error('[Vision] Response was:', responseText);
    
    // Return a minimal object if parsing fails
    return {
      title: 'Unknown Event',
      description: `Could not extract event details. Raw text: ${responseText.substring(0, 200)}`,
      raw_text: responseText,
    };
  }
}

/**
 * Alternative extraction using LLaVA (backup model)
 * Use this if Llama 3.2 Vision isn't available or fails
 */
export async function extractEventWithLlava(
  ai: Ai,
  imageBytes: ArrayBuffer
): Promise<RawEventData> {
  const imageArray = Array.from(new Uint8Array(imageBytes));
  
  const response = await ai.run(
    '@cf/llava-hf/llava-1.5-7b-hf',
    {
      image: imageArray,
      prompt: EXTRACTION_PROMPT,
      max_tokens: 1000,
    }
  );

  const responseText = typeof response === 'object' && 'response' in response
    ? (response as { response: string }).response
    : String(response);

  return parseEventJson(responseText);
}
