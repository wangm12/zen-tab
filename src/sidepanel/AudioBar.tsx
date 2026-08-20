import { Volume2 } from 'lucide-react';
import { TabRecord } from '../shared/types';
import { Translator } from './i18n';

export function AudioBar({ tabs, t, onActivate, onMuteAll }: { tabs: TabRecord[]; t: Translator; onActivate: (tab: TabRecord) => void; onMuteAll: () => void }) {
  if (!tabs.length) return null;
  const first = tabs[0];
  return <div className="audio-bar" role="status">
    <button className="audio-jump" onClick={() => onActivate(first)} title={t('jumpToAudio')}>
      <Volume2 size={14} />
      <span><strong>{t('playingNow')}</strong><small>{first.title || t('untitledTab')}{tabs.length > 1 ? ` · +${tabs.length - 1}` : ''}</small></span>
    </button>
    <button className="text-button" type="button" onClick={onMuteAll}>{t('muteAllAudio')}</button>
  </div>;
}
