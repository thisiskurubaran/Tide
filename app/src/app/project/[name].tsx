import { useLocalSearchParams } from 'expo-router';

import { ProjectScreen } from '../../features/project/ProjectScreen';

export default function ProjectRoute() {
  const { name } = useLocalSearchParams<{ name: string }>();
  return <ProjectScreen key={name} project={name} />;
}
