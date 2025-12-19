"use client";

import { AIChat } from "@/components/ai-chat";
import { Sparkles } from "lucide-react";

export default function ExplorePage() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Sparkles className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">CallScript AI Analyst</h1>
            <p className="text-sm text-zinc-500">
              Ask questions about your call data in natural language
            </p>
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-hidden">
        <AIChat />
      </div>
    </div>
  );
}
