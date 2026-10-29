// Home screen quick actions (long-press the app icon): New project and the
// recent projects. Each carries an href that the router opens.
import { router } from 'expo-router';
import * as QuickActions from 'expo-quick-actions';

import { projectsStore, tabsStore } from '../../state';
import { quickActions } from './links';

const hrefOf = (action: QuickActions.Action | undefined) => (typeof action?.params?.href === 'string' ? action.params.href : null);

let handledInitial = false;

// True when the app was launched from a quick action; navigates there once.
export function launchedFromQuickAction(): boolean {
  const href = hrefOf(QuickActions.initial);
  if (!href || handledInitial) return false;
  handledInitial = true;
  router.navigate(href as never);
  return true;
}

// Keeps the menu in step with recent projects, and follows actions picked
// while the app is running. Returns a function that stops both.
export function startQuickActions(): () => void {
  let last = '';
  const sync = () => {
    const actions = quickActions(tabsStore.getState().recent, projectsStore.getState().projects, QuickActions.maxCount ?? 4);
    const key = JSON.stringify(actions);
    if (key === last) return;
    last = key;
    QuickActions.setItems(actions).catch(() => undefined);
  };
  sync();
  const unsubscribe = [tabsStore.subscribe(sync), projectsStore.subscribe(sync)];
  const listener = QuickActions.addListener((action) => {
    const href = hrefOf(action);
    if (href) router.navigate(href as never);
  });
  return () => {
    unsubscribe.forEach((u) => u());
    listener.remove();
  };
}
