import { app } from "../../server";
import serverless from "serverless-http";
import type { Config } from "@netlify/functions";

// Wrap the Express app to handle serverless requests
export const handler = serverless(app);

// Use Netlify Functions v2 in-code configuration for routing
export const config: Config = {
  path: "/api/*",
  preferStatic: true,
};
