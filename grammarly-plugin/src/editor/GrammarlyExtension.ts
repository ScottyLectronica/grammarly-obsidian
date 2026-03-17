import { RangeSetBuilder, Extension } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { GrammarlyAlert } from '../api/GrammarlyClient';

class GrammarlyPluginValue {
    decorations: DecorationSet;
    alerts: GrammarlyAlert[] = [];

    constructor(view: EditorView) {
        this.decorations = Decoration.none;
    }

    update(update: ViewUpdate) {
        if (update.docChanged) {
            // Map decorations as the user types — this is the authoritative position source
            this.decorations = this.decorations.map(update.changes);
        }
    }

    setAlerts(newAlerts: GrammarlyAlert[], docLen?: number) {
        this.alerts = newAlerts;
        this.buildDecorations(docLen);
    }

    clearAlerts() {
        this.alerts = [];
        this.decorations = Decoration.none;
    }

    /**
     * Returns the CURRENT [from, to] document positions for the given alert ID
     * by reading directly from the maintained DecorationSet.
     * This is always accurate because decorations.map(changes) is called on every
     * document change, making this more reliable than posAtDOM.
     */
    getPosForAlert(alertId: number): [number, number] | null {
        let result: [number, number] | null = null;
        this.decorations.between(0, 1e9, (from, to, value) => {
            if ((value.spec as any).attributes?.['data-alert-id'] === alertId.toString()) {
                result = [from, to];
                return false; // stop iteration
            }
        });
        return result;
    }

    private buildDecorations(docLen?: number) {
        const builder = new RangeSetBuilder<Decoration>();

        // Sort alerts by begin index as required by RangeSetBuilder
        const sortedAlerts = [...this.alerts].sort((a, b) => a.begin - b.begin);

        for (const alert of sortedAlerts) {
            let { begin, end } = alert;
            const isInsertion = begin >= end;
            if (isInsertion) {
                end = begin + 1; // Extend zero-length ranges to make them visible
            }

            // Ensure the range is within the current document bounds
            if (docLen !== undefined && end > docLen) continue;
            if (begin >= 0 && end > begin) {
                builder.add(
                    begin,
                    end,
                    Decoration.mark({
                        class: `grammarly-error grammarly-${alert.impact}`,
                        attributes: {
                            'data-alert-id': alert.id.toString(),
                            'data-title': alert.title,
                            'data-explanation': alert.explanation || '',
                            'data-category': alert.category || '',
                            'data-impact': alert.impact || '',
                            'data-is-insertion': isInsertion.toString(),
                            'data-replacements': JSON.stringify(
                                Array.isArray(alert.replacements)
                                    ? alert.replacements.filter((r: any) => typeof r === 'string')
                                    : []
                            )
                        }
                    })
                );
            }
        }

        this.decorations = builder.finish();
    }
}

export const grammarlyViewPlugin = ViewPlugin.fromClass(GrammarlyPluginValue, {
    decorations: (v) => v.decorations
});

export const grammarlyAlertsExtension: Extension = [
    grammarlyViewPlugin
];
