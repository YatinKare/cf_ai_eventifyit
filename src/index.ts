// src/index.ts - Main Worker Entry Point
// EventifyIt on Cloudflare

import { EventifyWorkflow } from './workflow';

// Type definitions for Cloudflare bindings
interface Env {
  AI: Ai;
  EVENTIFY_WORKFLOW: Workflow;
  SESSION_KV: KVNamespace;
  DB: D1Database;
  IMAGES: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  DEFAULT_TIMEZONE: string;
}

// Export the workflow class so Cloudflare can instantiate it
export { EventifyWorkflow };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route handling
      switch (url.pathname) {
        case '/api/process-image':
          return handleProcessImage(request, env);

        case '/api/workflow-status':
          return handleWorkflowStatus(request, env);

        case '/api/chat':
          return handleChat(request, env);

        case '/api/auth/google':
          return handleGoogleAuth(request, env);

        case '/api/auth/google/callback':
          return handleGoogleCallback(request, env);

        case '/api/accept-llama-license':
          return handleAcceptLlamaLicense(request, env);

        default:
          // Serve static assets or return 404
          return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  },
};

// ============================================
// ROUTE HANDLERS
// ============================================

/**
 * POST /api/process-image
 * Main endpoint for processing uploaded event images
 */
async function handleProcessImage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Get user ID from session cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  const sessionMatch = cookieHeader.match(/session=([^;]+)/);
  let userId = 'anonymous';

  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    const storedUserId = await env.SESSION_KV.get(`session:${sessionId}`);
    if (storedUserId) {
      userId = storedUserId;
      console.log('[Auth] User authenticated:', userId);
    } else {
      console.log('[Auth] Session not found or expired');
    }
  } else {
    console.log('[Auth] No session cookie found');
  }

  const formData = await request.formData();
  const imageFile = formData.get('image') as File | null;
  const timezone = (formData.get('timezone') as string) || env.DEFAULT_TIMEZONE;

  if (!imageFile) {
    return new Response(
      JSON.stringify({ error: 'No image file provided' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(imageFile.type)) {
    return new Response(
      JSON.stringify({ error: 'Invalid file type. Supported: JPEG, PNG, WebP, GIF' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Generate unique key and store image in R2
  const imageKey = `images/${crypto.randomUUID()}.${imageFile.type.split('/')[1]}`;
  const imageBuffer = await imageFile.arrayBuffer();

  await env.IMAGES.put(imageKey, imageBuffer, {
    httpMetadata: { contentType: imageFile.type },
  });

  // Start the workflow
  const instance = await env.EVENTIFY_WORKFLOW.create({
    params: {
      imageKey,
      userId,
      timezone,
    },
  });

  // Return streaming response using SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Stream workflow progress
  streamWorkflowProgress(instance, writer, encoder, env);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Stream workflow progress to client via SSE
 */
async function streamWorkflowProgress(
  instance: WorkflowInstance,
  writer: WritableStreamDefaultWriter,
  encoder: TextEncoder,
  env: Env
): Promise<void> {
  const sendEvent = async (data: object) => {
    try {
      const jsonString = JSON.stringify(data);
      await writer.write(encoder.encode(`data: ${jsonString}\n\n`));
    } catch (err) {
      console.error('Failed to send SSE event:', err, data);
      // Send a safe error message instead
      await writer.write(encoder.encode(`data: ${JSON.stringify({ step: 'error', error: 'Internal error' })}\n\n`));
    }
  };

  try {
    await sendEvent({ step: 'started', workflowId: instance.id });

    // Poll for workflow status
    let status = await instance.status();

    while (status.status === 'running') {
      await sendEvent({
        step: 'processing',
        message: 'Processing your image...',
        status: status.status
      });

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
      status = await instance.status();
    }

    if (status.status === 'complete') {
      console.log('Workflow complete, output:', status.output);
      await sendEvent({
        step: 'complete',
        result: status.output,
      });
    } else {
      console.error('Workflow failed:', status.error);
      // Safely handle error messages that might contain problematic characters
      const errorMessage = typeof status.error === 'string'
        ? status.error
        : JSON.stringify(status.error) || 'Workflow failed';

      await sendEvent({
        step: 'error',
        error: errorMessage,
      });
    }
  } catch (error) {
    console.error('Stream error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendEvent({ step: 'error', error: errorMessage });
  } finally {
    await writer.close();
  }
}

/**
 * GET /api/workflow-status?id=xxx
 * Check the status of a running workflow
 */
async function handleWorkflowStatus(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get('id');

  if (!workflowId) {
    return new Response(
      JSON.stringify({ error: 'Missing workflow ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const instance = await env.EVENTIFY_WORKFLOW.get(workflowId);
    const status = await instance.status();

    return new Response(
      JSON.stringify({
        id: workflowId,
        status: status.status,
        output: status.output,
        error: status.error,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Workflow not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/chat
 * Simple chat endpoint (from template) - can be used for follow-up questions
 */
async function handleChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { messages } = await request.json() as { messages: Array<{ role: string; content: string }> };

  // Use Llama 3.3 for text chat
  const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      {
        role: 'system',
        content: 'You are EventifyIt, an AI assistant that helps users add events to their Google Calendar from images. Be helpful and concise.',
      },
      ...messages,
    ],
    stream: true,
  });

  return new Response(response as ReadableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * GET /api/auth/google
 * Initiate Google OAuth flow
 */
async function handleGoogleAuth(request: Request, env: Env): Promise<Response> {
  const state = crypto.randomUUID();
  
  // Store state in KV for verification
  await env.SESSION_KV.put(`oauth:state:${state}`, 'pending', { expirationTtl: 600 });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', `${new URL(request.url).origin}/api/auth/google/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString(), 302);
}

/**
 * GET /api/auth/google/callback
 * Handle OAuth callback from Google
 */
async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Verify state
  const storedState = await env.SESSION_KV.get(`oauth:state:${state}`);
  if (!storedState) {
    return new Response('Invalid state', { status: 400 });
  }
  await env.SESSION_KV.delete(`oauth:state:${state}`);

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    console.error('Token exchange failed:', error);
    return new Response('Failed to exchange authorization code', { status: 500 });
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Validate token response
  if (!tokens.access_token || !tokens.expires_in) {
    console.error('Invalid token response:', tokens);
    return new Response('Invalid token response from Google', { status: 500 });
  }

  // Get user information from Google
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    console.error('Failed to fetch user info');
    return new Response('Failed to retrieve user information', { status: 500 });
  }

  const userInfo = await userInfoResponse.json() as {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };

  // Store tokens in D1 (in production, encrypt these!)
  const userId = userInfo.id;
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await env.DB.prepare(`
    INSERT OR REPLACE INTO user_tokens (user_id, access_token_encrypted, refresh_token_encrypted, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(userId, tokens.access_token, tokens.refresh_token || '', expiresAt).run();

  // Create a session and store user ID in KV
  const sessionId = crypto.randomUUID();
  await env.SESSION_KV.put(`session:${sessionId}`, userId, { expirationTtl: 86400 * 7 }); // 7 days

  // Redirect back to app with session cookie
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `${url.origin}/?auth=success`,
      'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 7}`,
    },
  });
}

/**
 * GET /api/accept-llama-license
 * One-time endpoint to accept Llama 3.2 license
 */
async function handleAcceptLlamaLicense(request: Request, env: Env): Promise<Response> {
  try {
    console.log('Accepting Llama 3.2 license...');
    const result = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      prompt: 'agree'
    });
    console.log('License accepted!', result);
    return new Response(
      JSON.stringify({ success: true, message: 'Llama 3.2 license accepted!' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Failed to accept license:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to accept license', details: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
