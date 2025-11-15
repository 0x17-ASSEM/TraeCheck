import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

// MCP server exposing an analyze_pr tool that performs AI-based PR analysis using Gemini
const server = new McpServer(
  { name: "pr-reviewer-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.registerTool(
  "analyze_pr",
  {
    title: "Analyze GitHub PR",
    description: "Analyze a GitHub Pull Request using AI (Gemini) and return comprehensive review comments.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      prNumber: z.number(),
      githubToken: z.string(),
      geminiApiKey: z.string().optional(),
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
  async (args: { owner: string; repo: string; prNumber: number; githubToken: string; geminiApiKey?: string }) => {
    try {
      const { owner, repo, prNumber, githubToken, geminiApiKey } = args;
      
      const octokit = new Octokit({ auth: githubToken });
      
      // Fetch comprehensive PR data
      const [prData, files] = await Promise.all([
        octokit.pulls.get({ owner, repo, pull_number: prNumber }),
        octokit.pulls.listFiles({ owner, repo, pull_number: prNumber }),
      ]);
      
      const pr = prData.data;
    
    // Build comprehensive PR context for AI analysis
    let prContext = `# Pull Request Analysis Request\n\n`;
    prContext += `## PR Information\n`;
    prContext += `- **Title**: ${pr.title}\n`;
    prContext += `- **Number**: #${prNumber}\n`;
    prContext += `- **Author**: ${pr.user?.login}\n`;
    prContext += `- **State**: ${pr.state}\n`;
    prContext += `- **Base Branch**: ${pr.base.ref} ← **Head Branch**: ${pr.head.ref}\n\n`;
    
    if (pr.body) {
      prContext += `## PR Description\n${pr.body}\n\n`;
    }
    
    prContext += `## Files Changed (${files.data.length} files)\n\n`;
    
    // Include file changes with diffs (truncate very large patches)
    for (const file of files.data) {
      prContext += `### ${file.filename} (${file.status})\n`;
      prContext += `- **Additions**: +${file.additions}\n`;
      prContext += `- **Deletions**: -${file.deletions}\n`;
      prContext += `- **Changes**: ${file.changes} lines\n`;
      
      if (file.patch) {
        // Truncate very large patches to avoid token limits
        const patch = file.patch.length > 5000 
          ? file.patch.substring(0, 5000) + "\n... (truncated)"
          : file.patch;
        prContext += `\n\`\`\`diff\n${patch}\n\`\`\`\n`;
      }
      prContext += `\n`;
    }
    
    // Use Gemini AI for analysis
    const apiKey = geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key is required. Set GEMINI_API_KEY environment variable or pass geminiApiKey parameter.");
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    // Use Gemini 2.5 Flash - try the most common model names
    // Common names: "gemini-2.0-flash-exp", "gemini-2.5-flash", "gemini-2.0-flash"
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `You are an expert code reviewer. Analyze the following Pull Request and provide a comprehensive review.

${prContext}

Please provide:
1. **Overall Assessment**: A summary of what this PR does and its impact
2. **Code Quality**: Review code style, best practices, potential bugs, and improvements
3. **Security**: Identify any security concerns or vulnerabilities
4. **Performance**: Note any performance implications
5. **Testing**: Assess test coverage and suggest improvements
6. **Documentation**: Check if changes are properly documented
7. **Specific Issues**: List specific issues found in the code with file paths and line numbers if possible
8. **Suggestions**: Provide actionable suggestions for improvement

Format your response as a comprehensive markdown document that will be posted as a PR comment. Be thorough, constructive, and professional.`;
    
      console.log("Calling Gemini API...");
      const result = await model.generateContent(prompt);
      const aiAnalysis = result.response.text();
      console.log("Gemini analysis received, length:", aiAnalysis.length);
      
      // Parse AI response to extract structured comments (if possible)
      // For now, we'll use the full analysis as the summary
      const comments: { path: string; body: string; position?: number }[] = [];
      
      // Try to extract file-specific comments from AI response
      const fileCommentRegex = /(?:^|\n)(?:###?|File:|File\s+path:)\s*([^\n]+)\s*\n([\s\S]*?)(?=\n(?:###?|File:|File\s+path:)|$)/gi;
      let match;
      while ((match = fileCommentRegex.exec(aiAnalysis)) !== null) {
        const filePath = match[1].trim();
        const comment = match[2].trim();
        if (filePath && comment) {
          comments.push({
            path: filePath,
            body: comment,
          });
        }
      }
      
      const structuredContent = {
        summary: aiAnalysis, // Full AI analysis as the summary
        comments: comments.length > 0 ? comments : [], // File-specific comments if extracted
      };
      
      console.log("Returning structured content, summary length:", structuredContent.summary.length);
      
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    } catch (error: any) {
      console.error("Error in analyze_pr tool:", error);
      const errorMessage = error.message || String(error);
      const structuredContent = {
        summary: `Error during PR analysis: ${errorMessage}`,
        comments: [],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);