export interface PdfPageLimitResult {
	configured: 1;
	datalab: 1;
	gemini: 1;
	local: "1/2";
}

export declare function verifyPdfPageLimits(
	packageRoot: string,
): Promise<PdfPageLimitResult>;
