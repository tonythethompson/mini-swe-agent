/** Simple trajectory inspector for browsing agent conversation trajectories.
 * Ported from src/minisweagent/run/utilities/inspector.py
 *
 * This is a terminal-based viewer (not a full TUI like the Python Textual version). */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { getContentString } from "../../models/utils/content_string.js";

/** Group messages into "pages" as shown by the UI. */
export function messagesToSteps(messages: Record<string, any>[]): Record<string, any>[][] {
  const steps: Record<string, any>[][] = [];
  let currentStep: Record<string, any>[] = [];
  for (const message of messages) {
    if ((message.extra?.actions) || message.role === "assistant") {
      steps.push(currentStep);
      currentStep = [message];
    } else {
      currentStep.push(message);
    }
  }
  if (currentStep.length > 0) steps.push(currentStep);
  return steps;
}

/** Load a trajectory file. */
export function loadTrajectory(filePath: string): Record<string, any>[] {
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (Array.isArray(data)) return data;
  if (data.messages) return data.messages;
  throw new Error("Unrecognized trajectory format");
}

/** Find trajectory files in a directory or return single file. */
export function findTrajectoryFiles(p: string): string[] {
  const pathObj = path.resolve(p);
  if (fs.statSync(pathObj).isFile()) return [pathObj];
  if (fs.statSync(pathObj).isDirectory()) {
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith(".traj.json")) files.push(fullPath);
      }
    }
    walk(pathObj);
    return files.sort();
  }
  throw new Error(`Path '${p}' does not exist`);
}

/** Print a step's messages to the terminal. */
export function printStep(steps: Record<string, any>[][], iStep: number): void {
  console.log("\x1b[2J\x1b[H"); // clear screen
  if (steps.length === 0) {
    console.log("No trajectory loaded or empty trajectory");
    return;
  }
  const step = steps[iStep];
  for (const message of step) {
    const contentStr = getContentString(message);
    const role = message.role || message.type || "unknown";
    console.log(`\n${"=".repeat(60)}`);
    console.log(`${role.toUpperCase()}`);
    console.log(`${"=".repeat(60)}`);
    console.log(contentStr.replace(/\x00/g, ""));
    if (message.reasoning_content) {
      console.log(`\n--- REASONING ---`);
      console.log(message.reasoning_content.replace(/\x00/g, ""));
    }
  }
  console.log(`\n${"-".repeat(60)}`);
  console.log(`Step ${iStep + 1}/${steps.length}`);
}

/** Run the interactive inspector. */
export async function runInspector(
  trajectoryFiles: string[],
  showReasoning = true,
): Promise<void> {
  let iTrajectory = 0;
  let iStep = 0;
  let messages: Record<string, any>[] = [];
  let steps: Record<string, any>[][] = [];

  function loadCurrent() {
    if (trajectoryFiles.length === 0) {
      messages = [];
      steps = [];
      return;
    }
    try {
      messages = loadTrajectory(trajectoryFiles[iTrajectory]);
      steps = messagesToSteps(messages);
      iStep = 0;
    } catch (e) {
      console.error(`Error loading ${trajectoryFiles[iTrajectory]}: ${e}`);
      messages = [];
      steps = [];
    }
  }

  loadCurrent();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  console.log("Trajectory Inspector - press h for help, q to quit");

  function display() {
    printStep(steps, iStep);
    if (trajectoryFiles.length > 0) {
      console.log(`Trajectory ${iTrajectory + 1}/${trajectoryFiles.length}: ${path.basename(trajectoryFiles[iTrajectory])}`);
    }
  }

  display();

  rl.on("line", (line) => {
    const cmd = line.trim().toLowerCase();
    switch (cmd) {
      case "h":
        console.log("Commands: l/next step, h/prev step, j/scroll down, k/scroll up, n/next traj, p/prev traj, q/quit");
        break;
      case "l":
      case "right":
        if (iStep < steps.length - 1) { iStep++; display(); }
        break;
      case "h":
      case "left":
        if (iStep > 0) { iStep--; display(); }
        break;
      case "0":
        iStep = 0; display();
        break;
      case "$":
        iStep = steps.length - 1; display();
        break;
      case "n":
        if (iTrajectory < trajectoryFiles.length - 1) { iTrajectory++; loadCurrent(); display(); }
        break;
      case "p":
        if (iTrajectory > 0) { iTrajectory--; loadCurrent(); display(); }
        break;
      case "r":
        showReasoning = !showReasoning; display();
        break;
      case "q":
        rl.close();
        break;
      default:
        if (cmd) console.log("Unknown command. Press h for help.");
    }
  });

  return new Promise((resolve) => {
    rl.on("close", () => {
      console.log("\nGoodbye.");
      resolve();
    });
  });
}
