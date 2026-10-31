import { useLocalSearchParams } from 'expo-router';

import { launchParams } from '../../features/launch/links';
import { ProjectScreen } from '../../features/project/ProjectScreen';

export default function ProjectRoute() {
  const { name, file, line, run, send } = useLocalSearchParams<{ name: string; file?: string; line?: string; run?: string; send?: string }>();
  return <ProjectScreen key={name} project={name} launch={launchParams({ file, line, run, send })} />;
}
