import { requireOptionalNativeModule } from 'expo';

// Absent on web, Android and in tests; callers treat that as "no widgets".
interface TideWidgetsModule {
  setSharedData(json: string): void;
  activitiesEnabled(): boolean;
  startDeployActivity(project: string, provider: string, message: string): Promise<string | null>;
  updateDeployActivity(id: string, state: 'deploying' | 'done' | 'failed', message: string, url: string | null): Promise<void>;
}

export default requireOptionalNativeModule<TideWidgetsModule>('TideWidgets');
