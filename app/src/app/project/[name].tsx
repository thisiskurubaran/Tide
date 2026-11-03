import { Stack, useLocalSearchParams } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { launchParams } from '../../features/launch/links';
import { ProjectScreen } from '../../features/project/ProjectScreen';

export default function ProjectRoute() {
  const { name, file, line, run, send } = useLocalSearchParams<{ name: string; file?: string; line?: string; run?: string; send?: string }>();
  // On phones a swipe from the left edge opens the files, so the back swipe is
  // off here (the back button stays). iPad keeps it: the files are a sidebar.
  const wide = useWindowDimensions().width >= 768;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: wide }} />
      <ProjectScreen key={name} project={name} launch={launchParams({ file, line, run, send })} />
    </>
  );
}
