import { NextRequest } from "next/server";
import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  kpiSummarySchema,
  trendDataSchema,
  leaderboardSchema,
  breakdownAnalysisSchema,
  forecastSchema,
  negotiationSchema,
  simulationSchema,
  callSamplesSchema,
  toolDescriptions,
  executeKpiSummary,
  executeTrendData,
  executeLeaderboard,
  executeBreakdownAnalysis,
  executeForecast,
  executeNegotiationAnalysis,
  executeSimulation,
  executeCallSamples,
} from "@/lib/ai/tools/index";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { DEMO_ORG_ID } from "@/lib/demo/constants";
import { z } from "zod";

// Initialize OpenAI client
const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Factory function to create tool handlers with consistent logging and error handling
 */
function createToolHandler<TSchema extends z.ZodType>(
  toolName: string,
  schema: TSchema,
  executor: (orgId: string, params: z.infer<TSchema>) => Promise<unknown>,
  orgId: string
) {
  return {
    description: toolDescriptions[toolName as keyof typeof toolDescriptions],
    inputSchema: schema,
    execute: async (params: z.infer<TSchema>) => {
      console.log(`Demo AI Chat: Executing ${toolName}`);
      try {
        const result = await executor(orgId, params);
        console.log(`Demo AI Chat: ${toolName} completed`);
        return result;
      } catch (e) {
        console.error(`Demo AI Chat: ${toolName} error:`, e);
        return { error: true, message: String(e) };
      }
    },
  };
}

/**
 * POST /api/demo/ai/chat
 * Streaming AI chat endpoint for the demo platform.
 * No authentication required - uses hardcoded demo org.
 */
export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    console.log(
      "Demo AI Chat: Received request with",
      messages?.length,
      "messages"
    );

    if (!messages || !Array.isArray(messages)) {
      return new Response("Invalid request: messages required", {
        status: 400,
      });
    }

    // Use demo org ID instead of auth context
    const orgId = DEMO_ORG_ID;
    console.log("Demo AI Chat: Processing for demo org", orgId);

    // Build dynamic system prompt with current date
    const systemPrompt = buildSystemPrompt();

    // Add demo context to system prompt
    const demoSystemPrompt =
      systemPrompt +
      `

IMPORTANT: This is a DEMO environment. You are analyzing sample data from "Demo Company".
The data is realistic but synthetic - use it to showcase platform capabilities.
When asked about the company or data source, acknowledge this is demo data.`;

    // Stream response with tool calling
    const result = streamText({
      model: openai("gpt-4o"),
      system: demoSystemPrompt,
      messages,
      tools: {
        get_kpi_summary: createToolHandler(
          "get_kpi_summary",
          kpiSummarySchema,
          executeKpiSummary,
          orgId
        ),
        get_trend_data: createToolHandler(
          "get_trend_data",
          trendDataSchema,
          executeTrendData,
          orgId
        ),
        get_leaderboard: createToolHandler(
          "get_leaderboard",
          leaderboardSchema,
          executeLeaderboard,
          orgId
        ),
        analyze_breakdown: createToolHandler(
          "analyze_breakdown",
          breakdownAnalysisSchema,
          executeBreakdownAnalysis,
          orgId
        ),
        generate_forecast: createToolHandler(
          "generate_forecast",
          forecastSchema,
          executeForecast,
          orgId
        ),
        analyze_negotiation_opportunities: createToolHandler(
          "analyze_negotiation_opportunities",
          negotiationSchema,
          executeNegotiationAnalysis,
          orgId
        ),
        simulate_financial_change: createToolHandler(
          "simulate_financial_change",
          simulationSchema,
          executeSimulation,
          orgId
        ),
        get_call_samples: createToolHandler(
          "get_call_samples",
          callSamplesSchema,
          executeCallSamples,
          orgId
        ),
      },
      temperature: 0.1,
      // Enable multi-step tool calling
      stopWhen: stepCountIs(5),
      onError: (error) => {
        console.error(
          "Demo AI Chat streamText error:",
          JSON.stringify(error, null, 2)
        );
      },
      onStepFinish: (step) => {
        console.log("Demo AI Chat: Step finished");
        console.log("  - Text:", step.text?.substring(0, 100) || "(none)");
        console.log("  - Tool calls:", step.toolCalls?.length || 0);
        console.log("  - Tool results:", step.toolResults?.length || 0);
      },
    });

    console.log("Demo AI Chat: Streaming response...");

    // Use UI Message stream for proper tool calling support
    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("Demo AI Chat Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
