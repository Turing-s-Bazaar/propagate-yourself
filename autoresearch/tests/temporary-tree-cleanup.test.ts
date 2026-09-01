import assert from "node:assert/strict";
import test from "node:test";
import {
	removeTemporaryTree,
	runWithTemporaryTreeCleanup,
} from "../scripts/lib/temporary-tree-cleanup.mjs";

function filesystemError(code: string) {
	return Object.assign(new Error(code), { code });
}

test("temporary tree cleanup retries transient Windows file locks with bounded backoff", () => {
	let attempts = 0;
	const waits: number[] = [];
	removeTemporaryTree("temporary-root", {
		remove(path: string, options: { recursive: boolean; force: boolean }) {
			assert.equal(path, "temporary-root");
			assert.deepEqual(options, { recursive: true, force: true });
			attempts += 1;
			if (attempts < 4) {
				throw filesystemError("EPERM");
			}
		},
		wait(delayMs: number) {
			waits.push(delayMs);
		},
		maxRetries: 4,
		retryDelayMs: 250,
		maxRetryDelayMs: 600,
	});

	assert.equal(attempts, 4);
	assert.deepEqual(waits, [250, 500, 600]);
});

test("temporary tree cleanup fails immediately for non-transient errors", () => {
	const expected = filesystemError("EINVAL");
	assert.throws(
		() => removeTemporaryTree("temporary-root", {
			remove() {
				throw expected;
			},
			wait() {
				assert.fail("non-transient cleanup errors must not retry");
			},
		}),
		(error) => error === expected,
	);
});

test("verification failures remain primary when cleanup also fails", () => {
	const verificationError = new Error("verification failed");
	const cleanupError = filesystemError("EPERM");

	assert.throws(
		() => runWithTemporaryTreeCleanup(
			"temporary-root",
			() => {
				throw verificationError;
			},
			{
				remove() {
					throw cleanupError;
				},
				wait() {},
				maxRetries: 0,
			},
		),
		(error) => error === verificationError,
	);
	assert.equal(verificationError.cause, cleanupError);
});

test("cleanup failures still fail a successful verification", () => {
	const cleanupError = filesystemError("EPERM");

	assert.throws(
		() => runWithTemporaryTreeCleanup(
			"temporary-root",
			() => {},
			{
				remove() {
					throw cleanupError;
				},
				wait() {},
				maxRetries: 0,
			},
		),
		(error) => error === cleanupError,
	);
});
