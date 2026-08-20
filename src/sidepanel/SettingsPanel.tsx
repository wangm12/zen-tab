import { useEffect, useState } from 'react';
import { Check, Info, LockKeyhole, Tag } from 'lucide-react';
import { ensureBuiltInLanguageModel, getBuiltInAiStatus, isAbortError, BuiltInAiStatus } from '../shared/ai';
import { AUTO_DISCARD_MINUTES } from '../shared/discard';
import { AutoDiscardMinutes, ZenTabSettings } from '../shared/types';
import { Translator } from './i18n';
import { ModalFrame, Toggle } from './ui';

const builtInCopy: Record<BuiltInAiStatus, 'builtInAiUnsupported' | 'builtInAiUnavailable' | 'builtInAiDownloadable' | 'builtInAiDownloading' | 'builtInAiAvailable'> = {
  unsupported: 'builtInAiUnsupported',
  unavailable: 'builtInAiUnavailable',
  downloadable: 'builtInAiDownloadable',
  downloading: 'builtInAiDownloading',
  available: 'builtInAiAvailable',
};

export function SettingsPanel({ settings, hasCloudApiKey, t, onClose, onUpdate, onUpdateProvider, onUpdateCloudKey, onRequestDeepScanAll, onRequestDiscardInspect, onClearProjectMemory }: {
  settings: ZenTabSettings;
  hasCloudApiKey: boolean;
  t: Translator;
  onClose: () => void;
  onUpdate: (patch: Partial<ZenTabSettings>) => Promise<void>;
  onUpdateProvider: (provider: ZenTabSettings['aiProvider'], baseUrl?: string) => Promise<void>;
  onUpdateCloudKey: (apiKey: string) => Promise<void>;
  onRequestDeepScanAll: (enabled: boolean) => Promise<void>;
  onRequestDiscardInspect: (enabled: boolean) => Promise<void>;
  onClearProjectMemory: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState('');
  const [protectedDomains, setProtectedDomains] = useState(settings.protectedDomains.join(', '));
  const [ignoredDomains, setIgnoredDomains] = useState(settings.ignoredDomains.join(', '));
  const [baseUrl, setBaseUrl] = useState(settings.openaiBaseUrl);
  const [model, setModel] = useState(settings.openaiModel);
  const [builtInStatus, setBuiltInStatus] = useState<BuiltInAiStatus>('unsupported');
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadController, setDownloadController] = useState<AbortController | null>(null);
  useEffect(() => { void getBuiltInAiStatus().then(setBuiltInStatus); }, []);
  useEffect(() => {
    if (builtInStatus !== 'downloading' && !downloading) return;
    const timer = window.setInterval(() => { void getBuiltInAiStatus().then(setBuiltInStatus); }, 1000);
    return () => window.clearInterval(timer);
  }, [builtInStatus, downloading]);
  const safelyUpdate = (patch: Partial<ZenTabSettings>) => { void onUpdate(patch).catch(() => undefined); };
  const safelyUpdateProvider = (provider: ZenTabSettings['aiProvider']) => { void onUpdateProvider(provider, baseUrl).catch(() => undefined); };
  const safelyRequestDeepScan = (enabled: boolean) => { void onRequestDeepScanAll(enabled).catch(() => undefined); };
  const downloadModel = async () => {
    const controller = new AbortController();
    setDownloadController(controller);
    setDownloading(true);
    setDownloadPercent(0);
    try {
      const session = await ensureBuiltInLanguageModel((percent) => {
        if (!controller.signal.aborted) {
          setDownloadPercent(percent);
          setBuiltInStatus('downloading');
        }
      }, controller.signal);
      if (controller.signal.aborted) return;
      session.destroy?.();
      setDownloadPercent(100);
      setBuiltInStatus(await getBuiltInAiStatus());
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      setBuiltInStatus(await getBuiltInAiStatus());
    } finally {
      setDownloadController(null);
      setDownloading(false);
    }
  };
  const cancelDownload = () => {
    downloadController?.abort();
    setDownloadController(null);
    setDownloading(false);
    void getBuiltInAiStatus().then(setBuiltInStatus);
  };
  const showDownloadProgress = downloading || builtInStatus === 'downloading' || downloadPercent != null;
  return <ModalFrame eyebrow={t('controlRoom')} title={t('settings')} description={t('settingsDescription')} closeLabel={t('close')} onClose={onClose} footer={<button className="primary-button" onClick={onClose}>{t('done')} <Check size={15} /></button>}>
    <div className="settings-section"><div className="settings-heading"><div><label htmlFor="language-select"><strong>{t('language')}</strong></label><span>{t('languageDescription')}</span></div><select id="language-select" className="inline-select" value={settings.language} onChange={(event) => safelyUpdate({ language: event.target.value as ZenTabSettings['language'] })}><option value="en">English</option><option value="zh">中文</option></select></div></div>
    <div className="settings-section"><div className="settings-heading"><div><label htmlFor="theme-select"><strong>{t('theme')}</strong></label><span>{t('themeDescription')}</span></div><select id="theme-select" className="inline-select" value={settings.theme} onChange={(event) => safelyUpdate({ theme: event.target.value as ZenTabSettings['theme'] })}><option value="system">{t('systemTheme')}</option><option value="light">{t('lightTheme')}</option><option value="dark">{t('darkTheme')}</option></select></div></div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('duplicateGuard')}</strong><span>{t('catchRepeated')}</span></div><Toggle label={t('duplicateGuard')} checked={settings.duplicateEnabled} onChange={(checked) => safelyUpdate({ duplicateEnabled: checked })} /></div><label className="select-field"><span>{t('matchScope')}</span><select value={settings.duplicateScope} onChange={(event) => safelyUpdate({ duplicateScope: event.target.value as ZenTabSettings['duplicateScope'] })}><option value="all-normal-windows">{t('allNormalWindows')}</option><option value="same-window">{t('currentWindowOnly')}</option></select></label>
      <label className="field-label" htmlFor="ignored-domains">{t('ignoredDomains')}<input id="ignored-domains" value={ignoredDomains} onChange={(event) => setIgnoredDomains(event.target.value)} onBlur={() => safelyUpdate({ ignoredDomains: ignoredDomains.split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean) })} placeholder={t('ignoredDomainsPlaceholder')} /></label>
      <p className="settings-hint">{t('ignoredDomainsDescription')}</p>
    </div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('incognitoWindows')}</strong><span>{t('incognitoWindowsDescription')}</span></div><Toggle label={t('incognitoWindows')} checked={settings.incognitoEnabled} onChange={(checked) => safelyUpdate({ incognitoEnabled: checked })} /></div></div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('deepScanAll')}</strong><span>{t('deepScanDescription')}</span></div><Toggle label={t('deepScanAll')} checked={settings.deepAnalysisEnabled} onChange={safelyRequestDeepScan} /></div><div className="privacy-note"><LockKeyhole size={14} /><span>{t('deepScanPrivacy')}</span></div></div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('autoDiscard')}</strong><span>{t('autoDiscardDescription')}</span></div><Toggle label={t('autoDiscard')} checked={settings.autoDiscardEnabled} onChange={(checked) => safelyUpdate({ autoDiscardEnabled: checked })} /></div>
      {settings.autoDiscardEnabled && <>
        <label className="select-field"><span>{t('autoDiscardAfter')}</span><select value={settings.autoDiscardMinutes} onChange={(event) => safelyUpdate({ autoDiscardMinutes: Number(event.target.value) as AutoDiscardMinutes })}>{AUTO_DISCARD_MINUTES.map((minutes) => <option key={minutes} value={minutes}>{t(minutes === 15 ? 'minutes15' : minutes === 30 ? 'minutes30' : minutes === 60 ? 'minutes60' : 'minutes120')}</option>)}</select></label>
        <div className="settings-heading inspect-toggle"><div><strong>{t('autoDiscardInspect')}</strong><span>{t('autoDiscardInspectDescription')}</span></div><Toggle label={t('autoDiscardInspect')} checked={settings.autoDiscardInspectPages} onChange={(checked) => { void onRequestDiscardInspect(checked).catch(() => undefined); }} /></div>
      </>}
    </div>
    <div className="settings-section"><div className="settings-heading"><div><strong>{t('aiProvider')}</strong><span>{t('localAutomatic')}</span></div><select className="inline-select" value={settings.aiProvider} onChange={(event) => safelyUpdateProvider(event.target.value as ZenTabSettings['aiProvider'])}><option value="local">{t('localAutomatic')}</option><option value="openai-compatible">{t('openaiCompatible')}</option></select></div>
      <div className="privacy-note"><LockKeyhole size={14} /><span>{t('builtInAi')}: {t(builtInCopy[builtInStatus])}</span></div>
      {showDownloadProgress && <div className="model-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPercent ?? 0} aria-label={t('builtInAiDownloadProgress', { percent: downloadPercent ?? 0 })}>
        <div className="model-progress-bar"><span style={{ width: `${downloadPercent ?? 0}%` }} /></div>
        <small>{t('builtInAiDownloadProgress', { percent: downloadPercent ?? 0 })}</small>
        {downloading && <button type="button" className="text-button" onClick={cancelDownload}>{t('cancel')}</button>}
      </div>}
      {builtInStatus === 'downloadable' && !downloading && <button type="button" className="text-button" onClick={() => void downloadModel()}>{t('builtInAiDownload')}</button>}
      {settings.aiProvider === 'openai-compatible' && <>
        <label className="field-label" htmlFor="openai-base-url">{t('openaiBaseUrl')}<input id="openai-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} onBlur={() => { if (baseUrl.trim()) void onUpdateProvider('openai-compatible', baseUrl.trim()); }} /></label>
        <p className="settings-hint">{t('openaiHint')}</p>
        <label className="field-label" htmlFor="openai-model">{t('openaiModel')}<input id="openai-model" value={model} onChange={(event) => setModel(event.target.value)} onBlur={() => { if (model.trim()) safelyUpdate({ openaiModel: model.trim() }); }} /></label>
        <label className="field-label" htmlFor="openai-api-key">{t('openaiApiKey')}<input id="openai-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onBlur={() => { if (apiKey.trim()) void onUpdateCloudKey(apiKey.trim()); }} placeholder={hasCloudApiKey ? t('savedLocally') : 'sk-…'} /></label>
        {hasCloudApiKey && <button className="text-button key-clear" type="button" onClick={() => { setApiKey(''); void onUpdateCloudKey(''); }}>{t('clearApiKey')}</button>}
        <div className="privacy-note"><LockKeyhole size={14} /><span>{t('openaiPrivacy')}</span></div>
      </>}
    </div>
    <div className="settings-section"><div className="settings-heading"><div><label htmlFor="protected-domains"><strong>{t('protectedDomains')}</strong></label><span>{t('protectedDomainsDescription')}</span></div><Tag size={16} className="section-icon" /></div><input id="protected-domains" className="full-input" value={protectedDomains} onChange={(event) => setProtectedDomains(event.target.value)} onBlur={() => safelyUpdate({ protectedDomains: protectedDomains.split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean) })} placeholder={t('protectedDomainsPlaceholder')} /></div>
    <div className="settings-section memory-settings"><div className="settings-heading"><div><strong>{t('clearProjectMemory')}</strong><span>{t('clearProjectMemoryDescription')}</span></div><button className="text-button danger-outline" type="button" onClick={() => void onClearProjectMemory()}>{t('clearProjectMemory')}</button></div></div>
    <div className="settings-footnote"><Info size={14} /> {t('settingsFootnote')}</div>
  </ModalFrame>;
}
