import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useZenTabStore } from './store';
import './styles.css';

function Root() {
  const load = useZenTabStore((state) => state.load);
  const applyEvent = useZenTabStore((state) => state.applyEvent);
  const theme = useZenTabStore((state) => state.snapshot?.settings.theme ?? 'system');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void load();
    const listener = (message: unknown) => {
      if (message && typeof message === 'object' && 'type' in message) applyEvent(message as Parameters<typeof applyEvent>[0]);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [applyEvent, load]);

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
