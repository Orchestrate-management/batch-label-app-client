// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) on
// Vitest's expect, and clears the rendered DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/**
 * Testing Library's default budget for findBy* and waitFor is ONE SECOND, measured in wall
 * clock rather than in work done. Vitest runs 67 files across every core this machine has, so
 * a first render that takes 40ms alone can take longer than that when it is scheduled behind
 * sixty other suites. Measured: `accept-invite.test.tsx` passes on its own three times out of
 * three and failed once inside `npm run test:coverage` with "Unable to find role=heading" while
 * the DOM still showed the loading skeleton.
 *
 * Four seconds, under Vitest's own 5s per-test timeout so a genuinely stuck assertion still
 * fails with the useful "unable to find" dump rather than a bare timeout. This does not make a
 * slow test pass; it stops a fast one failing because the box was busy.
 */
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});
