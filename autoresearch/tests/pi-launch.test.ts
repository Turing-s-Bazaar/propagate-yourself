import test from "node:test";
import assert from "node:assert/strict";

import { exitCodeFromSignal } from "../src/pi/launch.js";

test("exitCodeFromSignal maps POSIX signals to conventional shell exit codes", () => {
	assert.equal(exitCodeFromSignal("SIGTERM"), 143);
	assert.equal(exitCodeFromSignal("SIGSEGV"), 139);
});
