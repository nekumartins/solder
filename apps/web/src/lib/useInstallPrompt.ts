import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Android and desktop hand us an install event; iOS never does, so it gets
 * the "Add to Home Screen" instruction instead.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const ios = isIos();
  return {
    available: !installed && (deferred !== null || ios),
    ios,
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    },
  };
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
