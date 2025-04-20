/**
 * Copyright 2025 LY Corporation
 *
 * LINE Corporation licenses this file to you under the Apache License,
 * version 2.0 (the "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License at:
 *
 *   https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as line from "@line/bot-sdk";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// Simple logger implementation
const logger = {
  info: (message: string, ...args: any[]) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
  },
  warn: (message: string, ...args: any[]) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
  },
  debug: (message: string, ...args: any[]) => {
    console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
  },
};

logger.info(`Starting LINE Bot MCP Server v${pkg.version}`);

const server = new McpServer({
  name: "line-bot",
  version: pkg.version,
});

const channelAccessToken = process.env.CHANNEL_ACCESS_TOKEN || "";
const destinationId = process.env.DESTINATION_USER_ID || "";

logger.info("Initializing LINE Messaging API client");
const messagingApiClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: channelAccessToken,
  defaultHeaders: {
    "User-Agent": `${pkg.name}/${pkg.version}`,
  },
});

// Storage for completion callbacks to signal n8n when tool execution finishes
const completionCallbacks: { [sessionId: string]: () => void } = {};

logger.debug("Registering tool: push_text_message");
server.tool(
  "push_text_message",
  "Push a simple text message to user via LINE. Use this for sending plain text messages without formatting.",
  {
    userId: z
      .string()
      .optional()
      .describe(
        "The user ID to receive a message. Defaults to DESTINATION_USER_ID.",
      ),
    message: z.object({
      type: z.literal("text").default("text"),
      text: z
        .string()
        .max(5000)
        .describe("The plain text content to send to the user."),
    }),
  },
  async ({ userId, message }, extra) => {
    logger.info(`Sending text message to user: ${userId ?? destinationId}`);
    logger.debug("Message content:", message);

    try {
      const response = await messagingApiClient.pushMessage({
        to: userId ?? destinationId,
        messages: [message as unknown as line.messagingApi.FlexMessage],
      });
      logger.info("Message sent successfully", response);

      // Signal completion to n8n
      if (extra?.sessionId && completionCallbacks[extra.sessionId]) {
        logger.debug(`Signaling completion for sessionId: ${extra.sessionId}`);
        completionCallbacks[extra.sessionId]();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    } catch (error) {
      logger.error("Failed to send message", error);

      // Signal completion even on error
      if (extra?.sessionId && completionCallbacks[extra.sessionId]) {
        logger.debug(
          `Signaling completion (error) for sessionId: ${extra.sessionId}`,
        );
        completionCallbacks[extra.sessionId]();
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
  },
);

logger.debug("Registering tool: push_flex_message");
server.tool(
  "push_flex_message",
  "Push a highly customizable flex message to user via LINE. Supports both bubble (single container) and carousel " +
    "(multiple swipeable bubbles) layouts.",
  {
    userId: z
      .string()
      .optional()
      .describe(
        "The user ID to receive a message. Defaults to DESTINATION_USER_ID.",
      ),
    message: z.object({
      type: z.literal("flex").default("flex"),
      altText: z
        .string()
        .describe(
          "Alternative text shown when flex message cannot be displayed.",
        ),
      contents: z
        .object({
          type: z
            .enum(["bubble", "carousel"])
            .describe(
              "Type of the container. 'bubble' for single container, 'carousel' for multiple swipeable bubbles.",
            ),
        })
        .passthrough()
        .describe(
          "Flexible container structure following LINE Flex Message format. For 'bubble' type, can include header, " +
            "hero, body, footer, and styles sections. For 'carousel' type, includes an array of bubble containers in " +
            "the 'contents' property.",
        ),
    }),
  },
  async ({ userId, message }, extra) => {
    logger.info(`Sending flex message to user: ${userId ?? destinationId}`);
    logger.debug("Flex message content:", message);

    try {
      const response = await messagingApiClient.pushMessage({
        to: userId ?? destinationId,
        messages: [message as unknown as line.messagingApi.FlexMessage],
      });
      logger.info("Flex message sent successfully", response);

      // Signal completion to n8n
      if (extra?.sessionId && completionCallbacks[extra.sessionId]) {
        logger.debug(`Signaling completion for sessionId: ${extra.sessionId}`);
        completionCallbacks[extra.sessionId]();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    } catch (error) {
      logger.error("Failed to send flex message", error);

      // Signal completion even on error
      if (extra?.sessionId && completionCallbacks[extra.sessionId]) {
        logger.debug(
          `Signaling completion (error) for sessionId: ${extra.sessionId}`,
        );
        completionCallbacks[extra.sessionId]();
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
  },
);

logger.debug("Registering tool: get_profile");
server.tool(
  "get_profile",
  "Get detailed profile information of a LINE user including display name, profile picture URL, status message and language.",
  {
    userId: z
      .string()
      .optional()
      .describe(
        "The ID of the user whose profile you want to retrieve. Defaults to DESTINATION_USER_ID.",
      ),
  },
  async ({ userId }, extra) => {
    const targetUserId = userId ?? destinationId;
    logger.info(`Getting profile for user: ${targetUserId}`);

    try {
      const response = await messagingApiClient.getProfile(targetUserId);
      logger.info("Got profile successfully", response);

      // Signal completion to n8n
      if (extra?.sessionId && completionCallbacks[extra.sessionId]) {
        logger.debug(`Signaling completion for sessionId: ${extra.sessionId}`);
        completionCallbacks[extra.sessionId]();
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response),
          },
        ],
      };
    } catch (error) {
      logger.error(`Failed to get profile for user: ${targetUserId}`, error);

      // Signal completion even on error
      if (extra?.sessionId && completionCallbacks[extra.sessionId]) {
        logger.debug(
          `Signaling completion (error) for sessionId: ${extra.sessionId}`,
        );
        completionCallbacks[extra.sessionId]();
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
      };
    }
  },
);

// Initialize Express application
logger.info("Initializing Express application");
const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Storage for SSE transports
const transports: { [sessionId: string]: SSEServerTransport } = {};

// Add middleware to parse request bodies as JSON
app.use(express.json());

// Health check endpoint
app.get("/health", (_: Request, res: Response) => {
  logger.debug("Health check requested");
  res.json({ status: "ok", version: pkg.version });
});

// Root path welcome page
app.get("/", (_: Request, res: Response) => {
  logger.debug("Welcome page requested");
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>LINE Bot MCP Server</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
          h1 { color: #2c3e50; }
          .info { background: #f8f9fa; padding: 20px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>LINE Bot MCP Server</h1>
        <div class="info">
          <p>This server is running the LINE Bot MCP Server and is ready to accept MCP connections.</p>
          <p>Server version: ${pkg.version}</p>
          <p>Connect to the MCP endpoint at: <code>/sse</code></p>
        </div>
      </body>
    </html>
  `);
});

// SSE endpoint - Establishes the long-lived connection
app.get("/sse", async (req: Request, res: Response) => {
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  logger.info(`New SSE connection from ${clientIp}`);

  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  logger.info(`Created new transport with sessionId: ${transport.sessionId}`);

  res.on("close", () => {
    logger.info(`Connection closed for sessionId: ${transport.sessionId}`);
    delete transports[transport.sessionId];
    delete completionCallbacks[transport.sessionId];
    logger.debug(`Active connections: ${Object.keys(transports).length}`);
  });

  try {
    await server.connect(transport);
    logger.info(`Connected MCP server to transport: ${transport.sessionId}`);
  } catch (error) {
    logger.error(
      `Failed to connect MCP server to transport: ${transport.sessionId}`,
      error,
    );
    res.status(500).end();
  }

  // Ensure the response is properly flushed
  if ("flush" in res && typeof res.flush === "function") {
    res.flush();
  }
});

// Messages endpoint - Handles tool calls
app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  logger.debug(`Message received for sessionId: ${sessionId}`);

  const transport = transports[sessionId];
  if (transport) {
    logger.debug(`Processing message for sessionId: ${sessionId}`);

    try {
      // Create a promise that will be resolved when the tool execution completes
      const toolExecutionComplete = new Promise<void>(resolve => {
        completionCallbacks[sessionId] = resolve;
      });

      // Parse the request body if it's not already parsed
      let rawBody = req.body;
      if (typeof rawBody !== "string") {
        rawBody = JSON.stringify(req.body);
      }

      // Handle the message
      await transport.handlePostMessage(req, res, rawBody);

      // Wait for the tool execution to complete before finalizing
      logger.debug(
        `Waiting for tool execution to complete for sessionId: ${sessionId}`,
      );
      await toolExecutionComplete;
      logger.debug(`Tool execution completed for sessionId: ${sessionId}`);

      // Ensure the response is properly flushed
      if ("flush" in res && typeof res.flush === "function") {
        res.flush();
      }
    } catch (error) {
      logger.error(
        `Error processing message for sessionId: ${sessionId}`,
        error,
      );

      // Clean up
      delete completionCallbacks[sessionId];

      res.status(500).send("Error processing message");
    }
  } else {
    logger.warn(`No transport found for sessionId: ${sessionId}`);
    res.status(400).send("No transport found for sessionId");
  }
});

// Start the server
app.listen(port, () => {
  logger.info(`LINE Bot MCP Server listening on port ${port}`);
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`MCP Server SSE endpoint: http://localhost:${port}/sse`);

  // Environment variable check
  if (!channelAccessToken) {
    logger.warn(
      "CHANNEL_ACCESS_TOKEN is not set. Some functionality may not work properly.",
    );
  }

  if (!destinationId) {
    logger.warn(
      "DESTINATION_USER_ID is not set. Some functionality may not work properly.",
    );
  }
});
