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

  console.log('[Vision] Calling LLaVA 1.5 7B model...');
  console.log('[Vision] Image array length:', imageArray.length);
  console.log('[Vision] Preparing model request...');

  try {
    // Call the vision model
    // Using LLaVA 1.5 7B - great for image understanding and extraction
    const response = await ai.run(
      '@cf/llava-hf/llava-1.5-7b-hf',
      {
        image: imageArray,  // Array of numbers (0-255)
        prompt: EXTRACTION_PROMPT,
        max_tokens: 1000,
        temperature: 0.1,  // Low temperature for more consistent JSON output
      }
    );

    console.log('[Vision] LLaVA model call completed successfully');
    console.log('[Vision] Response type:', typeof response);
    console.log('[Vision] Raw response:', response);

    // Extract the response text
    console.log('[Vision] Extracting response text...');
    const responseText = typeof response === 'object' && 'description' in response
      ? (response as { description: string }).description
      : String(response);

    console.log('[Vision] Response text:', responseText.substring(0, 200));

    // Parse the JSON from the response
    console.log('[Vision] Parsing JSON...');
    const result = parseEventJson(responseText);
    console.log('[Vision] Parsed result:', JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('[Vision] Error calling vision model:', error);
    console.error('[Vision] Error details:', JSON.stringify(error, null, 2));
    throw new Error(`Vision model failed: ${error}`);
  }
}

/**
 * Parse and clean JSON from the model's response
 * Handles various edge cases where the model might not return clean JSON
 */
function parseEventJson(responseText: string): RawEventData {
  console.log('[Parse] Starting JSON parse, input length:', responseText.length);

  // Try to extract JSON from the response
  let jsonString = responseText.trim();

  // Clean up escaped underscores (\_) which are not valid JSON
  jsonString = jsonString.replace(/\\_/g, '_');

  // Sometimes the model wraps JSON in markdown code blocks
  const jsonMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    console.log('[Parse] Found JSON in markdown code block');
    jsonString = jsonMatch[1].trim();
  }

  // Try to find JSON object in the response
  const jsonObjectMatch = jsonString.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    console.log('[Parse] Extracted JSON object from response');
    jsonString = jsonObjectMatch[0];
  }

  console.log('[Parse] Attempting to parse:', jsonString.substring(0, 200));

  try {
    const parsed = JSON.parse(jsonString);
    console.log('[Parse] Successfully parsed JSON');

    // Store the raw text for debugging
    return {
      ...parsed,
      raw_text: responseText.substring(0, 500), // Store first 500 chars
    };
  } catch (error) {
    console.error('[Parse] Failed to parse JSON:', error);
    console.error('[Parse] Response was:', responseText);

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
