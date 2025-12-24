"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Loader2, User, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AIChart } from "@/components/ai-charts";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: Record<string, unknown>[];
};

/**
 * Demo AI Explore Page
 * Uses /api/demo/ai/chat endpoint with demo org data.
 */
export default function DemoExplorePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Create assistant message placeholder
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", toolResults: [] },
    ]);

    try {
      const response = await fetch("/api/demo/ai/chat", {
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
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantContent = "";
      const toolResults: Record<string, unknown>[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.trim() || !line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === "text-delta" && data.textDelta) {
              assistantContent += data.textDelta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: assistantContent }
                    : m
                )
              );
            } else if (data.type === "tool-result" && data.result) {
              toolResults.push(data.result);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, toolResults: [...toolResults] }
                    : m
                )
              );
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:
                  "Sorry, I encountered an error processing your request. Please try again.",
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)]">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Sparkles className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">
              CallScript AI Analyst
            </h1>
            <p className="text-sm text-zinc-500">
              Ask questions about your call data in natural language
            </p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="p-4 rounded-full bg-zinc-800/50 mb-4">
              <Sparkles className="h-8 w-8 text-emerald-400" />
            </div>
            <h2 className="text-lg font-medium text-zinc-200 mb-2">
              Welcome to AI Explore
            </h2>
            <p className="text-sm text-zinc-500 max-w-md mb-6">
              Ask me anything about your call data. I can analyze trends, find
              patterns, and provide actionable insights.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-lg">
              {[
                "What's my revenue this month?",
                "Who are my top publishers?",
                "Show me the flag rate trend",
                "Which states have the most calls?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="px-4 py-2 text-sm text-left text-zinc-400 bg-zinc-800/50 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-3",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-emerald-400" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-4 py-3",
                    message.role === "user"
                      ? "bg-zinc-700 text-zinc-100"
                      : "bg-zinc-800/50 text-zinc-200"
                  )}
                >
                  {message.content ? (
                    <p className="text-sm whitespace-pre-wrap">
                      {message.content}
                    </p>
                  ) : message.role === "assistant" && isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  ) : null}

                  {/* Render tool results as charts */}
                  {message.toolResults && message.toolResults.length > 0 && (
                    <div className="mt-4 space-y-4">
                      {message.toolResults.map((result, i) => (
                        <AIChart key={i} data={result} />
                      ))}
                    </div>
                  )}
                </div>
                {message.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center">
                    <User className="h-4 w-4 text-zinc-300" />
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 border-t border-zinc-800 px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your call data..."
            className="flex-1 min-h-[44px] max-h-32 resize-none bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-600"
            disabled={isLoading}
          />
          <Button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="px-4"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        <p className="text-xs text-zinc-600 mt-2 text-center">
          Demo mode - Analyzing sample data from Demo Company
        </p>
      </div>
    </div>
  );
}
