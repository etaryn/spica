import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/db/migrations/**",
      "next-env.d.ts",
      "evals/results/**",
      ".superpowers/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Comments say why, not where from: a spec section number goes stale when the spec moves.
      "no-warning-comments": ["error", { terms: ["§"], location: "anywhere" }],
    },
  },
  {
    // The mind runs the same in the app, the worker and the evals, so it never touches the
    // framework, the wall clock or the environment directly.
    files: ["src/mind/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "@/app/*", "@/server/*"],
              message: "src/mind must stay framework-free.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Use the injected Clock." },
        {
          object: "process",
          property: "env",
          message: "Read env in the runtime layer and pass config in.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use the injected Clock.",
        },
      ],
    },
  },
  {
    files: ["src/mind/platform/clock.ts"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
  {
    // One-way flow: her core self, her world and the code both minds share never read a user's
    // data. Process code reads user data, and the admin repos are cross-user, so both are off
    // limits too. Relative paths are matched as well as `@/` ones.
    files: [
      "src/mind/*/core/**/*.ts",
      "src/mind/*/shared/**/*.ts",
      "src/mind/world/**/*.ts",
      "src/db/repos/core/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "@/app/*", "@/server/*"],
              message: "src/mind must stay framework-free.",
            },
            {
              group: [
                "@/mind/*/user",
                "@/mind/*/user/**",
                "@/mind/process/*",
                "!@/mind/process/core",
                "@/db/repos/user/**",
                "@/db/repos/admin/**",
                "**/user",
                "**/user/**",
                "**/process/*",
                "!**/process/core",
                "**/repos/admin/**",
              ],
              message: "Core, world and shared code never read user data.",
            },
          ],
        },
      ],
    },
  },
);
