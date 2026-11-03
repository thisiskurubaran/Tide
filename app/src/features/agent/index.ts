// The agent's entry point for the rest of the app. Kept free of the agent's
// own modules, so importing it doesn't load the agent until it opens.
import { router } from 'expo-router';

export function openAgent(project: string) {
  router.push({ pathname: '/agent', params: { project } });
}
