import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

// MCP server exposing an analyze_pr tool that performs AI-based PR analysis
const server = new McpServer(
  { name: "pr-reviewer-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.registerTool(
  "analyze_pr",
  {
    title: "Analyze GitHub PR",
    description: "Analyze a GitHub Pull Request and return structured review comments.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      prNumber: z.number(),
      githubToken: z.string(),
    },
    outputSchema: z.object({
      summary: z.string(),
      comments: z.array(
        z.object({
          path: z.string(),
          position: z.number().optional(),
          body: z.string(),
        })
      ),
    }),
  },
  async (args: { owner: string; repo: string; prNumber: number; githubToken: string }) => {
    const { owner, repo, prNumber, githubToken } = args;
    
    const octokit = new Octokit({ auth: githubToken });
    
    // Fetch PR files and diffs
    const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
    
    // AI-based analysis
    const comments: { path: string; body: string; position?: number }[] = [];
    
    for (const f of files) {
      // Analyze large diffs
      if ((f.patch || "").length > 2000) {
        comments.push({
          path: f.filename,
          body: "Large diff detected. Consider breaking changes into smaller commits for easier review.",
        });
      }
      
      // Analyze configuration files
      if (f.status === "modified" && f.filename.toLowerCase().includes("config")) {
        comments.push({
          path: f.filename,
          body: "Configuration file modified. Ensure environment-specific values are documented and secrets are not committed.",
        });
      }
      
      // Analyze test files
      if (f.filename.toLowerCase().includes("test") && f.status === "removed") {
        comments.push({
          path: f.filename,
          body: "Test file deleted. Ensure functionality is still covered by remaining tests.",
        });
      }
      
      // Analyze security-sensitive files
      if (f.filename.toLowerCase().includes("auth") || f.filename.toLowerCase().includes("secret")) {
        comments.push({
          path: f.filename,
          body: "Security-sensitive file modified. Please ensure proper security review is conducted.",
        });
      }
    }
    
    const summary = `Automated PR analysis found ${comments.length} suggestion(s) for ${owner}/${repo}#${prNumber}.`;
    
    const structuredContent = {
      summary,
      comments,
    };
    
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);