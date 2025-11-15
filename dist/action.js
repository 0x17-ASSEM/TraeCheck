import { Octokit } from "@octokit/rest";
/**
 * GitHub Action entry: listens to PR events, runs analysis using MCP client/server if needed,
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
        const octokit = new Octokit({ auth: token });
        // Fetch PR files and diffs
        const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
        // Very basic heuristic analysis placeholder
        const comments = [];
        for (const f of files) {
            if ((f.patch || "").length > 2000) {
                comments.push({
                    path: f.filename,
                    body: "Large diff detected. Consider breaking changes into smaller commits for easier review.",
                });
            }
            if (f.status === "modified" && f.filename.toLowerCase().includes("config")) {
                comments.push({
                    path: f.filename,
                    body: "Configuration file modified. Ensure environment-specific values are documented and secrets are not committed.",
                });
            }
        }
        // Post a summary comment on PR
        const summaryBody = `Automated PR analysis found ${comments.length} suggestion(s).`;
        await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: summaryBody });
        // Optionally post review comments using createReview; here we post a single consolidated review
        if (comments.length > 0) {
            await octokit.pulls.createReview({
                owner,
                repo,
                pull_number: prNumber,
                event: "COMMENT",
                body: comments.map((c) => `- ${c.path}: ${c.body}`).join("\n"),
            });
        }
        console.log("PR analysis completed.");
    }
    catch (err) {
        console.error("Error running action:", err);
        process.exit(1);
    }
}
run();
