import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, CircleHelp, Info, Sparkles } from 'lucide-react';
import { displayHostname } from '../shared/url';
import { GroupProposal, TabRecord } from '../shared/types';
import { Translator } from './i18n';
import { ModalFrame } from './ui';

export function GroupModal({ proposal, tabs, t, onChange, onClose, onApply }: { proposal: GroupProposal; tabs: TabRecord[]; t: Translator; onChange: (proposal: GroupProposal) => void; onClose: () => void; onApply: (selectedIndexes: number[]) => Promise<void> }) {
  const [selected, setSelected] = useState(new Set(proposal.groups.flatMap((group, index) => group.confidence === 'low' ? [] : [index])));
  const [applying, setApplying] = useState(false);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.tabId, tab])), [tabs]);
  useEffect(() => {
    setSelected((previous) => new Set([...previous].filter((index) => proposal.groups[index]?.tabIds.length >= 2)));
  }, [proposal.groups]);
  const confidenceCopy = {
    high: { label: t('strongMatch'), description: t('severalSignals') },
    medium: { label: t('possibleMatch'), description: t('someSignals') },
    low: { label: t('needsReview'), description: t('limitedContext') },
  } as const;
  const moveTab = (tabId: number, target: number | 'unclassified') => {
    const groups = proposal.groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((candidateId) => candidateId !== tabId), evidence: [...group.evidence] }));
    const unclassified = new Set(proposal.unclassifiedTabIds.filter((candidateId) => candidateId !== tabId));
    if (target === 'unclassified') unclassified.add(tabId);
    else if (groups[target]) groups[target].tabIds = [...groups[target].tabIds, tabId];
    onChange({ ...proposal, groups, unclassifiedTabIds: [...unclassified] });
    setSelected((previous) => new Set([...previous].filter((index) => groups[index]?.tabIds.length >= 2)));
  };
  const validSelected = [...selected].filter((index) => proposal.groups[index]?.tabIds.length >= 2);
  const apply = async () => { setApplying(true); await onApply(validSelected); setApplying(false); };
  return <ModalFrame eyebrow={t('projectMap')} title={t('suggestedGroups', { count: proposal.groups.length })} description={t('checkTabsEvidence')} closeLabel={t('close')} onClose={onClose}>
    <div className="confidence-banner"><Sparkles size={16} /><span><strong>{t('suggestionsToReview')}</strong> · {t('tabsNeedMoreContext', { count: proposal.unclassifiedTabIds.length })}</span><span className="confidence-note">{t('reviewBeforeApplying')}</span></div>
    <div className="proposal-list">{proposal.groups.map((group, index) => <div className={selected.has(index) ? 'proposal-group selected' : 'proposal-group'} key={`${group.name}-${index}`}>
      <div className="proposal-heading"><label className="check-wrap"><input type="checkbox" aria-label={t('selectGroup', { name: group.name })} checked={selected.has(index)} disabled={group.tabIds.length < 2} onChange={() => setSelected((previous) => { const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next; })} /><span className="fake-check"><Check size={12} /></span></label><input className="proposal-name" value={group.name} onChange={(event) => onChange({ ...proposal, groups: proposal.groups.map((item, groupIndex) => groupIndex === index ? { ...item, name: event.target.value } : item) })} /><span className={`confidence ${group.confidence}`} title={confidenceCopy[group.confidence].description} aria-label={`${confidenceCopy[group.confidence].label}: ${confidenceCopy[group.confidence].description}`}>{confidenceCopy[group.confidence].label}</span></div>
      <div className="proposal-tabs">{group.tabIds.map((tabId) => { const tab = tabsById.get(tabId); const title = tab?.title.trim() || t('untitledTab'); const host = tab ? displayHostname(tab.url) : t('pageNoLongerAvailable'); return <span key={tabId} className="proposal-tab" title={tab ? `${title}\n${tab.url}` : title}><span className="mini-dot" /><span className="proposal-tab-copy"><strong className="proposal-tab-title">{title}</strong><small className="proposal-tab-host">{host}</small></span><select className="proposal-move" defaultValue="" aria-label={`${t('moveTo')} ${title}`} onChange={(event) => { const value = event.target.value; if (value === 'unclassified') moveTab(tabId, 'unclassified'); else if (value !== '') moveTab(tabId, Number(value)); }}><option value="">{t('moveTo')}…</option>{proposal.groups.map((target, targetIndex) => targetIndex !== index ? <option key={targetIndex} value={targetIndex}>{target.name || t('untitledGroup')}</option> : null)}<option value="unclassified">{t('unclassified')}</option></select></span>; })}</div>
      <div className="evidence-line"><Info size={13} /> {group.evidence.map((evidence) => `${evidence.label}: ${evidence.detail}`).join(' · ')}</div>
    </div>)}</div>
    {proposal.unclassifiedTabIds.length > 0 && <div className="unclassified-note"><CircleHelp size={15} /><span>{t('keptAside', { count: proposal.unclassifiedTabIds.length })}</span></div>}
    <div className="modal-actions"><button className="text-button" onClick={onClose}>{t('keepAsIs')}</button><button className="primary-button" disabled={applying || validSelected.length === 0} onClick={() => void apply()}>{applying ? t('applying') : t('createGroups', { count: validSelected.length })} <ArrowUpRight size={15} /></button></div>
  </ModalFrame>;
}
