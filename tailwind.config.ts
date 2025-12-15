import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
      colors: {
        background: "#09090b", // zinc-950
        surface: "#18181b",    // zinc-900
        border: "#27272a",     // zinc-800
        muted: "#71717a",      // zinc-500
      },
    },
  },
  plugins: [],
};

export default config;

