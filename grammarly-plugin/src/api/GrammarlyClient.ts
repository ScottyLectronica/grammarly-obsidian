import { Events, debounce } from 'obsidian';
import WebSocketNode from 'ws';
import { buildTextMapping, TextMapping } from '../utils/MarkdownStripper';

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
	point: string;
}

/**
 * Computes the minimal OT delta (retain / delete / insert ops) that transforms
 * `oldText` into `newText`.  Uses a simple common-prefix / common-suffix
 * approach — one contiguous change region, no fancy diff algorithm needed.
 */
function computeDelta(oldText: string, newText: string): any[] {
	const minLen = Math.min(oldText.length, newText.length);

	let prefix = 0;
	while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix++;

	let oldEnd = oldText.length;
	let newEnd = newText.length;
	while (oldEnd > prefix && newEnd > prefix &&
	       oldText[oldEnd - 1] === newText[newEnd - 1]) {
		oldEnd--;
		newEnd--;
	}

	const ops: any[] = [];
	if (prefix > 0)             ops.push({ retain: prefix });
	if (oldEnd > prefix)        ops.push({ delete: oldEnd - prefix });
	const ins = newText.slice(prefix, newEnd);
	if (ins.length > 0)         ops.push({ insert: ins });
	const suffix = oldText.length - oldEnd;
	if (suffix > 0)             ops.push({ retain: suffix });
	return ops;
}

export class GrammarlyClient extends Events {
	private ws: any = null;
	private messageId = 0;
	private grauth: string;
	private csrfToken: string;
	private docId = '';
	private connectPromise: Promise<void> | null = null;

	private serverRev      = 0;
	private serverDocLen   = 0;
	private serverReady    = false;
	private contextSent    = false;
	private waitingForAck  = false;

	/**
	 * The plain text currently on Grammarly's server (after markdown stripping).
	 * Updated when an OT ACK is received.
	 */
	private serverPlainText   = '';
	private inflightPlainText = '';

	/**
	 * The latest plain text we want the server to have.
	 * Set by submitInitialText() and onDocChanged().
	 */
	private pendingPlainText = '';

	/**
	 * Position mapping for the text currently on Grammarly's server.
	 * This is the mapping to use when converting alert positions — NOT
	 * the mapping for the latest local edit, which may be newer.
	 */
	private serverTextMapping:   TextMapping | null = null;
	private inflightTextMapping: TextMapping | null = null;

	/**
	 * The latest position mapping for the current local document state.
	 * grammarlyToOrig[grammarlyPos] = cm6Pos
	 */
	private textMapping: TextMapping | null = null;

	private readonly debouncedFlush = debounce(() => this.flush(), 400, false);

	constructor(grauth: string, csrfToken: string) {
		super();
		this.grauth    = grauth;
		this.csrfToken = csrfToken;
	}

	public isConnected(): boolean {
		return this.ws !== null && this.ws.readyState === 1;
	}

	public connect(): Promise<void> {
		if (this.ws && (this.ws.readyState === 1 || this.ws.readyState === 0)) {
			return Promise.resolve();
		}
		if (this.connectPromise) return this.connectPromise;

		return this.connectPromise = new Promise<void>((resolve, reject) => {
			try {
				this.docId = Array.from({ length: 32 }, () =>
					Math.floor(Math.random() * 16).toString(16)
				).join('');

				// Full state reset — the server starts a brand-new document
				this.serverRev          = 0;
				this.serverDocLen       = 0;
				this.serverPlainText    = '';
				this.inflightPlainText  = '';
				this.serverTextMapping  = null;
				this.inflightTextMapping = null;
				this.serverReady        = false;
				this.contextSent        = false;
				this.waitingForAck      = false;
				this.messageId          = 0;
				// textMapping and pendingPlainText intentionally kept —
				// they describe the document, not the connection.

				const cookieStr =
					`gnar_containerId=${this.grauth.substring(0, 10)}; ` +
					`grauth=${this.grauth}; csrf-token=${this.csrfToken}`;

				const headers = {
					'Accept':     'application/json',
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
					              'AppleWebKit/537.36 (KHTML, like Gecko) ' +
					              'Chrome/114.0.0.0 Safari/537.36',
					'Cookie':     cookieStr,
					'Origin':     'https://www.grammarly.com'
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
						action:         'start',
						client:         'generic-check',
						clientSubtype:  'general',
						clientVersion:  '1.0.0',
						dialect:        'american',
						docid:          this.docId,
						id:             this.messageId++,
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
						this.handleMessage(JSON.parse(data.toString()));
					} catch { /* ignore malformed */ }
				});

				this.ws.on('error', (err: any) => {
					console.error('Grammarly WS error:', err);
					reject(err);
				});

				this.ws.on('close', () => {
					this.ws            = null;
					this.waitingForAck = false;
					this.serverReady   = false;
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
	 * Called on every keystroke.  We only need the new full document text;
	 * the CM6 ChangeSet is accepted for interface compatibility but not used
	 * (we diff the plain-text representations instead).
	 */
	public onDocChanged(_changes: any, _oldDocLen: number, newText: string): void {
		const mapping       = buildTextMapping(newText);
		this.textMapping    = mapping;
		this.pendingPlainText = mapping.plainText;
		this.debouncedFlush();
	}

	/**
	 * Called once when a note is first activated.
	 * Builds the position mapping and queues the initial document send.
	 */
	public submitInitialText(text: string): void {
		const mapping         = buildTextMapping(text);
		this.textMapping      = mapping;
		this.pendingPlainText = mapping.plainText;
		this.debouncedFlush();
	}

	private flush(): void {
		if (!this.ws || this.ws.readyState !== 1) {
			if (!this.connectPromise) {
				this.connect()
					.then(() => { /* 'start' ACK will trigger flush */ })
					.catch(() => { /* ignore; no suggestions */ });
			}
			return;
		}
		if (!this.serverReady) return;
		if (this.waitingForAck)  return;

		const newPlain = this.pendingPlainText;

		let ops: any[];
		let isBootstrap = false;

		if (this.serverDocLen === 0 && newPlain.length > 0) {
			// First send: bootstrap the whole document
			ops         = [{ insert: newPlain }];
			isBootstrap = true;
		} else if (newPlain !== this.serverPlainText) {
			// Incremental: compute the minimal delta
			ops = computeDelta(this.serverPlainText, newPlain);
		} else {
			return; // nothing changed
		}

		if (isBootstrap) {
			this.trigger('clear');
			console.log('[Grammarly] Sending bootstrap plain text (' + newPlain.length + ' chars):\n' +
				newPlain.slice(0, 300) + (newPlain.length > 300 ? '…' : ''));
		}

		this.ws.send(JSON.stringify({
			id:      this.messageId++,
			action:  'submit_ot',
			rev:     this.serverRev,
			doc_len: this.serverDocLen,
			deltas:  [{ ops }],
			chunked: false
		}));

		this.inflightPlainText   = newPlain;
		this.inflightTextMapping = this.textMapping;
		this.waitingForAck       = true;
	}

	private handleMessage(msg: any): void {
		switch (msg.action) {

			case 'start':
				this.serverReady = true;
				this.trigger('ready');
				if (this.pendingPlainText.length > 0) this.flush();
				break;

			case 'submit_ot':
				this.serverRev          = msg.rev;
				this.serverDocLen       = this.inflightPlainText.length;
				this.serverPlainText    = this.inflightPlainText;
				this.serverTextMapping  = this.inflightTextMapping;
				this.waitingForAck      = false;

				if (!this.contextSent) {
					this.contextSent = true;
					this.ws?.send(JSON.stringify({
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
					}));
				}

				if (this.pendingPlainText !== this.serverPlainText) this.flush();
				break;

			case 'alert': {
				const alert   = msg as GrammarlyAlert;
				const gToO    = this.serverTextMapping?.grammarlyToOrig;
				const rawBegin = alert.begin;
				const rawEnd   = alert.end;
				if (gToO && gToO.length > 0) {
					// Convert Grammarly's plain-text positions to CM6 document positions.
					// Use serverTextMapping (the mapping for the text on Grammarly's server)
					// rather than the current local mapping which may be newer.
					const mapPos = (i: number): number => {
						if (i < gToO.length) return gToO[i];
						return gToO[gToO.length - 1] + (i - (gToO.length - 1));
					};
					alert.begin = mapPos(rawBegin);
					alert.end   = mapPos(rawEnd);
				}
				// Debug: verify the mapped text matches alert.text
				const plain = this.serverTextMapping?.plainText ?? this.serverPlainText;
				const rawText = plain.slice(rawBegin, rawEnd);
				const hBegin: number | undefined = (msg as any).highlightBegin;
				const hEnd:   number | undefined = (msg as any).highlightEnd;
				const hText = (hBegin !== undefined && hEnd !== undefined)
					? plain.slice(hBegin, hEnd) : undefined;
				if (alert.text !== undefined && rawText !== alert.text) {
					console.warn(
						`[Grammarly] Position mismatch! alert.text="${alert.text}" ` +
						`but plain[${rawBegin}..${rawEnd}]="${rawText}" | ` +
						`highlightText="${hText}" at [${hBegin}..${hEnd}] | ` +
						`mappingLen=${gToO?.length ?? 'none'}, plainLen=${plain.length}`
					);
				} else {
					const rep0 = (msg as any).replacements?.[0];
					console.log(
						`[Grammarly] alert #${alert.id} "${rawText}" ` +
						`raw=[${rawBegin},${rawEnd}] → cm6=[${alert.begin},${alert.end}] | ` +
						`highlight=[${hBegin},${hEnd}]="${hText}" | ` +
						`replacement(${typeof rep0})="${rep0}" | ` +
						`cat=${alert.category}`
					);
				}
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
