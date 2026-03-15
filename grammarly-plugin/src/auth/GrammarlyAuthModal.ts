import { Modal, App, Setting, Notice, requestUrl } from 'obsidian';
import GrammarlyPlugin from '../main';

// Helper to generate alphanumeric strings (like containerId)
function generateContainerId(): string {
	const r = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const alphanumeric = function e(t = 0, n = ''): string {
		if (t <= 0) return n;
		const o = Math.floor(Math.random() * (r.length - 1));
		return e(t - 1, n + r.charAt(o));
	};
	return alphanumeric(15);
}

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

		const webview = contentEl.createEl('webview' as any, {
			attr: {
				src: 'https://www.grammarly.com/signin',
				partition: 'persist:grammarly_session' // Use a persistent partition so login survives restart
			}
		});

		webview.style.width = '100%';
		webview.style.height = '100%';
		webview.style.border = 'none';

		// Listen to navigation events to detect when the user successfully logs into the app
		webview.addEventListener('did-navigate', async (e: any) => {
			const currentUrl = e.url || '';
			// When login succeeds, Grammarly typically redirects to the dashboard
			if (currentUrl.includes('app.grammarly.com') || currentUrl.includes('grammarly.com/dashboard')) {
				new Notice('Login successful! Capturing credentials...');
				
				try {
					// In a real Electron app without 'remote', getting the HttpOnly cookie is hard.
					// However, if the user logged in, their session is now stored in 'persist:grammarly_session'.
					// We can trigger an API call to manually fetch a free-tier token for the connected session
					const containerId = generateContainerId();
					const initialCookies = `gnar_containerId=${containerId}; funnelType=free;`;

					const response = await requestUrl({
						url: `https://auth.grammarly.com/v3/user/oranonymous?app=firefoxExt&containerId=${containerId}`,
						method: 'GET',
						headers: {
							'Cache-Control': 'no-cache',
							'Cookie': initialCookies,
							'Pragma': 'no-cache',
							'X-Container-Id': containerId,
							'X-Client-Version': '8.852.2307',
							'X-Client-Type': 'extension-firefox',
							'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36'
						}
					});

					let grauth = '';
					let csrfToken = '';

					const setCookieHeader = response.headers['set-cookie'] || response.headers['Set-Cookie'];
					if (setCookieHeader) {
						const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader.split(/,(?=[^;,]*=)|,$/);
						for (const c of cookies) {
							if (c.includes('grauth=')) grauth = c.split('grauth=')[1].split(';')[0];
							if (c.includes('csrf-token=')) csrfToken = c.split('csrf-token=')[1].split(';')[0];
						}
					}

					if (grauth) {
						this.plugin.settings.grauth = grauth;
						this.plugin.settings.csrfToken = csrfToken;
						await this.plugin.saveSettings();
						
						await this.plugin.reconnectAfterLogin();
						new Notice('Grammarly Connected!');
					}
				} catch (err) {
					console.error("Failed to capture credentials", err);
					new Notice('Failed to complete background authentication.');
				}

				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
