"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Loader2, Sparkles, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AIChart } from "@/components/ai-chart";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: Record<string, unknown>[];
}

// Suggested queries to get started
const SUGGESTED_QUERIES = [
  "What's my revenue this month?",
  "Show me the top 10 publishers by profit",
  "What's my flag rate trend over the last 30 days?",
  "Compare revenue by state",
];

export function AIChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll when new messages come in
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Generate unique ID
  const generateId = () => Math.random().toString(36).substring(2, 15);

  // Handle sending message
  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();

      if (!input.trim() || isLoading) return;

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: input.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);
      setError(null);
      setPendingTools([]);

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("AI Chat API error:", response.status, errorText);
          throw new Error(
            response.status === 401
              ? "Please sign in to use AI Explore"
              : `Error: ${response.status} - ${errorText}`
          );
        }

        console.log("AI Chat: Response OK, starting stream...");

        // Parse streaming response
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";
        let toolResults: Record<string, unknown>[] = [];

        if (reader) {
          // Add placeholder assistant message
          const assistantId = generateId();
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", content: "", toolResults: [] },
          ]);

          // Parse UI Message stream format (newline-delimited JSON with type prefixes)
          // Format: "0:{...}" for text deltas, "1:{...}" for tool calls, etc.
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log("AI Chat: Stream complete, total length:", assistantContent.length);
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Process complete lines
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep incomplete line in buffer

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                // Parse the stream message format: "type:jsonData"
                const colonIdx = line.indexOf(":");
                if (colonIdx === -1) continue;

                const type = line.substring(0, colonIdx);
                const jsonStr = line.substring(colonIdx + 1);
                const data = JSON.parse(jsonStr);

                // Handle different message types
                // Type "g" = text delta, type "a" = tool call, type "b" = tool result
                if (type === "g" && typeof data === "string") {
                  // Text delta
                  assistantContent += data;
                } else if (data.type === "text-delta" && data.textDelta) {
                  // Alternative format
                  assistantContent += data.textDelta;
                } else if (data.type === "tool-result") {
                  // Tool result - could render charts
                  toolResults.push(data.result);
                }
              } catch (e) {
                // If not valid JSON, might be plain text fallback
                console.log("AI Chat: Non-JSON line:", line.substring(0, 50));
              }
            }

            // Update message in real-time
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx]?.role === "assistant") {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: assistantContent,
                  toolResults: [...toolResults],
                };
              }
              return updated;
            });
          }

          // If stream completed but no content, show error message
          if (!assistantContent.trim()) {
            console.error("AI Chat: Stream completed with no content");
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx]?.role === "assistant") {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: "I encountered an issue processing your request. Please try again or rephrase your question.",
                };
              }
              return updated;
            });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
        setPendingTools([]);
      }
    },
    [input, isLoading, messages]
  );

  // Handle suggested query click
  const handleSuggestionClick = (query: string) => {
    setInput(query);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Reset conversation
  const handleReset = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          // Empty state with suggestions
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="p-4 rounded-full bg-zinc-800/50 mb-4">
              <Sparkles className="h-8 w-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">
              CallScript AI Analyst
            </h2>
            <p className="text-zinc-500 max-w-md mb-6">
              Ask questions about your call data in natural language. I can analyze
              trends, compare metrics, and create visualizations.
            </p>

            {/* Suggested queries */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTED_QUERIES.map((query) => (
                <button
                  key={query}
                  onClick={() => handleSuggestionClick(query)}
                  className="p-3 text-left text-sm rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600 transition-colors text-zinc-300"
                >
                  {query}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // Messages
          <>
            <div className="flex justify-end mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                New Chat
              </Button>
            </div>

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-3",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-emerald-400" />
                  </div>
                )}

                <div
                  className={cn(
                    "max-w-[80%] rounded-lg p-3",
                    message.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-800 text-zinc-100"
                  )}
                >
                  {/* Text content with markdown */}
                  {message.content && (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  )}

                  {/* Pending tool execution - loading skeleton */}
                  {message.role === "assistant" && isLoading && pendingTools.length > 0 && (
                    <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Analyzing data...</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="h-4 bg-zinc-800 rounded animate-pulse w-3/4" />
                        <div className="h-4 bg-zinc-800 rounded animate-pulse w-1/2" />
                        <div className="h-24 bg-zinc-800 rounded animate-pulse" />
                      </div>
                    </div>
                  )}

                  {/* Tool results - render charts */}
                  {message.role === "assistant" &&
                    message.toolResults?.map((result, idx) => (
                      <div key={idx} className="mt-4">
                        <AIChart data={result} />
                      </div>
                    ))}
                </div>

                {message.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center">
                    <User className="h-4 w-4 text-zinc-300" />
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator for initial response */}
            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-zinc-800 p-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your call data..."
              rows={1}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 pr-12 text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              style={{ minHeight: "48px", maxHeight: "120px" }}
            />
          </div>
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim()}
            className="h-12 w-12 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </form>
        <p className="mt-2 text-xs text-zinc-500 text-center">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
