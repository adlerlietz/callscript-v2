# CallScript V2 – Active Task Scratchpad

## Last Session Summary (Dec 18, 2025)

### Completed
- **Phase 4: AI Explore Platform - COMPLETE**
  - Created `/explore` page with AI chat interface ("CallScript AI Analyst")
  - Built streaming chat with OpenRouter + GPT-4o integration
  - Custom streaming implementation (AI SDK v5 breaking changes required this)
  - Implemented 3 tool functions with org_id security:
    - `get_kpi_summary` - Aggregate metrics (revenue, profit, margin, flag rate, RPC)
    - `get_trend_data` - Time-series charts (max 90 data points)
    - `get_leaderboard` - Top performers by dimension (max 25 entries)
  - Added AI navigation link to sidebar
  - Charts render via Recharts (LineChart, BarChart)
  - Loading skeletons during tool execution

- **Database Migration 48: AI Explore RPCs**
  - Created `core.get_kpi_summary()` - JSON response with period metrics
  - Created `core.get_trend_data()` - Table-returning function for trends
  - Created `core.get_leaderboard()` - Table-returning function for rankings
  - All functions use `SECURITY DEFINER` with strict `org_id` filtering
  - Hard limits enforced (90 trend points, 25 leaderboard entries)

### Current State
- **Production:** https://callscript.io (Vercel)
- **Worker Server:** 213.192.2.124 port 40040 (RunPod)
- **Database:** Supabase (migrations up to 48)

### Key Files Created This Session
```
supabase/migrations/48_ai_explore_rpcs.sql  - RPC functions for AI tools
lib/ai/prompts.ts                           - System prompts for GPT-4o
lib/ai/tools.ts                             - Tool schemas and executors
app/api/ai/chat/route.ts                    - Streaming chat endpoint (OpenRouter)
app/(dashboard)/explore/page.tsx            - AI Explore page
components/ai-chat.tsx                      - Chat UI (custom streaming)
components/ai-chart.tsx                     - Chart renderer (KPI, Trend, Leaderboard)
components/sidebar.tsx                      - Added "AI Explore" nav link
```

### Dependencies Added
- `ai@5.0.115` - Vercel AI SDK
- `@ai-sdk/openai@2.0.88` - OpenAI/OpenRouter provider
- `@ai-sdk/react@2.0.117` - React hooks (not used, custom implementation)
- `react-markdown` - For rendering AI responses
- `zod` - Schema validation

### Environment Variables Required
```
OPENAI_API_KEY=sk-or-v1-...  # OpenRouter API key (used with OpenRouter baseURL)
```

### Technical Note: AI SDK v5 Breaking Changes
The AI SDK v5 has significant breaking changes:
- `useChat` hook API changed (no `input`, `handleInputChange`)
- Tool definitions use `inputSchema` instead of `parameters`
- Use `toTextStreamResponse()` instead of `toDataStreamResponse()`
- `maxSteps` not supported in streamText options

Solution: Custom fetch-based streaming implementation in ai-chat.tsx

## Current Objective

(No active task)

## Plan

- [ ] Step 1:
- [ ] Step 2:
- [ ] Step 3:

## Immediate Next Step

(Awaiting user instructions)
