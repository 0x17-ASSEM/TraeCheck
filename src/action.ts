import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Octokit } from "@octokit/rest";

/**
 * GitHub Action entry: listens to PR events, runs analysis using MCP client/server,
 * and posts review comments back to the PR.
 */
async function run() {
  try {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      throw new Error("Missing GITHUB_TOKEN/GH_TOKEN in environment");
    }

    const owner = process.env.GITHUB_REPOSITORY?.split("/")[0];
    const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
    const prNumberEnv = process.env.PR_NUMBER || process.env.PR_NUMBER_INPUT;

    if (!owner || !repo || !prNumberEnv) {
      throw new Error("Missing owner/repo/prNumber from environment");
    }

    const prNumber = Number(prNumberEnv);
    if (isNaN(prNumber) || prNumber <= 0 || !Number.isInteger(prNumber)) {
      throw new Error(`Invalid PR number: ${prNumberEnv}. Must be a positive integer.`);
    }

    const octokit = new Octokit({ auth: token });

    // Connect to MCP server using stdio transport
    const client = new Client(
      { name: "pr-reviewer-client", version: "0.1.0" },
      { capabilities: {} }
    );

    const transport = new StdioClientTransport({
      command: "node",
      args: ["./dist/mcp-server.js"],
    });

    // connect() automatically calls start() on the transport
    await client.connect(transport);

    console.log("Connected to MCP server");

    // Get Gemini API key from environment
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required for AI analysis");
    }

    // Call the analyze_pr tool via MCP
    console.log("Calling analyze_pr tool...");
    const result = await client.callTool({
      name: "analyze_pr",
      arguments: {
        owner,
        repo,
        prNumber,
        githubToken: token,
        geminiApiKey,
      },
    });

    console.log("Tool call result:", JSON.stringify(result, null, 2));

    // Extract structured content from MCP response
    const structuredContent = result.structuredContent as {
      summary: string;
      comments: { path: string; body: string; position?: number }[];
    };

    if (!structuredContent) {
      console.error("Result object:", result);
      console.error("Result keys:", Object.keys(result));
      throw new Error(`MCP server did not return structured content. Result: ${JSON.stringify(result)}`);
    }

    const { summary } = structuredContent;

    // Post comprehensive AI analysis as PR comment
    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `## 🤖 AI-Powered PR Analysis\n\n${summary}`,
      });
      console.log("AI analysis posted successfully");
    } catch (error: any) {
      console.error(`Failed to post AI analysis comment: ${error.message || error}`);
      throw error;
    }

    // Clean up
    await transport.close();

    console.log("PR analysis completed.");
  } catch (err) {
    console.error("Error running action:", err);
    process.exit(1);
  }
}

run();