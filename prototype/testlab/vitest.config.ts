import { defineConfig } from "vitest/config";

// Soak-style tests play real full-city runs; give them room past vitest's 5 s default.
export default defineConfig({ test: { testTimeout: 30000 } });
