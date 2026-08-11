import type { Config } from "tailwindcss";

/**
 * "Evergreen Romance" design tokens (spec §3).
 * Gold is reserved for winning states and the wordmark — nothing else.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FAF7F2",
        forest: {
          DEFAULT: "#1E3A2F",
          deep: "#152B22",
          soft: "#2C4F40",
        },
        rose: {
          DEFAULT: "#D8A7B1",
          deep: "#C08D99", // hover / pressed
          wash: "#F3E4E7", // tinted backgrounds
        },
        charcoal: "#2B2B2B",
        gold: {
          DEFAULT: "#C9A96A", // winning states + wordmark ONLY
          deep: "#A9884B",
        },
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "1rem", // soft 16px everywhere
        card: "1rem",
      },
      boxShadow: {
        // the single soft elevation level — no drop-shadow soup
        lift: "0 2px 16px rgba(30, 58, 47, 0.08)",
      },
      keyframes: {
        "gentle-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "price-flash": {
          "0%": { backgroundColor: "#F3E4E7" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "gentle-pulse": "gentle-pulse 1.6s ease-in-out infinite",
        "price-flash": "price-flash 0.9s ease-out 1",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
