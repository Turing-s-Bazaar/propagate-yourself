export type WorkbenchCustomSkill = {
	id: string;
	userId: string;
	name: string;
	description: string;
	content: string;
	path: string;
	source: "project";
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};

export type WorkbenchAgentSkillAssignment = {
	id: string;
	skillId: string;
	agentName: string;
	userId: string;
	createdAt: string;
	createdAtMs: number;
};

export type WorkbenchCustomAgentPrompt = {
	id: string;
	userId: string;
	agentName: string;
	promptText: string;
	path: string;
	createdAt: string;
	createdAtMs: number;
	updatedAt: string;
	updatedAtMs: number;
};
