const { spawn } = require("child_process");
const path = require("path");

const SCRIPT_PATH = path.resolve(__dirname, "..", "recommendations", "recommend.py");
const TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const runRecommendationEngine = (payload) => new Promise((resolve, reject) => {
    const executable = process.env.RECOMMENDER_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const child = spawn(executable, [SCRIPT_PATH], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(result);
    };

    const timeout = setTimeout(() => {
        child.kill();
        const error = new Error("The recommendation engine timed out.");
        error.statusCode = 503;
        finish(error);
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
            child.kill();
            const error = new Error("The recommendation engine returned too much data.");
            error.statusCode = 502;
            finish(error);
        }
    });
    child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
            child.kill();
            const error = new Error("The recommendation engine returned too much diagnostic data.");
            error.statusCode = 502;
            finish(error);
        }
    });
    child.on("error", (cause) => {
        const error = new Error("Unable to start the local Python recommender. Install backend/recommendations/requirements.txt and configure RECOMMENDER_PYTHON if needed.");
        error.statusCode = 503;
        error.cause = cause;
        finish(error);
    });
    child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) {
            const error = new Error(stderr.trim() || `The recommendation engine exited with status ${code}.`);
            error.statusCode = 503;
            finish(error);
            return;
        }
        try {
            finish(null, JSON.parse(stdout));
        } catch (cause) {
            const error = new Error("The recommendation engine returned an invalid response.");
            error.statusCode = 502;
            error.cause = cause;
            finish(error);
        }
    });

    child.stdin.end(JSON.stringify(payload));
});

module.exports = { runRecommendationEngine };
