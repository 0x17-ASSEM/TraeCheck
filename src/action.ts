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

    await transport.start();
    await client.connect(transport);

    console.log("Connected to MCP server");

    // Call the analyze_pr tool via MCP
    const result = await client.callTool({
      name: "analyze_pr",
      arguments: {
        owner,
        repo,
        prNumber,
        githubToken: token,
      },
    });

    // Extract structured content from MCP response
    const structuredContent = result.structuredContent as {
      summary: string;
      comments: { path: string; body: string; position?: number }[];
    };

    if (!structuredContent) {
      throw new Error("MCP server did not return structured content");
    }

    const { summary, comments } = structuredContent;

    // Post summary comment on PR
    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: summary,
      });
    } catch (error: any) {
      console.error(`Failed to post summary comment: ${error.message || error}`);
    }

    // Post review comments
    if (comments.length > 0) {
      try {
        await octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          event: "COMMENT",
          body: comments.map((c) => `**${c.path}**: ${c.body}`).join("\n\n"),
        });
      } catch (error: any) {
        console.error(`Failed to post review: ${error.message || error}`);
      }
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