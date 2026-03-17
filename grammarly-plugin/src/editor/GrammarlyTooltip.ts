import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { grammarlyViewPlugin } from "./GrammarlyExtension";


let onDismiss: ((alertId: number) => void) | null = null;
export function setGrammarlyDismissHandler(fn: (id: number) => void) {
	onDismiss = fn;
}

/** Call from Plugin.onunload() to remove any lingering tooltip from the DOM. */
export function destroyGrammarlyTooltip() {
	activeTooltip?.remove();
	activeTooltip = null;
	activeTarget  = null;
	cancelHide();
	cancelShow();
}


function stripHtml(html: string): string {
	const div = document.createElement('div');
	div.innerHTML = html;
	return (div.textContent ?? '').trim();
}

function categoryColor(category: string, impact: string): string {
	const cat = category.toLowerCase();
	if (cat.includes('correct') || impact === 'critical') return '#df4b4b';
	if (cat.includes('clarity'))                           return '#1abc9c';
	if (cat.includes('engag'))                             return '#e67e22';
	if (cat.includes('deliver'))                           return '#9b59b6';
	if (cat.includes('style') || impact === 'mild')        return '#8e44ad';
	return '#1abc9c';
}


let activeTooltip: HTMLElement | null = null;
let activeTarget:  HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

function cancelHide() {
	if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
}
function cancelShow() {
	if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; }
}

function scheduleHide(immediate = false) {
	cancelHide();
	cancelShow();
	hideTimer = setTimeout(() => {
		activeTooltip?.remove();
		activeTooltip = null;
		activeTarget  = null;
	}, immediate ? 0 : 150);
}


function buildAndShow(target: HTMLElement, view: EditorView) {
	// Remove stale tooltip
	activeTooltip?.remove();
	activeTarget = target;

	const alertId        = parseInt(target.getAttribute('data-alert-id')  || '0', 10);
	const title          = target.getAttribute('data-title')               || 'Grammarly Suggestion';
	const explanationRaw = target.getAttribute('data-explanation')         || '';
	const category       = target.getAttribute('data-category')            || '';
	const impact         = target.getAttribute('data-impact')              || '';
	const color          = categoryColor(category, impact);
	const explanation    = stripHtml(explanationRaw);
	const isInsertion    = target.getAttribute('data-is-insertion') === 'true';

	let replacements: string[] = [];
	try {
		const parsed = JSON.parse(target.getAttribute('data-replacements') || '[]');
		if (Array.isArray(parsed)) replacements = parsed.filter((r): r is string => typeof r === 'string');
	} catch { /* skip */ }

	/**
	 * Get the current [from, to] document positions for this alert by reading
	 * from the DecorationSet, which is always kept up-to-date via
	 * decorations.map(update.changes) on every document change.
	 */
	function getLivePos(): [number, number] | null {
		const plugin = view.plugin(grammarlyViewPlugin);
		if (!plugin) return null;
		const pos = plugin.getPosForAlert(alertId);
		if (!pos) return null;
		const [from, to] = pos;
		// For insertions the decoration was extended by 1 char — don't delete that char
		const effectiveTo = isInsertion ? from : to;
		return [from, effectiveTo];
	}

	// Compute initial positions for diff display
	const initialPos = getLivePos();
	const begin = initialPos ? initialPos[0] : null;
	const end   = initialPos ? initialPos[1] : null;

	const dom = document.createElement('div');
	dom.className = 'grammarly-tooltip';
	dom.style.setProperty('--g-accent', color);

	// Keep tooltip alive while mouse is inside it
	dom.addEventListener('mouseenter', cancelHide);
	dom.addEventListener('mouseleave', () => scheduleHide());

	// Category badge
	if (category) {
		const badge = dom.createDiv({ cls: 'grammarly-badge' });
		badge.createSpan({ cls: 'grammarly-badge-dot' }).style.background = color;
		badge.createSpan({ cls: 'grammarly-badge-label', text: category });
	}

	// Diff block — only when we have a valid range AND a real replacement string
	const hasReplacement = replacements.length > 0;
	if (begin !== null && end !== null && begin < end && hasReplacement) {
		const docLen   = view.state.doc.length;
		const ctxStart = Math.max(0, begin - 50);
		const ctxEnd   = Math.min(docLen, end + 50);

		const diffEl = dom.createDiv({ cls: 'grammarly-diff' });
		if (ctxStart > 0) diffEl.createSpan({ cls: 'grammarly-diff-ellipsis', text: '…' });
		diffEl.createSpan({ cls: 'grammarly-diff-context',     text: view.state.doc.sliceString(ctxStart, begin) });
		diffEl.createSpan({ cls: 'grammarly-diff-original',    text: view.state.doc.sliceString(begin, end) });
		diffEl.createSpan({ cls: 'grammarly-diff-arrow',       text: ' → ' });
		diffEl.createSpan({ cls: 'grammarly-diff-replacement', text: replacements[0] });
		diffEl.createSpan({ cls: 'grammarly-diff-context',     text: view.state.doc.sliceString(end, ctxEnd) });
		if (ctxEnd < docLen) diffEl.createSpan({ cls: 'grammarly-diff-ellipsis', text: '…' });
	} else if (explanation) {
		dom.createDiv({ cls: 'grammarly-explanation', text: explanation });
	}

	if (explanation && hasReplacement) {
		dom.createDiv({ cls: 'grammarly-explanation', text: explanation });
	}

	// Action buttons
	const actions = dom.createDiv({ cls: 'grammarly-actions' });

	if (begin !== null && end !== null && begin < end && hasReplacement) {
		const applyBtn = actions.createEl('button', {
			cls: 'grammarly-btn-accept',
			text: replacements.length === 1 ? `Apply: "${replacements[0]}"` : 'Apply suggestion'
		});
		applyBtn.style.setProperty('--g-accent', color);
		applyBtn.onclick = () => {
			// Re-read from the DecorationSet at click time — positions may have
			// shifted if the user typed something after the tooltip opened.
			const clickPos = getLivePos();
			if (!clickPos) { scheduleHide(true); return; }
			view.dispatch({ changes: { from: clickPos[0], to: clickPos[1], insert: replacements[0] } });
			scheduleHide(true);
		};

		for (let i = 1; i < Math.min(replacements.length, 3); i++) {
			const altBtn = actions.createEl('button', { cls: 'grammarly-btn-alt', text: `"${replacements[i]}"` });
			const rep = replacements[i];
			altBtn.onclick = () => {
				const clickPos = getLivePos();
				if (!clickPos) { scheduleHide(true); return; }
				view.dispatch({ changes: { from: clickPos[0], to: clickPos[1], insert: rep } });
				scheduleHide(true);
			};
		}
	}

	const dismissBtn = actions.createEl('button', { cls: 'grammarly-btn-dismiss', text: 'Dismiss' });
	dismissBtn.onclick = () => { onDismiss?.(alertId); scheduleHide(true); };

	// Append hidden first so we can measure natural dimensions
	dom.style.cssText = 'position:fixed;visibility:hidden;z-index:9999';
	document.body.appendChild(dom);

	const targetRect = target.getBoundingClientRect();
	const tipRect    = dom.getBoundingClientRect();
	const GAP        = 8;
	const MARGIN     = 12;

	let top  = targetRect.top - tipRect.height - GAP;
	let left = targetRect.left;

	// Flip below if not enough room above
	if (top < MARGIN) top = targetRect.bottom + GAP;

	// Keep within right/left edges
	if (left + tipRect.width > window.innerWidth - MARGIN) left = window.innerWidth - tipRect.width - MARGIN;
	if (left < MARGIN) left = MARGIN;

	dom.style.top        = `${top}px`;
	dom.style.left       = `${left}px`;
	dom.style.visibility = 'visible';

	activeTooltip = dom;
}


export const grammarlyHoverTooltip: Extension = EditorView.domEventHandlers({
	mouseover(event, view) {
		const target = (event.target as HTMLElement).closest('.grammarly-error') as HTMLElement | null;

		if (!target) {
			// Moved off any error span — schedule hide unless already over tooltip
			const related = event.relatedTarget as HTMLElement | null;
			if (!related?.closest('.grammarly-tooltip')) scheduleHide();
			return;
		}

		if (target === activeTarget) {
			cancelHide();  // still over the same span
			return;
		}

		// New error span — show after a tiny delay so fast mouse movements don't flash
		cancelHide();
		cancelShow();
		showTimer = setTimeout(() => buildAndShow(target, view), 120);
	},

	mouseout(event) {
		const related = event.relatedTarget as HTMLElement | null;
		// Don't hide if moving into tooltip or into another error span
		if (related?.closest('.grammarly-tooltip') || related?.closest('.grammarly-error')) return;
		scheduleHide();
	}
});
