import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "src/db/migrations/**", "next-env.d.ts", "evals/results/**", ".superpowers/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{ group: ["next", "next/*", "react", "react-dom", "@/app/*", "@/lib/*"], message: "src/core must stay framework-free." }],
      }],
      "no-restricted-properties": ["error",
        { object: "Date", property: "now", message: "Use the injected Clock." },
        { object: "process", property: "env", message: "Read env in the app/runtime layer and pass config in." },
      ],
      "no-restricted-syntax": ["error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Use the injected Clock." },
      ],
    },
  },
  {
    files: ["src/core/clock.ts"],
    rules: { "no-restricted-properties": "off", "no-restricted-syntax": "off" },
  },
);
