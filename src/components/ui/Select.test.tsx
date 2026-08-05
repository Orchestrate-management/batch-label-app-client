import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Field, NativeSelect, Select } from './Primitives';

/**
 * WHAT A NATIVE `<select>` USED TO DO FOR FREE, AND NOW HAS TO BE CHECKED.
 *
 * The open list is this app's own markup now rather than the operating system's, and every
 * behaviour below arrived with the browser before and arrives with a library today. That is
 * the whole trade this change makes, so it is the thing under test: arrows, Home, End,
 * type-ahead, Enter, Escape, Tab, and focus coming back to the control it left.
 *
 * These are written against the ROLES and the KEYS, not against Radix. If the library is
 * ever swapped or the component is hand-rolled, this file should still be the specification
 * and should not need rewriting.
 */

const MATERIALS = [
'Soy wax 464',
'Beeswax, filtered',
'Coconut wax blend',
'Paraffin 4630',
'Rapeseed wax'];


function Harness({
  value: initial = '',
  disabled,
  options = MATERIALS,
  onChange
}: {value?: string;disabled?: boolean;options?: string[];onChange?: (value: string) => void;}) {
  const [value, setValue] = useState(initial);
  return (
    <Field label="Base wax or carrier">
      <Select
        value={value}
        disabled={disabled}
        onChange={(event) => {
          setValue(event.target.value);
          onChange?.(event.target.value);
        }}>

        <option value="">Not chosen</option>
        {options.map((name) =>
        <option key={name} value={name}>
            {name}
          </option>
        )}
      </Select>
    </Field>);

}

/**
 * `hidden: true`, and not because the control is hidden. While the list is open Radix marks
 * the rest of the document `aria-hidden` so a screen reader cannot wander out of the popup,
 * and Testing Library honours that — which is the behaviour we want and would otherwise make
 * the control unfindable in exactly the tests that need it.
 */
const trigger = () => screen.getByRole('combobox', { hidden: true });
const options = () => screen.getAllByRole('option');
const highlighted = () => document.activeElement as HTMLElement;

/** Open with the keyboard, the way somebody who never touches a mouse reaches this control. */
async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>) {
  trigger().focus();
  await user.keyboard('{Enter}');
  await screen.findByRole('listbox');
}

describe('the dropdown is a listbox, and says so', () => {
  it('gives the closed control the combobox role and the open list the listbox role', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await openWithKeyboard(user);

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(options()).toHaveLength(MATERIALS.length + 1);
  });

  it('marks the chosen option as the selected one, not merely as the highlighted one', async () => {
    const user = userEvent.setup();
    render(<Harness value="Coconut wax blend" />);
    await openWithKeyboard(user);

    const selected = screen.getByRole('option', { name: 'Coconut wax blend' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(
      options().filter((option) => option.getAttribute('aria-selected') === 'true')
    ).toHaveLength(1);
  });

  it('shows the chosen option on the closed control', () => {
    render(<Harness value="Rapeseed wax" />);
    expect(trigger()).toHaveTextContent('Rapeseed wax');
  });
});

describe('the keyboard', () => {
  it('opens on Enter and puts the maker on the option that is already chosen', async () => {
    const user = userEvent.setup();
    render(<Harness value="Paraffin 4630" />);
    await openWithKeyboard(user);

    expect(highlighted()).toHaveTextContent('Paraffin 4630');
  });

  it('opens on ArrowDown and on Space as well as Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    trigger().focus();
    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

    await user.keyboard(' ');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('walks the list with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<Harness value="Soy wax 464" />);
    await openWithKeyboard(user);

    expect(highlighted()).toHaveTextContent('Soy wax 464');
    await user.keyboard('{ArrowDown}');
    expect(highlighted()).toHaveTextContent('Beeswax, filtered');
    await user.keyboard('{ArrowDown}');
    expect(highlighted()).toHaveTextContent('Coconut wax blend');
    await user.keyboard('{ArrowUp}');
    expect(highlighted()).toHaveTextContent('Beeswax, filtered');
  });

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness value="Coconut wax blend" />);
    await openWithKeyboard(user);

    await user.keyboard('{End}');
    expect(highlighted()).toHaveTextContent('Rapeseed wax');
    await user.keyboard('{Home}');
    expect(highlighted()).toHaveTextContent('Not chosen');
  });

  it.each([
  ['rap', 'Rapeseed wax'],
  ['bee', 'Beeswax, filtered'],
  ['c', 'Coconut wax blend']]
  )('finds an option by typing %s', async (typed, expected) => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWithKeyboard(user);

    await user.keyboard(typed);
    expect(highlighted()).toHaveTextContent(expected);
  });

  it('commits the highlighted option on Enter, and tells the form about it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await openWithKeyboard(user);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onChange).toHaveBeenCalledWith('Beeswax, filtered');
    expect(trigger()).toHaveTextContent('Beeswax, filtered');
  });

  it('abandons the choice on Escape', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness value="Soy wax 464" onChange={onChange} />);
    await openWithKeyboard(user);

    await user.keyboard('{ArrowDown}{ArrowDown}{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent('Soy wax 464');
  });

  it('closes on Tab rather than trapping the maker in the list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWithKeyboard(user);

    await user.keyboard('{Tab}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  /**
   * THE ONE THAT IS EASIEST TO LOSE AND WORST TO LOSE. A popup that closes without handing
   * focus back leaves a keyboard maker at the top of the document, several tab stops from
   * the field they were filling in — and nothing on screen says so.
   */
  it.each(['{Escape}', '{Enter}'])('returns focus to the control after %s', async (key) => {
    const user = userEvent.setup();
    render(<Harness />);
    await openWithKeyboard(user);

    await user.keyboard(key);

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
});

describe('what the register can hand it', () => {
  /**
   * `<option value="">` is a real answer in this app — "Not chosen", "Every product",
   * "Everything" — and a listbox library that reserves the empty string for its placeholder
   * would drop it. The value has to survive the round trip unchanged, because "not chosen"
   * and "not answered" are different statements on a form that feeds a classification.
   */
  it('carries an option whose value is the empty string, both ways', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness value="Soy wax 464" onChange={onChange} />);

    await openWithKeyboard(user);
    await user.keyboard('{Home}{Enter}');

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
    expect(trigger()).toHaveTextContent('Not chosen');
  });

  /**
   * A new account's materials register is empty, and Specification.tsx says so in copy that
   * was written on purpose. Those sentences are `<option>` children, so they have to reach
   * the list.
   */
  it.each([
  ['Loading…', 'the register has not answered yet'],
  ['Register unavailable', 'the register could not be read'],
  ['Not chosen', 'the register is empty']]
  )('still shows %s when %s', async (copy) => {
    const user = userEvent.setup();
    render(
      <Select value="" onChange={() => {}} aria-label="Base wax or carrier">
        <option value="">{copy}</option>
      </Select>
    );

    await openWithKeyboard(user);

    expect(await screen.findByRole('option', { name: copy })).toBeInTheDocument();
    expect(options()).toHaveLength(1);
  });

  it('holds a long register, with every entry reachable', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 60 }, (_, index) => `Material ${index + 1}`);
    render(<Harness options={many} value="Material 47" />);
    await openWithKeyboard(user);

    expect(options()).toHaveLength(61);
    // Opening lands on the chosen row rather than the top of the list, which is what
    // "scrolled into view" means for somebody who cannot see the scroll happen.
    expect(highlighted()).toHaveTextContent('Material 47');
    await user.keyboard('{End}');
    expect(highlighted()).toHaveTextContent('Material 60');
  });
});

describe('the states the control itself can be in', () => {
  it('will not open when it is disabled', async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);

    expect(trigger()).toBeDisabled();
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps the chevron, and turns it over when the list is open', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const chevron = trigger().querySelector('svg');
    expect(chevron).toHaveClass('lucide-chevron-down');

    await openWithKeyboard(user);
    expect(trigger()).toHaveAttribute('data-state', 'open');
  });
});

/**
 * The branch that is one line away in `Select`, kept alive so the phone decision stays cheap
 * to make. Same props, same children, same `onChange` shape — that is the whole claim.
 */
describe('the native fallback, for if phones should keep their picker', () => {
  it('takes the same props and reports the same change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Field label="Base wax or carrier">
        <NativeSelect value="" onChange={(event) => onChange(event.target.value)}>
          <option value="">Not chosen</option>
          {MATERIALS.map((name) =>
          <option key={name} value={name}>
              {name}
            </option>
          )}
        </NativeSelect>
      </Field>
    );

    const native = screen.getByRole('combobox');
    expect(native.tagName).toBe('SELECT');
    await user.selectOptions(native, 'Rapeseed wax');
    expect(onChange).toHaveBeenCalledWith('Rapeseed wax');
  });
});
