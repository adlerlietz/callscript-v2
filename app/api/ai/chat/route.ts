import { NextRequest } from "next/server";
import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { getAuthContext } from "@/lib/supabase/auth";
import {
  kpiSummarySchema,
  trendDataSchema,
  leaderboardSchema,
  toolDescriptions,
  executeKpiSummary,
  executeTrendData,
  executeLeaderboard,
} from "@/lib/ai/tools";
import { buildSystemPrompt } from "@/lib/ai/prompts";

// Initialize OpenRouter-compatible client
// Note: Using hardcoded key temporarily - env var not loading correctly
const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: "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",
});

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ai/chat
 * Streaming AI chat endpoint for the Explore platform.
 * Uses OpenAI GPT-4o with function calling for data queries.
 */
export async function POST(req: NextRequest) {
  // Authenticate user and get org context
  const auth = await getAuthContext();
  if (!auth) {
    console.error("AI Chat: Unauthorized - no auth context");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { messages } = await req.json();
    console.log("AI Chat: Received request with", messages?.length, "messages");

    if (!messages || !Array.isArray(messages)) {
      return new Response("Invalid request: messages required", { status: 400 });
    }

    const orgId = auth.orgId;
    console.log("AI Chat: Processing for org", orgId);

    if (!orgId) {
      console.error("AI Chat: No orgId found in auth context");
      return new Response("Organization not found", { status: 400 });
    }

    // Build dynamic system prompt with current date
    const systemPrompt = buildSystemPrompt();

    // Stream response with tool calling via OpenRouter
    // Use .chat() method for OpenRouter compatibility (not .responses())
    const result = streamText({
      model: openrouter.chat("openai/gpt-4o"),
      system: systemPrompt,
      messages,
      tools: {
        get_kpi_summary: {
          description: toolDescriptions.get_kpi_summary,
          inputSchema: kpiSummarySchema,
          execute: async (params: z.infer<typeof kpiSummarySchema>) => {
            console.log("AI Chat: Executing get_kpi_summary with params:", params);
            return executeKpiSummary(orgId, params);
          },
        },
        get_trend_data: {
          description: toolDescriptions.get_trend_data,
          inputSchema: trendDataSchema,
          execute: async (params: z.infer<typeof trendDataSchema>) => {
            console.log("AI Chat: Executing get_trend_data with params:", params);
            return executeTrendData(orgId, params);
          },
        },
        get_leaderboard: {
          description: toolDescriptions.get_leaderboard,
          inputSchema: leaderboardSchema,
          execute: async (params: z.infer<typeof leaderboardSchema>) => {
            console.log("AI Chat: Executing get_leaderboard with params:", params);
            return executeLeaderboard(orgId, params);
          },
        },
      },
      temperature: 0.1,
      // Enable multi-step tool calling (AI SDK v5)
      stopWhen: stepCountIs(5),
      onError: (error) => {
        console.error("AI Chat streamText error:", error);
      },
      onStepFinish: (step) => {
        console.log("AI Chat: Step finished, tools called:", step.toolCalls?.length || 0);
      },
    });

    console.log("AI Chat: Streaming response...");
    return result.toTextStreamResponse();
  } catch (error) {
    console.error("AI Chat Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
