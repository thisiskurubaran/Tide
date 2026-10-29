import { addTab, closeTab, cycleTab, initialTabs, MAX_TERMINALS } from './terminalTabs';

describe('terminal tabs', () => {
  it('adds, cycles and closes terminals', () => {
    let t = addTab(addTab(initialTabs()));
    expect(t).toEqual({ ids: [1, 2, 3], active: 3, next: 4 });
    t = cycleTab(t, 1);
    expect(t.active).toBe(1);
    t = cycleTab(t, -1);
    expect(t.active).toBe(3);
    // Closing the active one moves to its neighbour.
    t = closeTab({ ...t, active: 2 }, 2);
    expect(t).toMatchObject({ ids: [1, 3], active: 3 });
    t = closeTab(t, 1);
    expect(t).toMatchObject({ ids: [3], active: 3 });
  });

  it('never leaves the panel empty and caps the count', () => {
    expect(closeTab(initialTabs(), 1)).toEqual({ ids: [2], active: 2, next: 3 });
    let t = initialTabs();
    for (let i = 0; i < 10; i++) t = addTab(t);
    expect(t.ids).toHaveLength(MAX_TERMINALS);
  });
});
