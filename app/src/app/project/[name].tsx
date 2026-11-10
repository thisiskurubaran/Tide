import { Stack, useLocalSearchParams } from 'expo-router';

import { launchParams } from '../../features/launch/links';
import { ProjectScreen } from '../../features/project/ProjectScreen';

export default function ProjectRoute() {
  const { name, file, line, run, tests, stop, send, show } = useLocalSearchParams<{ name: string; file?: string; line?: string; run?: string; tests?: string; stop?: string; send?: string; show?: string }>();
  // The system back swipe stays on everywhere. On phones the files drawer opens
  // from the Files button in the activity bar, or from a right swipe that starts
  // about 30pt in from the left edge (EDGE_INSET in ProjectScreen), so the two
  // gestures don't clash. iPad shows the files as a sidebar.
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: true }} />
      <ProjectScreen key={name} project={name} launch={launchParams({ file, line, run, tests, stop, send, show })} />
    </>
  );
}
