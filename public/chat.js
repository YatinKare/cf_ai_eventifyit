/**
 * LLM Chat App Frontend
 *
 * Handles the chat UI interactions and communication with the backend API.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const userFileInput = document.getElementById("upload");
const sendButton = document.getElementById("send-button");
const filePreview = document.getElementById("file-preview");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [
	{
		role: "assistant",
		content:
			"Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
	},
];
let isProcessing = false;
let previewUrls = [];

userFileInput.addEventListener("change", handleFileSelection);

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
	const message = userInput.value.trim();
	const selectedFiles = Array.from(userFileInput.files);
	const imageAttachments = selectedFiles
		.filter((file) => file.type.startsWith("image/"))
		.map((file) => ({
			type: "image",
			file,
		}));

	// Don't send empty messages
	if (message === "" || isProcessing) return;

	if (selectedFiles.length > 0) {
		console.log("Selected image files ready to send:", selectedFiles);
	}

	// Disable input while processing
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message to chat (with attachments, if any)
	addMessageToChat("user", message, imageAttachments);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	// Add message to history
	chatHistory.push({ role: "user", content: message });

	try {
		// Create new assistant response element
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className = "message assistant-message";
		assistantMessageEl.innerHTML = "<p></p>";
		chatMessages.appendChild(assistantMessageEl);
		const assistantTextEl = assistantMessageEl.querySelector("p");

		// Scroll to bottom
		chatMessages.scrollTop = chatMessages.scrollHeight;

		// Send request to API
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
			}),
		});

		// Handle errors
		if (!response.ok) {
			throw new Error("Failed to get response");
		}
		if (!response.body) {
			throw new Error("Response body is null");
		}

		// Process streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";
		let buffer = "";
		const flushAssistantText = () => {
			assistantTextEl.textContent = responseText;
			chatMessages.scrollTop = chatMessages.scrollHeight;
		};

		let sawDone = false;
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				// Process any remaining complete events in buffer
				const parsed = consumeSseEvents(buffer + "\n\n");
				for (const data of parsed.events) {
					if (data === "[DONE]") {
						break;
					}
					try {
						const jsonData = JSON.parse(data);
						// Handle both Workers AI format (response) and OpenAI format (choices[0].delta.content)
						let content = "";
						if (
							typeof jsonData.response === "string" &&
							jsonData.response.length > 0
						) {
							content = jsonData.response;
						} else if (jsonData.choices?.[0]?.delta?.content) {
							content = jsonData.choices[0].delta.content;
						}
						if (content) {
							responseText += content;
							flushAssistantText();
						}
					} catch (e) {
						console.error("Error parsing SSE data as JSON:", e, data);
					}
				}
				break;
			}

			// Decode chunk
			buffer += decoder.decode(value, { stream: true });
			const parsed = consumeSseEvents(buffer);
			buffer = parsed.buffer;
			for (const data of parsed.events) {
				if (data === "[DONE]") {
					sawDone = true;
					buffer = "";
					break;
				}
				try {
					const jsonData = JSON.parse(data);
					// Handle both Workers AI format (response) and OpenAI format (choices[0].delta.content)
					let content = "";
					if (
						typeof jsonData.response === "string" &&
						jsonData.response.length > 0
					) {
						content = jsonData.response;
					} else if (jsonData.choices?.[0]?.delta?.content) {
						content = jsonData.choices[0].delta.content;
					}
					if (content) {
						responseText += content;
						flushAssistantText();
					}
				} catch (e) {
					console.error("Error parsing SSE data as JSON:", e, data);
				}
			}
			if (sawDone) {
				break;
			}
		}

		// Add completed response to chat history
		if (responseText.length > 0) {
			chatHistory.push({ role: "assistant", content: responseText });
		}
	} catch (error) {
		console.error("Error:", error);
		addMessageToChat(
			"assistant",
			"Sorry, there was an error processing your request.",
		);
	} finally {
		// Hide typing indicator
		typingIndicator.classList.remove("visible");

		// Re-enable input
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
	}

	if (selectedFiles.length > 0) {
		clearFileSelection();
	}
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content, attachments = []) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;

	if (attachments.length > 0) {
		const attachmentsEl = document.createElement("div");
		attachmentsEl.className = "message-attachments";
		for (const attachment of attachments) {
			if (attachment.type === "image") {
				const wrapper = document.createElement("div");
				wrapper.className = "attachment-image";

				const img = document.createElement("img");
				let objectUrl;
				if (attachment.file instanceof File) {
					objectUrl = URL.createObjectURL(attachment.file);
					img.onload = () => URL.revokeObjectURL(objectUrl);
					img.src = objectUrl;
				} else if (typeof attachment.url === "string") {
					img.src = attachment.url;
				}
				img.alt = attachment.file?.name ?? "Uploaded image";

				wrapper.appendChild(img);
				attachmentsEl.appendChild(wrapper);
			}
		}
		messageEl.appendChild(attachmentsEl);
	}

	if (content) {
		const textEl = document.createElement("p");
		textEl.textContent = content;
		messageEl.appendChild(textEl);
	}
	chatMessages.appendChild(messageEl);

	// Scroll to bottom
	chatMessages.scrollTop = chatMessages.scrollHeight;
}

function consumeSseEvents(buffer) {
	let normalized = buffer.replace(/\r/g, "");
	const events = [];
	let eventEndIndex;
	while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, eventEndIndex);
		normalized = normalized.slice(eventEndIndex + 2);

		const lines = rawEvent.split("\n");
		const dataLines = [];
		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}
		if (dataLines.length === 0) continue;
		events.push(dataLines.join("\n"));
	}
	return { events, buffer: normalized };
}

function handleFileSelection() {
	clearPreview();
	const files = Array.from(userFileInput.files).filter((file) =>
		file.type.startsWith("image/"),
	);
	if (files.length === 0) {
		return;
	}

	filePreview.classList.add("visible");
	for (const file of files) {
		const previewItem = document.createElement("div");
		previewItem.className = "preview-item";

		const objectUrl = URL.createObjectURL(file);
		previewUrls.push(objectUrl);

		const img = document.createElement("img");
		img.src = objectUrl;
		img.alt = file.name;

		const caption = document.createElement("span");
		caption.textContent = file.name;

		previewItem.appendChild(img);
		previewItem.appendChild(caption);
		filePreview.appendChild(previewItem);
	}
}

function clearPreview() {
	filePreview.innerHTML = "";
	previewUrls.forEach((url) => URL.revokeObjectURL(url));
	previewUrls = [];
	filePreview.classList.remove("visible");
}

function clearFileSelection() {
	userFileInput.value = "";
	clearPreview();
}
