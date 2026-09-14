import { useState } from 'react';
import { Check, LockKeyhole, Trash2 } from 'lucide-react';
import { displayHostname } from '../shared/url';
import { CleanupProposal } from '../shared/types';
import { Translator } from './i18n';
import { ModalFrame } from './ui';

export function CleanupModal({ proposal, t, onClose, onApply }: { proposal: CleanupProposal; t: Translator; onClose: () => void; onApply: (tabIds: number[]) => Promise<void> }) {
  const safeCandidates = proposal.candidates.filter((candidate) => !candidate.protected);
  const [selected, setSelected] = useState(new Set(safeCandidates.filter((candidate) => candidate.confidence !== 'low').map((candidate) => candidate.tabId)));
  const apply = async () => onApply([...selected]);
  return <ModalFrame eyebrow={t('lowValueScan')} title={t('possibleCleanups', { count: safeCandidates.length })} description={t('nothingCloses')} closeLabel={t('close')} onClose={onClose}>
    <div className="confidence-banner amber"><LockKeyhole size={16} /><span><strong>{t('protectedPages')}</strong> · {t('conservative')}</span></div>
    <div className="cleanup-list">{proposal.candidates.map((candidate) => <label className={candidate.protected ? 'cleanup-item protected' : 'cleanup-item'} key={candidate.tabId}>
      <span className="check-wrap">{candidate.protected ? <LockKeyhole size={15} /> : <><input type="checkbox" checked={selected.has(candidate.tabId)} onChange={() => setSelected((previous) => { const next = new Set(previous); if (next.has(candidate.tabId)) next.delete(candidate.tabId); else next.add(candidate.tabId); return next; })} /><span className="fake-check"><Check size={12} /></span></>}</span>
      <span className="cleanup-copy"><strong>{candidate.title || t('untitledTab')}</strong><span>{candidate.reason}</span><small>{displayHostname(candidate.url)} · {candidate.evidence.join(' ')}</small></span>
      <span className={`confidence ${candidate.confidence}`}>{candidate.confidence === 'high' ? t('strongMatch') : candidate.confidence === 'medium' ? t('possibleMatch') : t('needsReview')}</span>
    </label>)}</div>
    {safeCandidates.length === 0 && <div className="empty-modal"><div className="empty-orbit"><Check size={20} /></div><strong>{t('noSafeCleanup')}</strong><p>{t('contextIntentional')}</p></div>}
    <div className="modal-actions"><button className="text-button" onClick={onClose}>{t('leaveEverything')}</button><button className="primary-button danger-button" disabled={selected.size === 0} onClick={() => void apply()}>{t('close')} {t('tabsCount', { count: selected.size })} <Trash2 size={15} /></button></div>
  </ModalFrame>;
}
