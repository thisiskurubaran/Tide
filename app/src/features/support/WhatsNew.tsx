import { useEffect, useState } from 'react';

import { appVersion } from './actions';
import { Release, unseenReleases } from './changelog';
import { supportStore } from './store';
import { WhatsNewSheet } from './WhatsNewSheet';

// Shows What's new once after an update. A fresh install just records the
// version, so the first launch isn't interrupted.
export function WhatsNewOnUpdate() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  useEffect(() => {
    const version = appVersion();
    const { seenVersion, seen, onboarded } = supportStore.getState();
    // The first-run tour covers the same ground; it wins.
    setReleases(onboarded ? unseenReleases(seenVersion, version) : []);
    seen(version);
  }, []);
  return <WhatsNewSheet releases={releases} onClose={() => setReleases(null)} />;
}
