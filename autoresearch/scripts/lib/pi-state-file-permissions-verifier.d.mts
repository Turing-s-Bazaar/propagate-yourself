export function verifyInstalledPiStateFilePermissions(
	packageRoot: string,
): Promise<
	"managed-acls-preserved" | "fresh-0600-managed-modes-preserved"
>;
