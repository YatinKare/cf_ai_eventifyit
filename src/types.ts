/**
 * Type definitions for the LLM chat application.
 */

interface WorkflowInstance {
	id: string;
	status(): Promise<unknown>;
}

interface WorkflowBinding {
	create(): Promise<WorkflowInstance>;
}

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;

	/**
	 * Binding for static assets.
	 */
	ASSETS: { fetch: (request: Request) => Promise<Response> };

	/**
	 * Workflow binding stub (see wrangler.jsonc `workflows` config).
	 */
	"main-workflow": WorkflowBinding;

	/**
	 * Binding for R2 bucket used to store uploaded images.
	 */
	eventifyit_images: R2Bucket;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}
