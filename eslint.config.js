import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "public/data/", "node_modules/"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // An unused `_name` is how you say "this parameter exists but I don't
      // read it"; erroring on it pushes people toward throwaway assignments.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Canvas and the DOM give real answers here; `unknown` costs more than it
      // protects, provided the value is narrowed before use.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // The pipeline and tests run under Node, not a browser.
    files: ["pipeline/**/*.ts", "tests/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-console": "off",
    },
  },
  {
    // The browser harness is plain JavaScript, so nothing type-checks it — which
    // is precisely why a typo that made the file unparseable once survived to a
    // commit. `eslint:recommended` must be applied *explicitly* to these files:
    // the block above extends it only for `**/*.{ts,tsx}`, and flat config does
    // not carry a rule set over to a file its `files` pattern never matched.
    files: ["**/*.js", "**/*.mjs", "eslint.config.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node, ecmaVersion: 2024, sourceType: "module" },
    rules: {
      "no-console": "off",
    },
  },
  {
    // Vendored shadcn primitives. `buttonVariants`/`badgeVariants` are exported
    // from the same module as their component by upstream design — cn() callers
    // depend on them — so the fast-refresh rule is a permanent, deliberate
    // conflict here rather than something to "fix" and lose on the next sync.
    files: ["src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx}", "shared/**/*.ts", "vite.config.ts", "eslint.config.js"],
    rules: { "no-console": ["error", { allow: ["warn", "error"] }] },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
);
