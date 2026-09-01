export declare const VERIFICATION_PHRASE: string;
export declare const HIDDEN_GPO_STAMP: string;
export declare const HIDDEN_GPO_PRINT_STAMP: string;
export declare function createMinimalPdf(
	text?: string,
	stampFill?: "0 g" | "1 g",
	stampBackgroundFill?: string,
	printRowCount?: number,
): Buffer;
export declare function verifyInstalledDocparser(options?: {
	packageRoot?: string;
}): Promise<{
	docparser: string;
	liteparse: string;
	jiti: string;
	pageCount: number;
	hits: number;
	hiddenGpoStamps: "suppressed";
	pngBytes: number;
	tableColumns: number;
}>;
