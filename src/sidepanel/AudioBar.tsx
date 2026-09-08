import { Globe2, Volume2 } from 'lucide-react';
import { displayHostname } from '../shared/url';
import { TabRecord } from '../shared/types';
import { Translator } from './i18n';

export function AudioBar({ tabs, t, onActivate, onMuteAll }: { tabs: TabRecord[]; t: Translator; onActivate: (tab: TabRecord) => void; onMuteAll: () => void }) {
  if (!tabs.length) return null;
  return (
    <div className="audio-bar" role="status">
      <div className="audio-bar-header">
        <span className="audio-bar-label"><Volume2 size={14} aria-hidden="true" />{t('playingNow')}</span>
        <button className="text-button" type="button" onClick={onMuteAll}>{t('muteAllAudio')}</button>
      </div>
      <div className="audio-list">
        {tabs.map((tab) => {
          const title = tab.title || t('untitledTab');
          const host = displayHostname(tab.url);
          const jumpLabel = `${t('jumpToAudio')}: ${title}`;
          return (
            <button key={tab.tabId} className={tab.muted ? 'audio-jump muted' : 'audio-jump'} type="button" onClick={() => onActivate(tab)} title={jumpLabel} aria-label={jumpLabel}>
              {tab.favIconUrl
                ? <img src={tab.favIconUrl} alt="" className="audio-favicon" />
                : <Globe2 size={16} aria-hidden="true" />}
              <span className="audio-jump-copy">
                <strong>{title}</strong>
                <small>{host}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
