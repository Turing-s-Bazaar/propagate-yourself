export type ReadPiExtensionHandlerTimeoutSource = (
	relativePath: string,
) => string;

export declare function assertPiExtensionHandlerTimeoutPackageTree(
	readSource: ReadPiExtensionHandlerTimeoutSource,
): void;

export declare function assertPiExtensionHandlerTimeoutArchive(
	readEntry: ReadPiExtensionHandlerTimeoutSource,
): void;
