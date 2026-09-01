/**
 * Focused Pi 0.84.2 port of upstream commit 27115254 / PR #8615.
 *
 * Extension messages may contain alternating text and images. Preserve that
 * ordering unless an input handler or prompt-template expansion changes the
 * normalized text, in which case the transformed text plus images is canonical.
 */

export const PI_INTERLEAVED_USER_CONTENT_MARKER =
	"Feynman Pi 0.84.2 correctness patch: interleaved user content #8615";

const PI_INTERLEAVED_CREATE_USER_CONTENT = `    _createUserContent(text, images, orderedContent) {
        return orderedContent ?? [{ type: "text", text }, ...(images ?? [])];
    }`;

const PI_INTERLEAVED_SEND_USER_MESSAGE_HANDOFF = `        await this._prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        }, orderedContent);`;

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	if (countOccurrences(source, original) !== 1) {
		throw new Error(
			`Unsupported Pi 0.84.2 ${label} layout; remove or update the runtime correctness patch`,
		);
	}
	return source.replace(original, replacement);
}

export function assertPiInterleavedUserContentSource(source, surface = "Pi interleaved user content") {
	for (const [label, fragment] of [
		["marker", PI_INTERLEAVED_USER_CONTENT_MARKER],
		["exact _createUserContent return", PI_INTERLEAVED_CREATE_USER_CONTENT],
		["exact sendUserMessage _prompt handoff", PI_INTERLEAVED_SEND_USER_MESSAGE_HANDOFF],
	]) {
		if (countOccurrences(source, fragment) !== 1) {
			throw new Error(`Incomplete ${surface} patch: missing ${label}`);
		}
	}
}

export function patchPiInterleavedUserContentSource(source) {
	if (source.includes(PI_INTERLEAVED_USER_CONTENT_MARKER)) {
		assertPiInterleavedUserContentSource(source);
		return source;
	}
	let patched = replaceRequired(
		source,
		`    async prompt(text, options) {
        const expandPromptTemplates = options?.expandPromptTemplates ?? true;`,
		`    async prompt(text, options) {
        await this._prompt(text, options);
    }
    // ${PI_INTERLEAVED_USER_CONTENT_MARKER}
    async _prompt(text, options, orderedContent) {
        const expandPromptTemplates = options?.expandPromptTemplates ?? true;`,
		"interleaved content prompt delegate",
	);
	patched = replaceRequired(
		patched,
		`                if (inputResult.action === "transform") {
                    currentText = inputResult.text;
                    currentImages = inputResult.images ?? currentImages;
                }`,
		`                if (inputResult.action === "transform") {
                    currentText = inputResult.text;
                    currentImages = inputResult.images ?? currentImages;
                    orderedContent = undefined;
                }`,
		"interleaved content input transformation",
	);
	patched = replaceRequired(
		patched,
		`            if (expandPromptTemplates) {
                expandedText = this._expandSkillCommand(expandedText);
                expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
            }`,
		`            if (expandPromptTemplates) {
                expandedText = this._expandSkillCommand(expandedText);
                expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
                if (expandedText !== currentText)
                    orderedContent = undefined;
            }`,
		"interleaved content template expansion",
	);
	patched = replaceRequired(
		patched,
		`                if (options.streamingBehavior === "followUp") {
                    await this._queueFollowUp(expandedText, currentImages);
                }
                else {
                    await this._queueSteer(expandedText, currentImages);
                }`,
		`                if (options.streamingBehavior === "followUp") {
                    await this._queueFollowUp(expandedText, currentImages, orderedContent);
                }
                else {
                    await this._queueSteer(expandedText, currentImages, orderedContent);
                }`,
		"interleaved content streaming queues",
	);
	patched = replaceRequired(
		patched,
		`            // Add user message
            const userContent = [{ type: "text", text: expandedText }];
            if (currentImages) {
                userContent.push(...currentImages);
            }
            messages.push({
                role: "user",
                content: userContent,
                timestamp: Date.now(),
            });`,
		`            // Add user message
            messages.push({
                role: "user",
                content: this._createUserContent(expandedText, currentImages, orderedContent),
                timestamp: Date.now(),
            });`,
		"interleaved content idle message",
	);
	patched = replaceRequired(
		patched,
		`    async _queueSteer(text, images) {
        this._steeringMessages.push(text);
        this._emitQueueUpdate();
        const content = [{ type: "text", text }];
        if (images) {
            content.push(...images);
        }
        this.agent.steer({
            role: "user",
            content,
            timestamp: Date.now(),
        });
    }
    /**
     * Internal: Queue a follow-up message (already expanded, no extension command check).
     */
    async _queueFollowUp(text, images) {
        this._followUpMessages.push(text);
        this._emitQueueUpdate();
        const content = [{ type: "text", text }];
        if (images) {
            content.push(...images);
        }
        this.agent.followUp({
            role: "user",
            content,
            timestamp: Date.now(),
        });
    }`,
		`    async _queueSteer(text, images, orderedContent) {
        this._steeringMessages.push(text);
        this._emitQueueUpdate();
        this.agent.steer({
            role: "user",
            content: this._createUserContent(text, images, orderedContent),
            timestamp: Date.now(),
        });
    }
    /**
     * Internal: Queue a follow-up message (already expanded, no extension command check).
     */
    async _queueFollowUp(text, images, orderedContent) {
        this._followUpMessages.push(text);
        this._emitQueueUpdate();
        this.agent.followUp({
            role: "user",
            content: this._createUserContent(text, images, orderedContent),
            timestamp: Date.now(),
        });
    }
${PI_INTERLEAVED_CREATE_USER_CONTENT}`,
		"interleaved content queue construction",
	);
	patched = replaceRequired(
		patched,
		`        // Normalize content to text string + optional images
        let text;
        let images;
        if (typeof content === "string") {`,
		`        // Normalize content to text string + optional images
        let text;
        let images;
        const orderedContent = typeof content === "string" ? undefined : [...content];
        if (typeof content === "string") {`,
		"interleaved content input snapshot",
	);
	patched = replaceRequired(
		patched,
		`        await this.prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        });`,
		`        await this._prompt(text, {
            expandPromptTemplates: options?.expandPromptTemplates ?? false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        }, orderedContent);`,
		"interleaved content sendUserMessage handoff",
	);
	assertPiInterleavedUserContentSource(patched);
	return patched;
}
