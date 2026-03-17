import { Plugin, PluginSettingTab, App, Setting, Notice, MarkdownView, TFile } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { GrammarlyAuthModal } from './auth/GrammarlyAuthModal';
import { GrammarlyClient, GrammarlyAlert } from './api/GrammarlyClient';
import { grammarlyAlertsExtension, grammarlyViewPlugin } from './editor/GrammarlyExtension';
import { grammarlyHoverTooltip, setGrammarlyDismissHandler, destroyGrammarlyTooltip } from './editor/GrammarlyTooltip';


interface GrammarlyPluginSettings {
	grauth: string;
	csrfToken: string;
	/** Dismissed alert fingerprints keyed by file path. */
	dismissed: Record<string, string[]>;
}

const DEFAULT_SETTINGS: GrammarlyPluginSettings = {
	grauth: '',
	csrfToken: '',
	dismissed: {}
};

interface NoteSession {
	client: GrammarlyClient;
	alerts: GrammarlyAlert[];
	lastActive: number;   // Date.now() — used for LRU eviction
}

// Maximum number of simultaneous WebSocket connections.
// Oldest inactive sessions are disconnected (alerts kept in memory) beyond this.
const MAX_LIVE_SESSIONS = 5;


export default class GrammarlyPlugin extends Plugin {
	settings: GrammarlyPluginSettings;

	private sessions = new Map<string, NoteSession>();
	private activeFilePath = '';
	private activeClient: GrammarlyClient | null = null;
	private statusBarEl: HTMLElement;


	async onload() {
		await this.loadSettings();

		this.statusBarEl = this.addStatusBarItem();
		this.setStatus('off');

		// Dismiss handler: persist the fingerprint and remove from active display
		setGrammarlyDismissHandler((alertId) => {
			const session = this.sessions.get(this.activeFilePath);
			if (!session) return;
			const alert = session.alerts.find(a => a.id === alertId);
			if (alert) this.persistDismiss(this.activeFilePath, alert);
			session.alerts = session.alerts.filter(a => a.id !== alertId);
			this.syncAlertsToEditor();
		});

		// CM6 update listener — forwards precise ChangeSet deltas to the active client
		// and keeps session.alerts positions in sync so syncAlertsToEditor() never
		// rebuilds decorations at stale (pre-edit) offsets.
		const changeListener = EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;

			if (this.activeClient) {
				this.activeClient.onDocChanged(
					update.changes as any,
					update.startState.doc.length,
					update.state.doc.toString()
				);
			}

			// Map every cached alert position through the document change so
			// the positions stay accurate even if syncAlertsToEditor() is called
			// before Grammarly sends updated alerts.
			const session = this.sessions.get(this.activeFilePath);
			if (session && session.alerts.length > 0) {
				for (const alert of session.alerts) {
					alert.begin = update.changes.mapPos(alert.begin, -1);
					alert.end   = update.changes.mapPos(alert.end,    1);
				}
			}
		});

		this.registerEditorExtension([
			grammarlyAlertsExtension,
			grammarlyHoverTooltip,
			changeListener
		]);

		// Activate the note that is already open when the plugin loads
		if (this.settings.grauth && this.settings.csrfToken) {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file) {
				this.activateNote(view.file.path, view.editor.getValue());
			}
		}

		// Switch sessions when the user opens a different note
		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				if (!file) return;
				if (file.extension !== 'md') return;
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return;
				this.activateNote(file.path, view.editor.getValue());
			})
		);

		// Commands
		this.addCommand({
			id: 'login-to-grammarly',
			name: 'Login to Grammarly',
			callback: () => new GrammarlyAuthModal(this.app, this).open()
		});

		this.addCommand({
			id: 'connect-grammarly',
			name: 'Connect to Grammarly',
			callback: async () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) return new Notice('Open a note first.');
				await this.activateNote(view.file.path, view.editor.getValue());
				new Notice('Connected to Grammarly!');
			}
		});

		this.addCommand({
			id: 'reanalyse-grammarly',
			name: 'Re-analyse with Grammarly',
			callback: async () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) return new Notice('Open a note first.');
				const session = this.sessions.get(this.activeFilePath);
				if (session) {
					session.alerts = [];
					session.client.disconnect();
					this.syncAlertsToEditor();
				}
				await this.activateNote(view.file.path, view.editor.getValue());
				new Notice('Re-analysing with Grammarly…');
			}
		});

		this.addCommand({
			id: 'clear-dismissed-grammarly',
			name: 'Clear dismissed Grammarly suggestions for this note',
			callback: async () => {
				if (!this.activeFilePath) return;
				delete this.settings.dismissed[this.activeFilePath];
				await this.saveSettings();
				// Re-analyse so dismissed alerts come back
				const session = this.sessions.get(this.activeFilePath);
				if (session) {
					session.alerts = [];
					session.client.disconnect();
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) this.activateNote(this.activeFilePath, view.editor.getValue());
				}
				new Notice('Dismissed suggestions cleared — re-analysing…');
			}
		});

		this.addSettingTab(new GrammarlySettingTab(this.app, this));
	}

	onunload() {
		destroyGrammarlyTooltip();
		for (const session of this.sessions.values()) {
			session.client.disconnect();
		}
		this.sessions.clear();
	}


	/**
	 * Switch the active session to `filePath`.
	 * - If we have a cached session, show its alerts immediately.
	 * - If the client is not connected, connect and submit the document text.
	 * - LRU-evict the oldest idle connection if we're at the limit.
	 */
	private async activateNote(filePath: string, text: string) {
		// Save last-active timestamp for the outgoing session
		const outgoing = this.sessions.get(this.activeFilePath);
		if (outgoing) outgoing.lastActive = Date.now();

		this.activeFilePath = filePath;

		// Get or create session
		let session = this.sessions.get(filePath);
		if (!session) {
			const client = new GrammarlyClient(this.settings.grauth, this.settings.csrfToken);
			session = { client, alerts: [], lastActive: Date.now() };
			this.sessions.set(filePath, session);
			this.attachClientHandlers(client, filePath);
		} else {
			session.lastActive = Date.now();
		}

		this.activeClient = session.client;

		// Reflect current connection state for the newly active note
		if (!session.client.isConnected()) {
			this.setStatus('off');
		} else if (session.alerts.length > 0) {
			this.setStatus('ready');
		} else {
			this.setStatus('analyzing');
		}

		// Show whatever we already know about this note instantly
		this.syncAlertsToEditor();

		// Connect if needed, then submit text
		if (!session.client.isConnected()) {
			this.evictOldestIdleIfNeeded();
			try {
				await session.client.connect();
				session.client.submitInitialText(text);
			} catch (e) {
				console.error('Grammarly: failed to connect for', filePath, e);
			}
		}
	}

	private attachClientHandlers(client: GrammarlyClient, filePath: string) {
		client.on('alert', (raw: unknown) => {
			const session = this.sessions.get(filePath);
			if (!session) return;
			const alert = raw as GrammarlyAlert;
			if (this.isDismissed(filePath, alert)) return;
			// Upsert: Grammarly reuses alert IDs when it updates a suggestion.
			// Pushing without deduplication creates duplicate decorations that
			// cause posAtDOM to find the wrong span and corrupt text on apply.
			const idx = session.alerts.findIndex(a => a.id === alert.id);
			if (idx >= 0) session.alerts[idx] = alert;
			else session.alerts.push(alert);
			if (filePath === this.activeFilePath) this.syncAlertsToEditor();
		});

		client.on('remove', (id: unknown) => {
			const session = this.sessions.get(filePath);
			if (!session) return;
			session.alerts = session.alerts.filter(a => a.id !== id);
			if (filePath === this.activeFilePath) this.syncAlertsToEditor();
		});

		client.on('clear', () => {
			const session = this.sessions.get(filePath);
			if (!session) return;
			session.alerts = [];
			if (filePath === this.activeFilePath) this.syncAlertsToEditor();
		});

		client.on('ready', () => {
			if (filePath === this.activeFilePath) this.setStatus('analyzing');
		});

		client.on('finished', () => {
			if (filePath === this.activeFilePath) this.setStatus('ready');
		});

		client.on('close', () => {
			if (filePath === this.activeFilePath) this.setStatus('off');
		});
	}

	/** Disconnect the oldest idle (non-active) session to stay under the limit. */
	private evictOldestIdleIfNeeded() {
		const connected = [...this.sessions.entries()]
			.filter(([path, s]) => path !== this.activeFilePath && s.client.isConnected());

		if (connected.length >= MAX_LIVE_SESSIONS) {
			connected.sort(([, a], [, b]) => a.lastActive - b.lastActive);
			connected[0][1].client.disconnect();
		}
	}


	/**
	 * Fingerprint = rule point + flagged text.
	 * Unique enough to identify "this specific issue on this specific word"
	 * without being so specific it never matches on reconnect.
	 */
	private fingerprint(alert: GrammarlyAlert): string {
		return `${alert.point}::${alert.text}`;
	}

	private isDismissed(filePath: string, alert: GrammarlyAlert): boolean {
		return this.settings.dismissed[filePath]?.includes(this.fingerprint(alert)) ?? false;
	}

	private async persistDismiss(filePath: string, alert: GrammarlyAlert) {
		const fp = this.fingerprint(alert);
		if (!this.settings.dismissed[filePath]) {
			this.settings.dismissed[filePath] = [];
		}
		if (!this.settings.dismissed[filePath].includes(fp)) {
			this.settings.dismissed[filePath].push(fp);
			await this.saveSettings();
		}
	}


	private setStatus(state: 'off' | 'analyzing' | 'ready') {
		const labels = { off: 'Grammarly ○', analyzing: 'Grammarly ◌', ready: 'Grammarly ●' };
		this.statusBarEl.setText(labels[state]);
		this.statusBarEl.setAttribute('aria-label', {
			off: 'Grammarly: not connected',
			analyzing: 'Grammarly: analysing…',
			ready: 'Grammarly: suggestions ready'
		}[state]);
	}


	private syncAlertsToEditor() {
		const alerts = this.sessions.get(this.activeFilePath)?.alerts ?? [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				const editor = leaf.view.editor as any;
				if (editor.cm) {
					const plugin = editor.cm.plugin(grammarlyViewPlugin);
					if (plugin) {
						plugin.setAlerts(alerts, editor.cm.state.doc.length);
						editor.cm.requestMeasure();
					}
				}
			}
		});
	}


	/** Called by GrammarlyAuthModal after new credentials are saved to settings. */
	public async reconnectAfterLogin() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;
		const existing = this.sessions.get(view.file.path);
		if (existing) {
			existing.client.disconnect();
			this.sessions.delete(view.file.path);
		}
		await this.activateNote(view.file.path, view.editor.getValue());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!this.settings.dismissed) this.settings.dismissed = {};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}


class GrammarlySettingTab extends PluginSettingTab {
	plugin: GrammarlyPlugin;

	constructor(app: App, plugin: GrammarlyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Grammarly' });

		const loggedIn = !!(this.plugin.settings.grauth && this.plugin.settings.csrfToken);

		new Setting(containerEl)
			.setName('Account')
			.setDesc(loggedIn ? '✅ Logged in' : '❌ Not logged in')
			.addButton(btn => btn
				.setButtonText(loggedIn ? 'Switch account' : 'Login')
				.setCta()
				.onClick(() => new GrammarlyAuthModal(this.app, this.plugin).open())
			)
			.addButton(btn => btn
				.setButtonText('Sign out')
				.setWarning()
				.setDisabled(!loggedIn)
				.onClick(async () => {
					this.plugin.settings.grauth    = '';
					this.plugin.settings.csrfToken = '';
					await this.plugin.saveSettings();
					// Disconnect all sessions
					for (const session of (this.plugin as any).sessions.values()) {
						session.client.disconnect();
					}
					(this.plugin as any).sessions.clear();
					(this.plugin as any).activeClient = null;
					new Notice('Signed out of Grammarly.');
					this.display(); // refresh settings panel
				})
			);

		new Setting(containerEl)
			.setName('Active sessions')
			.setDesc(
				`Grammarly keeps up to ${MAX_LIVE_SESSIONS} notes connected simultaneously. ` +
				`Older inactive connections are paused automatically; alerts are cached so ` +
				`switching back to a note shows suggestions instantly.`
			);

		new Setting(containerEl)
			.setName('Clear all dismissed suggestions')
			.setDesc('Restores every suggestion you have ever dismissed across all notes.')
			.addButton(btn => btn
				.setButtonText('Clear all')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.dismissed = {};
					await this.plugin.saveSettings();
					new Notice('All dismissed suggestions cleared.');
				})
			);
	}
}
