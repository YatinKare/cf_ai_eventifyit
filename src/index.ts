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

export { MyWorkflow } from "./workflow";

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
		const { messages: incomingMessages, uploadedFiles } =
			await parseChatRequestPayload(request);
		const messages = [...incomingMessages];
		const storedFiles = await storeUploadedImages(env, uploadedFiles);
		if (storedFiles.length > 0) {
			console.log(
				"Stored files in R2:",
				storedFiles.map(
					(file) => `${file.originalName} -> ${file.objectKey}`,
				),
			);
		}

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const workflowInstance = await env["main-workflow"].create();
		const workflowStatus = await workflowInstance.status();

		return Response.json({
			id: workflowInstance.id,
			details: workflowStatus,
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
): Promise<{ messages: ChatMessage[]; uploadedFiles: File[] }> {
	const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
	if (contentType.includes("multipart/form-data")) {
		const formData = await request.formData();
		const formMessages = parseMessagesPayload(formData.get("messages"));
		const uploadedFiles: File[] = [];
		for (const [, value] of formData.entries()) {
			if (value instanceof File && value.name) {
				uploadedFiles.push(value);
			}
		}
		return { messages: formMessages, uploadedFiles };
	}

	if (contentType.includes("application/json") || contentType === "") {
		try {
			const { messages = [] } = (await request.json()) as {
				messages?: ChatMessage[];
			};
			return {
				messages: Array.isArray(messages) ? messages : [],
				uploadedFiles: [],
			};
		} catch (error) {
			console.error("Failed to parse JSON request body:", error);
			return { messages: [], uploadedFiles: [] };
		}
	}

	return { messages: [], uploadedFiles: [] };
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

async function storeUploadedImages(
	env: Env,
	files: File[],
): Promise<{ originalName: string; objectKey: string }[]> {
	const bucket = env.eventifyit_images;
	if (!bucket || typeof bucket.put !== "function") {
		console.warn(
			"eventifyit_images binding is not configured; skipping upload of",
			files.length,
			"file(s).",
		);
		return [];
	}

	const storedFiles: { originalName: string; objectKey: string }[] = [];
	for (const file of files) {
		if (!file.type.startsWith("image/")) {
			console.warn(`Skipping non-image upload: ${file.name || "unknown"}`);
			continue;
		}

		const [, extension = "bin"] = file.type.split("/");
		const objectKey = `images/${crypto.randomUUID()}.${extension}`;
		const imageBuffer = await file.arrayBuffer();

		await bucket.put(objectKey, imageBuffer, {
			httpMetadata: { contentType: file.type },
		});

		storedFiles.push({ originalName: file.name, objectKey });
	}
	return storedFiles;
}
