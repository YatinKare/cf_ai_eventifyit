# EventifyIt

An Image-to-Google Calendar event/task parser using an AI chat, built on Cloudflare.

This project uses the [LLM Chat Application Template](https://github.com/cloudflare/llm-chat-app-template).

<!-- dash-content-start -->

## Background

EventifyIt is an intelligent image-to-calendar tool that uses AI to automatically extract event information from images (like flyers, posters, or handwritten notes) and add them directly to your Google Calendar with a single click.

This template demonstrates how to build an AI-powered chat interface using Cloudflare Workers AI with streaming responses. It features:

- Real-time streaming of AI responses using Server-Sent Events (SSE)
- Easy customization of models and system prompts
- Support for AI Gateway integration
- Clean, responsive UI that works on mobile and desktop

## The Problem

As a university student and developer, keeping track of events, to-do lists, flyers, and physical media in Google Calendar is tedious. The current workflow requires:
- Taking pictures of physical media or carrying them until you reach your device
- Manually reading and extracting event details
- Opening Google Calendar and entering all information by hand

This process is time-consuming and prone to errors or procrastination.

## The Solution

EventifyIt streamlines this entire workflow into a simple process:
1. Upload an image of your event (flyer, poster, note, etc.)
2. AI automatically extracts all event details (title, date, time, location, description)
3. Receive a one-click calendar invite to add the event

**Value Proposition**: From anywhere in the world, add anything to your Google Calendar without manual data entry, saving time and effort so you can focus on doing things instead of planning them.

## Features

- 🔍 **OCR for event images** - Automatically extracts event details from flyers and photos using Workers AI
- 📅 **Smart date/time parsing** - Supports timezones, all-day events, and automatic duration detection
- 📆 **One-click Google Calendar** - Seamless OAuth integration with conflict detection
- 🔄 **Cloudflare infrastructure** - Built on Workers, Workflows, D1, R2, and KV for reliability
- ⚡ **Real-time SSE streaming** - Live progress updates as your event is processed
- 📱 **Mobile-friendly design** - Upload and create events from anywhere
- 🛡️ **Robust error handling** - Retry logic and timeout management for API reliability

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
├── public/                  # Static assets
│   └── index.html           # EventifyIt UI (chat interface + image upload)
├── src/
│   ├── index.ts             # Main Worker entry point with API routes
│   ├── workflow.ts          # Cloudflare Workflows orchestration
│   ├── types.ts             # TypeScript type definitions
│   └── services/
│       ├── vision.ts        # LLaVA AI vision model integration
│       ├── validation.ts    # Event data validation and normalization
│       └── calendar.ts      # Google Calendar API integration
├── wrangler.jsonc           # Cloudflare Worker configuration (D1, R2, KV, Workflows)
├── .dev.vars                # Local development secrets (gitignored)
├── tsconfig.json            # TypeScript configuration
└── README.md                # This documentation
```

## How It Works

### Architecture

EventifyIt uses Cloudflare's serverless infrastructure to process images and create calendar events:

1. **Image Upload** → User uploads an event image through the web interface
2. **R2 Storage** → Image is stored in Cloudflare R2 bucket
3. **Workflow Triggered** → Cloudflare Workflows orchestrates the processing pipeline
4. **Vision AI** → LLaVA 1.5 7B model extracts event details from the image
5. **Validation** → Event data is validated and normalized with timezone support
6. **Conflict Check** → D1 database is queried for scheduling conflicts
7. **Calendar Creation** → Google Calendar API creates the event with OAuth tokens from D1
8. **SSE Streaming** → Real-time progress updates sent to the frontend

### Key Components

**API Routes** (`src/index.ts`):
- `/api/process-image` - Handles image uploads and initiates workflows
- `/api/auth/google` - OAuth flow for Google Calendar authorization
- `/api/workflow-status` - Query workflow execution status

**Cloudflare Workflows** (`src/workflow.ts`):
- Durable execution with automatic retries
- Step-by-step processing: Extract → Validate → Check Conflicts → Create Event
- State persistence across steps

**Services**:
- `vision.ts` - OCR and event extraction using Workers AI
- `validation.ts` - Date/time parsing and event normalization
- `calendar.ts` - Google Calendar API integration with token management

**Data Storage**:
- **D1** - User tokens and event records
- **R2** - Temporary image storage
- **KV** - Session management (HttpOnly cookies)
