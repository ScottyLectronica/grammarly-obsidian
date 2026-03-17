import { Modal, App, Notice } from 'obsidian';
import GrammarlyPlugin from '../main';

export class GrammarlyAuthModal extends Modal {
	plugin: GrammarlyPlugin;

	constructor(app: App, plugin: GrammarlyPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText('Login to Grammarly');
		this.titleEl.style.textAlign = 'center';

		contentEl.empty();
		contentEl.addClass('grammarly-auth-modal');

		// Set modal size to be larger for the login window
		this.modalEl.style.width = '800px';
		this.modalEl.style.height = '600px';

		// Clear any existing Grammarly session so the user always gets a fresh
		// login screen — this lets them switch accounts without needing to
		// manually sign out first.
		try {
			const remote = require('@electron/remote');
			const ses = remote.session.fromPartition('persist:grammarly_session');
			ses.clearStorageData({ storages: ['cookies'] }).catch(() => {/* ignore */});
		} catch { /* ignore — webview will still open */ }

		const webview = contentEl.createEl('webview' as any, {
			attr: {
				src: 'https://www.grammarly.com/signin',
				// Persistent partition so the login session survives Obsidian restarts
				partition: 'persist:grammarly_session'
			}
		});

		webview.style.width = '100%';
		webview.style.height = '100%';
		webview.style.border = 'none';

		// Fired every time the webview completes a navigation.
		// Grammarly redirects to app.grammarly.com after a successful login.
		webview.addEventListener('did-navigate', async (e: any) => {
			const currentUrl: string = e.url || '';
			if (!currentUrl.includes('app.grammarly.com') && !currentUrl.includes('grammarly.com/dashboard')) {
				return;
			}

			new Notice('Login detected — capturing session…');

			try {
				// @electron/remote is bundled and initialised by Obsidian itself, so
				// require() here resolves to Obsidian's own copy without any extra setup.
				// We use it to read the HttpOnly cookies that Grammarly stored in the
				// webview's persistent partition — the exact tokens the WebSocket client needs.
				const remote = require('@electron/remote');
				const allCookies: any[] = await remote.session
					.fromPartition('persist:grammarly_session')
					.cookies.get({ domain: '.grammarly.com' });

				const grauth    = allCookies.find(c => c.name === 'grauth')?.value      ?? '';
				const csrfToken = allCookies.find(c => c.name === 'csrf-token')?.value  ?? '';

				if (!grauth) {
					// Cookies not present yet — wait for the session to fully settle
					// and let the user navigate manually if needed.
					new Notice('Session not ready yet. Please wait a moment and try again.');
					return;
				}

				this.plugin.settings.grauth    = grauth;
				this.plugin.settings.csrfToken = csrfToken;
				await this.plugin.saveSettings();
				await this.plugin.reconnectAfterLogin();

				new Notice('Grammarly connected!');
				this.close();

			} catch (err) {
				console.error('Grammarly: failed to capture session cookies', err);
				new Notice('Could not capture session. See developer console for details.');
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
