import { defineManifest } from '@crxjs/vite-plugin';
export default defineManifest({
    manifest_version: 3,
    name: 'Zen Tab',
    description: 'A calm, fast workspace for your browser tabs.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['tabs', 'tabGroups', 'sidePanel', 'storage'],
    optional_permissions: ['scripting'],
    optional_host_permissions: ['<all_urls>', 'https://api.groq.com/*'],
    background: {
        service_worker: 'src/background/service-worker.ts',
        type: 'module',
    },
    action: {
        default_title: 'Open Zen Tab',
        default_icon: {
            16: 'icons/zen-tab-16.png',
            32: 'icons/zen-tab-32.png',
        },
    },
    icons: {
        16: 'icons/zen-tab-16.png',
        32: 'icons/zen-tab-32.png',
        48: 'icons/zen-tab-48.png',
        128: 'icons/zen-tab-128.png',
    },
    side_panel: {
        default_path: 'sidepanel.html',
    },
});
