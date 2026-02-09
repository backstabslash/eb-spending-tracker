import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default defineConfig(
  globalIgnores(["dist/", "node_modules/"]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintConfigPrettier,
);
