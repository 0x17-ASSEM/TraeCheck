import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// Minimal MCP server exposing an analyze_pr tool (implementation will call GitHub)
const server = new McpServer({ name: "pr-reviewer-server", version: "0.1.0" }, { capabilities: { tools: {} } });
server.registerTool("analyze_pr", {
    title: "Analyze GitHub PR",
    description: "Analyze a GitHub Pull Request and return structured review comments.",
    inputSchema: {
        owner: z.string(),
        repo: z.string(),
        prNumber: z.number(),
    },
    outputSchema: {
        summary: z.string(),
        comments: z.array(z.object({
            path: z.string(),
            position: z.number().optional(),
            body: z.string(),
        })),
    },
}, async (args) => {
    const { owner, repo, prNumber } = args;
    // Placeholder: analysis logic will run in action.ts using Octokit
    const structuredContent = {
        summary: `Analysis placeholder for ${owner}/${repo}#${prNumber}`,
        comments: [],
    };
    return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
    };
});
const transport = new StdioServerTransport();
await server.connect(transport);
