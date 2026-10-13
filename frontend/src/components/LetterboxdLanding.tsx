'use client';

import LoadingScreen from '@/components/landing/LoadingScreen';
import ScrapeStoryWait from '@/components/landing/ScrapeStoryWait';
import WrappedLanding from '@/components/landing/WrappedLanding';
import { useLandingAnalysis } from '@/components/landing/useLandingAnalysis';

export default function LetterboxdLanding({
  showUsernameScrape = true,
}: {
  showUsernameScrape?: boolean;
} = {}) {
  const flow = useLandingAnalysis({ showUsernameScrape, allowPhoneUpload: true });

  if (flow.isUploading) {
    return <LoadingScreen onCancel={flow.handleCancel} typicalSeconds={45} />;
  }

  if (flow.isScraping) {
    return (
      <ScrapeStoryWait
        username={flow.activeScrapeUsername}
        onCancel={flow.handleCancel}
        queued={(flow.scrapeProgress?.queue_position ?? 0) > 1 || flow.scrapeProgress?.stage === 'queued'}
        events={flow.scrapeProgress?.trace_events}
        resultReady={flow.scrapeResultReady}
        onStoryReady={flow.handleStoryReady}
        queuePosition={flow.scrapeProgress?.queue_position}
        etaSeconds={flow.scrapeProgress?.eta_seconds}
      />
    );
  }

  return <WrappedLanding view={flow.view} />;
}
