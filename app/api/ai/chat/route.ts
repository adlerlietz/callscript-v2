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

// Initialize OpenAI client (direct, not via OpenRouter)
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
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
      model: openai("gpt-4o"),
      system: systemPrompt,
      messages,
      tools: {
        get_kpi_summary: {
          description: toolDescriptions.get_kpi_summary,
          inputSchema: kpiSummarySchema,
          execute: async (params: z.infer<typeof kpiSummarySchema>) => {
            console.log("AI Chat: Executing get_kpi_summary with params:", params);
            try {
              const result = await executeKpiSummary(orgId, params);
              console.log("AI Chat: get_kpi_summary result:", JSON.stringify(result).substring(0, 200));
              return result;
            } catch (e) {
              console.error("AI Chat: get_kpi_summary error:", e);
              return { error: true, message: String(e) };
            }
          },
        },
        get_trend_data: {
          description: toolDescriptions.get_trend_data,
          inputSchema: trendDataSchema,
          execute: async (params: z.infer<typeof trendDataSchema>) => {
            console.log("AI Chat: Executing get_trend_data with params:", params);
            try {
              const result = await executeTrendData(orgId, params);
              console.log("AI Chat: get_trend_data result:", JSON.stringify(result).substring(0, 200));
              return result;
            } catch (e) {
              console.error("AI Chat: get_trend_data error:", e);
              return { error: true, message: String(e) };
            }
          },
        },
        get_leaderboard: {
          description: toolDescriptions.get_leaderboard,
          inputSchema: leaderboardSchema,
          execute: async (params: z.infer<typeof leaderboardSchema>) => {
            console.log("AI Chat: Executing get_leaderboard with params:", params);
            try {
              const result = await executeLeaderboard(orgId, params);
              console.log("AI Chat: get_leaderboard result:", JSON.stringify(result).substring(0, 200));
              return result;
            } catch (e) {
              console.error("AI Chat: get_leaderboard error:", e);
              return { error: true, message: String(e) };
            }
          },
        },
      },
      temperature: 0.1,
      // Enable multi-step tool calling (AI SDK v5)
      stopWhen: stepCountIs(5),
      onError: (error) => {
        console.error("AI Chat streamText error:", JSON.stringify(error, null, 2));
      },
      onStepFinish: (step) => {
        console.log("AI Chat: Step finished");
        console.log("  - Text:", step.text?.substring(0, 100) || "(none)");
        console.log("  - Tool calls:", step.toolCalls?.length || 0);
        console.log("  - Tool results:", step.toolResults?.length || 0);
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
