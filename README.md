# LLM Chat Application Template

A simple, ready-to-deploy chat application template powered by Cloudflare Workers AI. This template provides a clean starting point for building AI chat applications with streaming responses.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/llm-chat-app-template)

<!-- dash-content-start -->

## Demo

This template demonstrates how to build an AI-powered chat interface using Cloudflare Workers AI with streaming responses. It features:

- Real-time streaming of AI responses using Server-Sent Events (SSE)
- Easy customization of models and system prompts
- Support for AI Gateway integration
- Clean, responsive UI that works on mobile and desktop

## Features

- 💬 Simple and responsive chat interface
- ⚡ Server-Sent Events (SSE) for streaming responses
- 🧠 Powered by Cloudflare Workers AI LLMs
- 🛠️ Built with TypeScript and Cloudflare Workers
- 📱 Mobile-friendly design
- 🔄 Maintains chat history on the client
- 🔎 Built-in Observability logging
<!-- dash-content-end -->

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Cloudflare account with Workers AI access
- A Google Cloud account for OAuth and Calendar API access

### Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/cloudflare/templates.git
   cd templates/llm-chat-app
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Generate Worker type definitions:
   ```bash
   npm run cf-typegen
   ```

### Cloudflare Resources Setup

Create the required Cloudflare resources:

1. **Create KV Namespace** (for session storage):
   ```bash
   npx wrangler kv:namespace create SESSION_KV
   ```
   Copy the ID and update `wrangler.jsonc` → `kv_namespaces[0].id`

2. **Create D1 Database** (for storing tokens and events):
   ```bash
   npx wrangler d1 create eventifyit-db
   ```
   Copy the database ID and update `wrangler.jsonc` → `d1_databases[0].database_id`

3. **Create R2 Bucket** (for image storage):
   ```bash
   npx wrangler r2 bucket create eventifyit-images
   ```

4. **Update Compatibility Date** in `wrangler.jsonc`:
   - Ensure `compatibility_date` is set to `"2024-04-03"` or later (required for Workflows RPC)

### Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - **Google Calendar API**
   - **People API** (for user info)

4. Configure OAuth Consent Screen:
   - Navigate to **APIs & Services** → **OAuth consent screen**
   - Choose **External** user type
   - Fill in app name, user support email, and developer email
   - Add these scopes:
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/userinfo.profile`
     - `https://www.googleapis.com/auth/userinfo.email`

5. Create OAuth 2.0 Credentials:
   - Go to **APIs & Services** → **Credentials**
   - Click **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Add **Authorized redirect URI**:
     - For local dev: `http://localhost:8787/api/auth/google/callback`
     - For production: `https://your-worker.workers.dev/api/auth/google/callback`
   - Copy the **Client ID** and **Client Secret**

6. Update `wrangler.jsonc`:
   - Set `vars.GOOGLE_CLIENT_ID` to your Client ID

### Local Development Secrets

Create a `.dev.vars` file in the project root:

```bash
# .dev.vars (already in .gitignore)
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

Replace `your_client_secret_here` with the Client Secret from Google Cloud Console.

### Database Setup

Initialize the D1 database schema (if schema.sql exists):

```bash
npx wrangler d1 execute eventifyit-db --file=./schema.sql
```

### Development

Start a local development server:

```bash
npm run dev
```

This will start a local server at http://localhost:8787.

**First-time setup:**
1. Visit http://localhost:8787
2. Click "Sign in with Google"
3. Complete the OAuth flow
4. You're ready to upload event images!

Note: Using Workers AI accesses your Cloudflare account even during local development, which will incur usage charges.

### Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

**Important:** Don't forget to set production secrets:

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### Monitor

View real-time logs associated with any deployed Worker:

```bash
npm wrangler tail
```

## Project Structure

```
/
├── public/             # Static assets
│   ├── index.html      # Chat UI HTML
│   └── chat.js         # Chat UI frontend script
├── src/
│   ├── index.ts        # Main Worker entry point
│   └── types.ts        # TypeScript type definitions
├── test/               # Test files
├── wrangler.jsonc      # Cloudflare Worker configuration
├── tsconfig.json       # TypeScript configuration
└── README.md           # This documentation
```

## How It Works

### Backend

The backend is built with Cloudflare Workers and uses the Workers AI platform to generate responses. The main components are:

1. **API Endpoint** (`/api/chat`): Accepts POST requests with chat messages and streams responses
2. **Streaming**: Uses Server-Sent Events (SSE) for real-time streaming of AI responses
3. **Workers AI Binding**: Connects to Cloudflare's AI service via the Workers AI binding

### Frontend

The frontend is a simple HTML/CSS/JavaScript application that:

1. Presents a chat interface
2. Sends user messages to the API
3. Processes streaming responses in real-time
4. Maintains chat history on the client side

## Customization

### Changing the Model

To use a different AI model, update the `MODEL_ID` constant in `src/index.ts`. You can find available models in the [Cloudflare Workers AI documentation](https://developers.cloudflare.com/workers-ai/models/).

### Using AI Gateway

The template includes commented code for AI Gateway integration, which provides additional capabilities like rate limiting, caching, and analytics.

To enable AI Gateway:

1. [Create an AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway) in your Cloudflare dashboard
2. Uncomment the gateway configuration in `src/index.ts`
3. Replace `YOUR_GATEWAY_ID` with your actual AI Gateway ID
4. Configure other gateway options as needed:
   - `skipCache`: Set to `true` to bypass gateway caching
   - `cacheTtl`: Set the cache time-to-live in seconds

Learn more about [AI Gateway](https://developers.cloudflare.com/ai-gateway/).

### Modifying the System Prompt

The default system prompt can be changed by updating the `SYSTEM_PROMPT` constant in `src/index.ts`.

### Styling

The UI styling is contained in the `<style>` section of `public/index.html`. You can modify the CSS variables at the top to quickly change the color scheme.

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)
