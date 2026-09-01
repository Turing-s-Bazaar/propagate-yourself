import type {
	WorkbenchProject,
	WorkbenchRun,
	WorkbenchState,
} from "./types.js";

export type WorkbenchViewRoute = {
	projectId: string;
	runSlug: string;
};

type WorkbenchRouteState = Pick<WorkbenchState, "projects" | "runs">;

const appShellBase = "/app-shell";

export function routeBaseForPath(pathname: string): "" | typeof appShellBase {
	return pathname === appShellBase || pathname.startsWith(`${appShellBase}/`) ? appShellBase : "";
}

export function parseWorkbenchRoute(pathname: string): WorkbenchViewRoute | null {
	const base = routeBaseForPath(pathname);
	const prefix = `${base}/projects/`;
	if (!pathname.startsWith(prefix)) return null;

	const routePart = pathname.slice(prefix.length);
	const [projectPart, framePart = ""] = routePart.split("/frames/");
	if (!projectPart || !framePart) return null;

	try {
		return {
			projectId: decodeURIComponent(projectPart),
			runSlug: decodeURIComponent(framePart),
		};
	} catch {
		return null;
	}
}

function runBelongsToProject(run: WorkbenchRun, project: WorkbenchProject): boolean {
	return project.runSlugs.includes(run.slug) || run.projectId === project.id;
}

function primaryRunForProject(state: WorkbenchRouteState, project: WorkbenchProject): WorkbenchRun | undefined {
	return state.runs.find((run) => run.slug === project.primaryRunSlug && runBelongsToProject(run, project))
		?? state.runs.find((run) => runBelongsToProject(run, project));
}

export function defaultWorkbenchRoute(state: WorkbenchRouteState): WorkbenchViewRoute {
	const project = state.projects.find((item) => item.id === "active-plans") ?? state.projects[0];
	const run = project ? primaryRunForProject(state, project) : state.runs[0];
	return {
		projectId: project?.id ?? run?.projectId ?? "workspace",
		runSlug: run?.slug ?? project?.primaryRunSlug ?? project?.runSlugs[0] ?? "workspace",
	};
}

export function resolveWorkbenchRoute(
	state: WorkbenchRouteState,
	route: WorkbenchViewRoute | null,
): WorkbenchViewRoute {
	const fallback = defaultWorkbenchRoute(state);
	if (!route) return fallback;
	const project = state.projects.find((item) => item.id === route.projectId);
	if (!project) return fallback;
	const run = state.runs.find((item) => item.slug === route.runSlug && runBelongsToProject(item, project));
	return {
		projectId: project.id,
		runSlug: run?.slug ?? primaryRunForProject(state, project)?.slug ?? fallback.runSlug,
	};
}

export function workbenchRoutesEqual(left: WorkbenchViewRoute | null, right: WorkbenchViewRoute | null): boolean {
	return left?.projectId === right?.projectId && left?.runSlug === right?.runSlug;
}

export function workbenchProjectPath(
	projectId: string,
	runSlug: string,
	currentPathname: string,
	options: { artifactPath?: string | null } = {},
): string {
	const base = routeBaseForPath(currentPathname);
	const path = `${base}/projects/${encodeURIComponent(projectId)}/frames/${encodeURIComponent(runSlug)}`;
	const artifactPath = options.artifactPath?.trim();
	return artifactPath ? `${path}?artifact=${encodeURIComponent(artifactPath)}` : path;
}

export function workbenchHomePath(currentPathname: string): string {
	const base = routeBaseForPath(currentPathname);
	return `${base}/`;
}
