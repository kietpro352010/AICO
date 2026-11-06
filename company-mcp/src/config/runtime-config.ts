import * as path from "node:path";

export interface AicoConfig {
  dbPath: string;
  manifestPath: string;
  host: string;
  port: number;
  publicHost: string;
  publicPort: number;
  environment: "development" | "test" | "production";
}

const DEFAULT_DB_PATH = "D:/AI-COMPANY/data/aico.db";
const DEFAULT_MANIFEST_PATH = "D:/AI-COMPANY/company-manifest.json";

export function loadRuntimeConfig(): AicoConfig {
  return {
    dbPath: process.env.AICO_DB_PATH ? path.resolve(process.env.AICO_DB_PATH) : DEFAULT_DB_PATH,
    manifestPath: process.env.AICO_MANIFEST_PATH ? path.resolve(process.env.AICO_MANIFEST_PATH) : DEFAULT_MANIFEST_PATH,
    host: process.env.AICO_HOST || "127.0.0.1",
    port: process.env.AICO_PORT ? parseInt(process.env.AICO_PORT, 10) : 3334,
    publicHost: process.env.AICO_PUBLIC_HOST || "127.0.0.1",
    publicPort: process.env.AICO_PUBLIC_PORT ? parseInt(process.env.AICO_PUBLIC_PORT, 10) : 3335,
    environment: (process.env.NODE_ENV as AicoConfig["environment"]) || "development"
  };
}
