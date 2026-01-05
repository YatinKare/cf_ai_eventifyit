/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Default system prompt
const SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages: incomingMessages, uploadedFileNames } =
			await parseChatRequestPayload(request);
		const messages = [...incomingMessages];
		if (uploadedFileNames.length > 0) {
			console.log("Received files from frontend:", uploadedFileNames);
		}

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
				stream: true,
			},
			{
				// Uncomment to use AI Gateway
				// gateway: {
				//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
				//   skipCache: false,      // Set to true to bypass cache
				//   cacheTtl: 3600,        // Cache time-to-live in seconds
				// },
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

async function parseChatRequestPayload(
	request: Request,
): Promise<{ messages: ChatMessage[]; uploadedFileNames: string[] }> {
	const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
	if (contentType.includes("multipart/form-data")) {
		const formData = await request.formData();
		const formMessages = parseMessagesPayload(formData.get("messages"));
		const uploadedFileNames: string[] = [];
		for (const [, value] of formData.entries()) {
			if (value instanceof File && value.name) {
				uploadedFileNames.push(value.name);
			}
		}
		return { messages: formMessages, uploadedFileNames };
	}

	if (contentType.includes("application/json") || contentType === "") {
		try {
			const { messages = [] } = (await request.json()) as {
				messages?: ChatMessage[];
			};
			return {
				messages: Array.isArray(messages) ? messages : [],
				uploadedFileNames: [],
			};
		} catch (error) {
			console.error("Failed to parse JSON request body:", error);
			return { messages: [], uploadedFileNames: [] };
		}
	}

	return { messages: [], uploadedFileNames: [] };
}

function parseMessagesPayload(rawValue: FormDataEntryValue | null): ChatMessage[] {
	if (typeof rawValue === "string") {
		try {
			const parsed = JSON.parse(rawValue);
			return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
		} catch (error) {
			console.error("Failed to parse messages field from form data:", error);
			return [];
		}
	}
	return [];
}
