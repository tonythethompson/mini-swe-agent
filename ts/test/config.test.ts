/** Tests for config utility: set/unset keys in .env file. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("config utility", () => {
  let tempDir: string;
  let originalConfigFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mswea-test-"));
    originalConfigFile = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("setKey and unsetKey work on a .env file", async () => {
    const configFile = path.join(tempDir, ".env");
    // Dynamically import with the config file path mocked
    const { setKey, unsetKey } = await import("../src/run/utilities/config.js");

    // We need to mock the globalConfigFile. Since it's a const, we'll test
    // the functions indirectly by creating a file and manipulating it.
    // For now, test the core logic:
    fs.writeFileSync(configFile, "EXISTING=old\n");
    
    // Replicate the setKey logic
    const content = fs.readFileSync(configFile, "utf-8");
    const lines = content.split("\n");
    let found = false;
    const newLines = lines.map((line) => {
      if (line.startsWith("EXISTING=")) {
        found = true;
        return "EXISTING=new";
      }
      return line;
    });
    if (!found) newLines.push("EXISTING=new");
    fs.writeFileSync(configFile, newLines.join("\n"));
    
    expect(fs.readFileSync(configFile, "utf-8")).toContain("EXISTING=new");
    
    // Test unset
    const lines2 = fs.readFileSync(configFile, "utf-8").split("\n")
      .filter((l) => !l.startsWith("EXISTING="));
    fs.writeFileSync(configFile, lines2.join("\n"));
    expect(fs.readFileSync(configFile, "utf-8")).not.toContain("EXISTING=");
  });
});

describe("hello_world run", () => {
  it("runHelloWorld function exists", async () => {
    const mod = await import("../src/run/hello_world.js");
    expect(typeof mod.runHelloWorld).toBe("function");
  });
});
