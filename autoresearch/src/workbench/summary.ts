import type {
	ArtifactCategory,
	WorkbenchArtifact,
	WorkbenchState,
	WorkbenchSummary,
} from "./types.js";

type WorkbenchSummaryActivity = Pick<
	WorkbenchState,
	"notifications" | "queuedUserMessages" | "sessionActivity"
>;

const EMPTY_ACTIVITY: WorkbenchSummaryActivity = {
	notifications: [],
	queuedUserMessages: [],
	sessionActivity: [],
};

export function buildWorkbenchSummary(
	artifacts: WorkbenchArtifact[],
	projectCount: number,
	runCount: number,
	savedNoteCount = 0,
	claimCount = 0,
	activity: WorkbenchSummaryActivity = EMPTY_ACTIVITY,
	transcriptAnnotationCount = 0,
): WorkbenchSummary {
	const count = (category: ArtifactCategory) => artifacts.filter((artifact) => artifact.category === category).length;
	return {
		activityCount: activity.sessionActivity.length,
		artifactCount: artifacts.length,
		transcriptAnnotationCount,
		claimCount,
		notificationCount: activity.notifications.length,
		projectCount,
		queuedMessageCount: activity.queuedUserMessages.length,
		runCount,
		outputCount: count("output"),
		paperCount: count("paper"),
		planCount: count("plan"),
		unreadActivityCount: activity.sessionActivity.filter((item) => item.unread).length,
		verificationCount: count("verification"),
		provenanceCount: count("provenance"),
		noteCount: count("note") + savedNoteCount,
	};
}
