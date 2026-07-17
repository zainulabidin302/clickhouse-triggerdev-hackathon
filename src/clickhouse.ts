import { createClient } from "@clickhouse/client";

/**
 * Shared ClickHouse client.
 *
 * Reads config from the environment. In Trigger.dev these come from the
 * project's env vars (set via the dashboard or `trigger.dev` CLI), not from
 * .env — a deployed task cannot see this repo's .env file.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in .env locally, and in the Trigger.dev ` +
        `dashboard for deployed tasks.`,
    );
  }
  return value;
}

export function clickhouse() {
  return createClient({
    url: required("CLICKHOUSE_URL"),
    username: required("CLICKHOUSE_USER"),
    password: required("CLICKHOUSE_PASSWORD"),
    database: process.env.CLICKHOUSE_DATABASE ?? "default",
  });
}

/** Run a query and return typed rows. */
export async function query<T>(sql: string): Promise<T[]> {
  const client = clickhouse();
  try {
    const result = await client.query({ query: sql, format: "JSONEachRow" });
    return await result.json<T>();
  } finally {
    await client.close();
  }
}
