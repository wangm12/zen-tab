import { Globe2, Volume2 } from 'lucide-react';
import { TabRecord } from '../shared/types';
import { Translator } from './i18n';

export function AudioBar({ tabs, t, onActivate, onMuteAll }: { tabs: TabRecord[]; t: Translator; onActivate: (tab: TabRecord) => void; onMuteAll: () => void }) {
  if (!tabs.length) return null;
  return (
    <div className="audio-bar" role="region" aria-label={t('playingNow')}>
      <Volume2 size={13} className="audio-bar-icon" aria-hidden="true" />
      <div className="audio-chips">
        {tabs.map((tab) => {
          const title = tab.title || t('untitledTab');
          const jumpLabel = `${t('jumpToAudio')}: ${title}`;
          return (
            <button key={tab.tabId} className={tab.muted ? 'audio-chip muted' : 'audio-chip'} type="button" onClick={() => onActivate(tab)} title={jumpLabel} aria-label={jumpLabel}>
              {tab.favIconUrl
                ? <img src={tab.favIconUrl} alt="" className="audio-favicon" />
                : <Globe2 size={14} aria-hidden="true" />}
              <span className="audio-chip-title">{title}</span>
            </button>
          );
        })}
      </div>
      <button className="text-button audio-mute-all" type="button" onClick={onMuteAll}>{t('muteAllAudio')}</button>
    </div>
  );
}
