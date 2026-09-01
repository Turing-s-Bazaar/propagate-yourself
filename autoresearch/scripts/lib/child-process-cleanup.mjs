import { spawn } from "node:child_process";

const observedClosePromises = new WeakMap();

function positiveTimeout(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function observeChildProcessClose(child) {
	const existing = observedClosePromises.get(child);
	if (existing) return existing;

	const closePromise = new Promise((resolvePromise) => {
		child.once("close", (code, signal) => {
			resolvePromise({ code, signal });
		});
	});
	observedClosePromises.set(child, closePromise);
	return closePromise;
}

async function waitForPromise(promise, timeoutMs) {
	let timeout;
	const timed = new Promise((resolvePromise) => {
		timeout = setTimeout(() => resolvePromise({ completed: false }), timeoutMs);
	});
	try {
		return await Promise.race([
			promise.then((value) => ({ completed: true, value })),
			timed,
		]);
	} finally {
		clearTimeout(timeout);
	}
}

async function waitForClose(closePromise, timeoutMs) {
	return (await waitForPromise(closePromise, timeoutMs)).completed;
}

function validPid(pid) {
	return Number.isInteger(pid) && pid > 0;
}

async function runTaskkill(pid, force, options) {
	const {
		spawnProcess,
		taskkillMs,
		taskkillForceMs,
	} = options;
	let killer;
	try {
		killer = spawnProcess(
			"taskkill.exe",
			["/pid", `${pid}`, "/t", ...(force ? ["/f"] : [])],
			{
				stdio: "ignore",
				windowsHide: true,
			},
		);
	} catch (error) {
		return { completed: false, error };
	}

	const closePromise = observeChildProcessClose(killer);
	let spawnError;
	killer.once("error", (error) => {
		spawnError ??= error;
	});
	const closeResult = await waitForPromise(closePromise, taskkillMs);
	if (closeResult.completed) {
		const { code, signal } = closeResult.value;
		const closeError = code === 0 && signal === null
			? undefined
			: new Error(
				`taskkill${force ? " /f" : ""} failed for PID ${pid}: code=${code ?? "null"} signal=${signal ?? "null"}`,
			);
		const error = spawnError ?? closeError;
		return { completed: !error, error };
	}

	try {
		killer.kill("SIGKILL");
	} catch {
		// The taskkill process may have exited between the timeout and the kill.
	}
	if (!(await waitForClose(closePromise, taskkillForceMs))) {
		return {
			completed: false,
			error: new Error(`Timed out waiting for taskkill to close for PID ${pid}`),
		};
	}
	return {
		completed: false,
		error: spawnError ?? new Error(`taskkill timed out for PID ${pid}`),
	};
}

function signalPosixProcessGroup(child, signal) {
	if (validPid(child.pid)) {
		try {
			process.kill(-child.pid, signal);
			return true;
		} catch {
			// Fall back to the direct child if process-group signaling is unavailable
			// or the group exited between the state check and the signal.
		}
	}
	try {
		return child.kill(signal) !== false;
	} catch {
		return false;
	}
}

function posixProcessGroupExists(pid) {
	if (!validPid(pid)) return false;
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

async function waitForPosixProcessGroupExit(pid, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (posixProcessGroupExists(pid)) {
		if (Date.now() >= deadline) return false;
		await new Promise((resolvePromise) => {
			setTimeout(resolvePromise, Math.min(25, Math.max(1, deadline - Date.now())));
		});
	}
	return true;
}

async function waitForPosixTreeClose(child, closePromise, timeoutMs) {
	const [closed, processGroupExited] = await Promise.all([
		waitForClose(closePromise, timeoutMs),
		waitForPosixProcessGroupExit(child.pid, timeoutMs),
	]);
	return closed && processGroupExited;
}

export async function terminateChildProcessTree(
	child,
	options = {},
) {
	const platform = options.platform ?? process.platform;
	const graceMs = positiveTimeout(options.graceMs, 2_000);
	const forceMs = positiveTimeout(options.forceMs, 2_000);
	const taskkillMs = positiveTimeout(options.taskkillMs, 2_000);
	const taskkillForceMs = positiveTimeout(options.taskkillForceMs, forceMs);
	const spawnProcess = options.spawnProcess ?? spawn;
	const closePromise = options.closePromise ?? observeChildProcessClose(child);

	try {
		child.stdin?.destroy();
	} catch {
		// Continue to process-tree termination even if stdin teardown fails.
	}

	if (!validPid(child.pid)) {
		if (await waitForClose(closePromise, forceMs)) return;
		throw new Error("Timed out waiting for child process without a PID to close");
	}

	if (platform === "win32") {
		const gracefulTaskkill = await runTaskkill(child.pid, false, {
			spawnProcess,
			taskkillMs,
			taskkillForceMs,
		});
		const gracefullyClosed = await waitForClose(closePromise, graceMs);
		if (gracefulTaskkill.completed && gracefullyClosed) return;

		const forcedTaskkill = await runTaskkill(child.pid, true, {
			spawnProcess,
			taskkillMs,
			taskkillForceMs,
		});
		const forciblyClosed = await waitForClose(closePromise, forceMs);
		if (forcedTaskkill.completed && forciblyClosed) return;

		const causes = [
			gracefulTaskkill.error,
			forcedTaskkill.error,
			!forciblyClosed
				? new Error(`Child process did not close after forced taskkill for PID ${child.pid}`)
				: undefined,
		].filter(Boolean);
		throw new AggregateError(
			causes,
			`Timed out terminating Windows child process tree for PID ${child.pid}`,
		);
	}

	signalPosixProcessGroup(child, "SIGTERM");
	if (await waitForPosixTreeClose(child, closePromise, graceMs)) return;

	signalPosixProcessGroup(child, "SIGKILL");
	if (await waitForPosixTreeClose(child, closePromise, forceMs)) return;

	throw new Error(`Timed out terminating POSIX child process tree for PID ${child.pid}`);
}
