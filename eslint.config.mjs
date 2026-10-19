import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-*/**",
      "**/dist/**",
      "**/.worktrees/**",
      "**/.claude/**",
      "runner/**",
      "apps/site/**",
      "**/drizzle/**",
      "**/next-env.d.ts",
      "infra/**",
      "**/schemas/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
