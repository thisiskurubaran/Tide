import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

import { createSupportStore, supportStore } from '../support/store';
import { uniqueProjectName } from './EmptyProjects';
import { currentStep, EditorTour, nextTourStep, resetEditorTour, skipEditorTour, tourStore, tourTargets, TOUR_STEPS } from './tour';

const rect = { x: 10, y: 100, width: 40, height: 30 };
const register = (...ids: (typeof TOUR_STEPS)[number]['id'][]) => ids.forEach((id) => tourTargets.getState().set(id, rect));

beforeEach(() => {
  tourTargets.setState({ rects: {} });
  tourStore.setState({ index: 0, enabled: false });
  supportStore.setState({ touredEditor: false });
});

describe('editor tour store', () => {
  it('walks the registered steps in order and finishes', () => {
    register('run', 'files', 'palette', 'terminal');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(currentStep(tourStore.getState().index, tourTargets.getState().rects)!.id);
      nextTourStep();
    }
    expect(seen).toEqual(['run', 'files', 'palette', 'terminal']);
    expect(supportStore.getState().touredEditor).toBe(true);
  });

  it('passes over steps whose control is not on screen', () => {
    register('run', 'terminal');
    expect(currentStep(0, tourTargets.getState().rects)?.id).toBe('run');
    nextTourStep();
    expect(currentStep(tourStore.getState().index, tourTargets.getState().rects)?.id).toBe('terminal');
    nextTourStep();
    expect(supportStore.getState().touredEditor).toBe(true);
  });

  it('skips for good, and can be replayed', () => {
    register('run', 'files');
    skipEditorTour();
    expect(supportStore.getState().touredEditor).toBe(true);
    resetEditorTour();
    expect(supportStore.getState().touredEditor).toBe(false);
    expect(tourStore.getState().index).toBe(0);
  });

  it('remembers the tour was seen across launches', async () => {
    const mem: Record<string, string> = {};
    const storage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v), removeItem: (k: string) => void delete mem[k] };
    createSupportStore(storage).getState().setTouredEditor(true);
    const next = createSupportStore(storage);
    await next.persist.rehydrate();
    expect(next.getState().touredEditor).toBe(true);
  });
});

describe('<EditorTour />', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays hidden unless a test opts in', async () => {
    register('run');
    await render(<EditorTour />);
    await act(() => jest.runOnlyPendingTimers());
    expect(screen.queryByTestId('editor-tour')).toBeNull();
  });

  it('shows the callout, counts steps and ends with Done', async () => {
    tourStore.setState({ enabled: true });
    register('run', 'palette');
    await render(<EditorTour />);
    await act(() => jest.runOnlyPendingTimers());
    expect(screen.getByText('1 OF 2')).toBeTruthy();
    expect(screen.getByText('Run your project')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('editor-tour-next'));
    expect(screen.getByText('Everything in one place')).toBeTruthy();
    expect(screen.queryByTestId('editor-tour-skip')).toBeNull();
    expect(screen.getByText('Done')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('editor-tour-next'));
    expect(screen.queryByTestId('editor-tour')).toBeNull();
    expect(supportStore.getState().touredEditor).toBe(true);
  });

  it('can be skipped from the first step', async () => {
    tourStore.setState({ enabled: true });
    register('run', 'files');
    await render(<EditorTour />);
    await act(() => jest.runOnlyPendingTimers());
    await fireEvent.press(screen.getByTestId('editor-tour-skip'));
    expect(screen.queryByTestId('editor-tour')).toBeNull();
    expect(supportStore.getState().touredEditor).toBe(true);
  });
});

describe('sample project names', () => {
  it('adds a number when the name is taken', () => {
    expect(uniqueProjectName('portfolio', [])).toBe('portfolio');
    expect(uniqueProjectName('portfolio', ['portfolio'])).toBe('portfolio-2');
    expect(uniqueProjectName('portfolio', ['Portfolio', 'portfolio-2'])).toBe('portfolio-3');
  });
});
