// An organization's scan: every repository, scanned in parallel, each as `scan` scans one.
// Pass a GitHubOptions whose fetch goes through one rate limiter (ratelimit.ts), so the parallel
// scans share GitHub's limits.
import { AtlasError } from './errors.ts';
import { openGitHub, type GitHubOptions, type Organization, type OrganizationRepository } from './github.ts';
import { scan, type ScanResult } from './scan.ts';

/** One repository's scan: its result, or why it failed. */
export type RepositoryScan =
  | { repository: OrganizationRepository; result: ScanResult }
  | { repository: OrganizationRepository; error: string };

/** Scans every repository at once; `onScanned` hears of each as soon as it is done, by its index. */
export async function scanOrganization(
  organization: Organization,
  options: GitHubOptions,
  onScanned: (index: number, scanned: RepositoryScan) => void = () => {},
): Promise<RepositoryScan[]> {
  return Promise.all(
    organization.repositories.map(async (repository, index) => {
      let scanned: RepositoryScan;
      try {
        scanned = { repository, result: await scan(await openGitHub(repository.url, options)) };
      } catch (error) {
        // One repository's failure is its own: the others go on.
        const message = error instanceof AtlasError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
        scanned = { repository, error: message };
      }
      onScanned(index, scanned);
      return scanned;
    }),
  );
}
