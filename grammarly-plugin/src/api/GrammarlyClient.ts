import { Events, debounce } from 'obsidian';
import WebSocketNode from 'ws';

export interface GrammarlyAlert {
	id: number;
	begin: number;
	end: number;
	text: string;
	title: string;
	details: string;
	explanation: string;
	todo: string;
	replacements: string[];
	transformJson: any;
	impact: string;
	category: string;
	point: string;   // rule identifier e.g. "GeneralPrepositionGEC"
}

/**
 * Structural type matching CM6's ChangeSet interface.
 * Avoids importing @codemirror/state here; we only need these two methods.
 */
interface CMChangeSet {
	iterChanges(
		f: (
			fromA: number,
			toA: number,
			fromB: number,
			toB: number,
			inserted: { toString(): string }
		) => void
	): void;
	compose(other: CMChangeSet): CMChangeSet;
}

/**
 * Returns the character length of the YAML frontmatter block at the start of
 * `text` (including both delimiter lines and their newlines), or 0 if there is
 * no frontmatter.
 *
 * Grammarly's server strips frontmatter before analysing, so alert positions
 * are relative to the post-frontmatter text.  We track this offset and use it
 * to (a) send only the body to Grammarly and (b) translate alert positions back
 * to CM6 document coordinates before the decorations are painted.
 */
function detectFrontmatterLength(text: string): number {
	if (!text.startsWith('---')) return 0;
	const firstNewline = text.indexOf('\n');
	if (firstNewline === -1) return 0;
	// Opening line must be exactly "---"
	if (text.slice(0, firstNewline).replace(/\r$/, '') !== '---') return 0;

	let pos = firstNewline + 1;
	while (pos < text.length) {
		const nextNewline = text.indexOf('\n', pos);
		const lineEnd     = nextNewline === -1 ? text.length : nextNewline;
		const line        = text.slice(pos, lineEnd).replace(/\r$/, '');

		if (line === '---' || line === '...') {
			// Include the closing delimiter line (and its newline if present)
			return nextNewline === -1 ? text.length : nextNewline + 1;
		}
		if (nextNewline === -1) return 0; // unclosed frontmatter — treat as absent
		pos = nextNewline + 1;
	}
	return 0;
}

export class GrammarlyClient extends Events {
	private ws: any = null;
	private messageId = 0;
	private grauth: string;
	private csrfToken: string;
	private docId = '';
	private connectPromise: Promise<void> | null = null;

	private serverRev = 0;
	private serverDocLen = 0;
	private serverReady = false;
	private contextSent = false;

	private waitingForAck = false;
	private inflightDocLen = 0;

	private pendingChanges: CMChangeSet | null = null;
	private pendingDocLen = 0;
	private pendingDocText = '';

	/**
	 * Length (in characters) of the YAML frontmatter in the current document.
	 *
	 * Grammarly receives only the body text (text after the frontmatter), so all
	 * positions it returns are relative to the body.  We add this offset when
	 * emitting alerts so that CM6 receives correct document positions.
	 *
	 * NOTE: not reset on reconnect — the frontmatter belongs to the document,
	 * not to the connection.
	 */
	private frontmatterOffset = 0;

	private readonly debouncedFlush = debounce(() => this.flush(), 400, false);

	constructor(grauth: string, csrfToken: string) {
		super();
		this.grauth = grauth;
		this.csrfToken = csrfToken;
	}

	public isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === 1 /* OPEN */;
	}

	public connect(): Promise<void> {
		if (this.ws && (this.ws.readyState === 1 || this.ws.readyState === 0)) {
			return Promise.resolve();
		}
		if (this.connectPromise) {
			return this.connectPromise;
		}

		return this.connectPromise = new Promise<void>((resolve, reject) => {
			try {
				this.docId = Array.from({ length: 32 }, () =>
					Math.floor(Math.random() * 16).toString(16)
				).join('');

				// Reset all state on every fresh connection
				this.serverRev = 0;
				this.serverDocLen = 0;
				this.serverReady = false;
				this.contextSent = false;
				this.waitingForAck = false;
				this.inflightDocLen = 0;
				this.pendingChanges = null;
				this.messageId = 0;
				// frontmatterOffset intentionally NOT reset — it belongs to the doc.

				const cookieStr =
					`gnar_containerId=${this.grauth.substring(0, 10)}; ` +
					`grauth=${this.grauth}; csrf-token=${this.csrfToken}`;

				const headers = {
					'Accept': 'application/json',
					'User-Agent':
						'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
						'AppleWebKit/537.36 (KHTML, like Gecko) ' +
						'Chrome/114.0.0.0 Safari/537.36',
					'Cookie': cookieStr,
					'Origin': 'https://www.grammarly.com'
				};

				try {
					this.ws = new WebSocketNode('wss://capi.grammarly.com/freews', { headers });
				} catch (err) {
					console.error('Grammarly: failed to instantiate WebSocket', err);
					this.connectPromise = null;
					reject(err);
					return;
				}

				this.ws.on('open', () => {
					this.ws.send(JSON.stringify({
						action: 'start',
						client: 'generic-check',
						clientSubtype: 'general',
						clientVersion: '1.0.0',
						dialect: 'american',
						docid: this.docId,
						id: this.messageId++,
						clientSupports: [
							'alerts_changes',
							'alerts_update',
							'completions',
							'free_clarity_alerts',
							'free_inline_advanced_alerts',
							'full_sentence_rewrite_card',
							'super_alerts',
							'text_info',
							'tone_cards'
						]
					}));
					this.connectPromise = null;
					resolve();
				});

				this.ws.on('message', (data: any) => {
					try {
						const msg = JSON.parse(data.toString());
						this.handleMessage(msg);
					} catch {
						// ignore malformed messages
					}
				});

				this.ws.on('error', (err: any) => {
					console.error('Grammarly WS error:', err);
					reject(err);
				});

				this.ws.on('close', (code: number, reason: Buffer) => {
					this.ws = null;
					this.waitingForAck = false;
					this.serverReady = false;
					this.trigger('close');
				});

			} catch (err) {
				console.error('Grammarly: unexpected error during connect', err);
				reject(err);
			}
		});
	}

	public disconnect(): void {
		if (this.ws) {
			try { this.ws.close(); } catch { /* ignore */ }
			this.ws = null;
		}
	}

	/**
	 * Called on every keystroke.  `changes` is in CM6 coordinate space (full
	 * document including frontmatter); `newText` is the full document text.
	 */
	public onDocChanged(changes: CMChangeSet, oldDocLen: number, newText: string): void {
		const body = newText.slice(this.frontmatterOffset);
		this.pendingDocText = body;
		this.pendingDocLen  = body.length;

		this.pendingChanges =
			this.pendingChanges === null
				? changes
				: this.pendingChanges.compose(changes);

		this.debouncedFlush();
	}

	/**
	 * Call once when a note is first activated.  Strips frontmatter, stores the
	 * offset, and queues a full-document bootstrap send.
	 */
	public submitInitialText(text: string): void {
		this.frontmatterOffset = detectFrontmatterLength(text);
		const body = text.slice(this.frontmatterOffset);

		this.pendingChanges = null;
		this.pendingDocText = body;
		this.pendingDocLen  = body.length;
		this.debouncedFlush();
	}

	private flush(): void {
		if (!this.ws || this.ws.readyState !== 1) {
			if (!this.connectPromise) {
				this.connect()
					.then(() => { /* start ACK will trigger flush */ })
					.catch(() => { /* ignore; user will see no suggestions */ });
			}
			return;
		}

		// Wait for the 'start' handshake before sending any OT
		if (!this.serverReady) return;

		// One OT at a time; compose further changes until ACK arrives
		if (this.waitingForAck) return;

		let ops: any[];
		let newDocLen: number;
		let isBootstrap = false;

		if (this.serverDocLen === 0 && this.pendingDocText.length > 0) {
			// Bootstrap: send the full body as a single insert
			ops        = [{ insert: this.pendingDocText }];
			newDocLen  = this.pendingDocText.length;
			this.pendingChanges = null;
			isBootstrap = true;

		} else if (this.pendingChanges !== null) {
			ops       = this.changeSetToOTOps(this.pendingChanges, this.serverDocLen);
			newDocLen = this.pendingDocLen;
			this.pendingChanges = null;

		} else {
			return; // nothing to send
		}

		if (isBootstrap) {
			this.trigger('clear');
		}

		const otMsg = {
			id:      this.messageId++,
			action:  'submit_ot',
			rev:     this.serverRev,
			doc_len: this.serverDocLen,
			deltas:  [{ ops }],
			chunked: false
		};
		this.ws.send(JSON.stringify(otMsg));

		this.inflightDocLen  = newDocLen;
		this.waitingForAck   = true;
	}

	/**
	 * Converts a CM6 ChangeSet to Grammarly OT ops.
	 *
	 * `changes` positions are in CM6 space (full document including frontmatter).
	 * `oldDocLen` is in Grammarly space (body only = serverDocLen).
	 * We subtract `frontmatterOffset` from every position and skip changes that
	 * fall entirely within the frontmatter.
	 */
	private changeSetToOTOps(changes: CMChangeSet, oldDocLen: number): any[] {
		const ops: any[] = [];
		const fo = this.frontmatterOffset;
		let cursor = 0; // position in Grammarly's coordinate space

		changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
			// Skip changes entirely inside the frontmatter
			if (toA <= fo) return;

			// Convert from CM6 space → Grammarly space
			const gFromA = Math.max(0, fromA - fo);
			const gToA   = toA - fo; // toA > fo guaranteed by the guard above

			if (gFromA > cursor) {
				ops.push({ retain: gFromA - cursor });
			}
			if (gToA > gFromA) {
				ops.push({ delete: gToA - gFromA });
			}
			const text = inserted.toString();
			if (text.length > 0) {
				ops.push({ insert: text });
			}
			cursor = gToA;
		});

		// oldDocLen is already in Grammarly space (serverDocLen = body length)
		if (cursor < oldDocLen) {
			ops.push({ retain: oldDocLen - cursor });
		}

		return ops;
	}

	private handleMessage(msg: any): void {
		switch (msg.action) {
			case 'start':
				this.serverReady = true;
				this.trigger('ready');
				if (this.pendingDocText.length > 0 || this.pendingChanges !== null) {
					this.flush();
				}
				break;

			case 'submit_ot':
				this.serverRev    = msg.rev;
				this.serverDocLen = this.inflightDocLen;
				this.waitingForAck = false;

				if (!this.contextSent) {
					this.contextSent = true;
					const ctxMsg = {
						id:     this.messageId++,
						action: 'set_context',
						rev:    this.serverRev,
						documentContext: {
							audience: 'knowledgeable',
							dialect:  'american',
							domain:   'general',
							emotions: [],
							goals:    [],
							style:    'neutral'
						}
					};
					this.ws?.send(JSON.stringify(ctxMsg));
				}

				if (this.pendingChanges !== null ||
					(this.serverDocLen === 0 && this.pendingDocText.length > 0)) {
					this.flush();
				}
				break;

			case 'alert': {
				const alert = msg as GrammarlyAlert;
				// Translate from Grammarly's body-relative coordinates back to
				// CM6 document coordinates by adding the frontmatter offset.
				alert.begin += this.frontmatterOffset;
				alert.end   += this.frontmatterOffset;
				this.trigger('alert', alert);
				break;
			}

			case 'remove':
				this.trigger('remove', msg.id);
				break;

			case 'finished':
				this.trigger('finished');
				break;
		}
	}
}
