// Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument) on
// Vitest's expect, and clears the rendered DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * THE FOUR THINGS JSDOM DOES NOT HAVE THAT AN OPEN DROPDOWN NEEDS.
 *
 * `Select` is a real listbox now (see components/ui/Primitives.tsx), so opening one in a
 * test runs code that a native `<select>` never made us run: pointer capture on the
 * trigger, `scrollIntoView` to bring the selected option into view, and a ResizeObserver
 * that keeps the popup pinned to the control. None of the four exists in jsdom, and each
 * one is absent in a different way — `hasPointerCapture` throws, `scrollIntoView` throws,
 * `ResizeObserver` is simply undefined.
 *
 * These are stubs, not implementations, and they are honest about it: there is no layout
 * in jsdom for any of them to report on. What they buy is that a test can open a dropdown
 * and assert on the keyboard, the roles and the copy — which is what these tests are for.
 * Anything that depends on real geometry (where the popup lands, whether it flipped above
 * the trigger, whether a long list actually scrolled) is a screenshot's job, not this
 * file's.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
});
