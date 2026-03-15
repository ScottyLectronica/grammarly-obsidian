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
            // Map decorations as the user types
            this.decorations = this.decorations.map(update.changes);
        }
    }

    setAlerts(newAlerts: GrammarlyAlert[]) {
        this.alerts = newAlerts;
        this.buildDecorations();
    }

    clearAlerts() {
        this.alerts = [];
        this.decorations = Decoration.none;
    }

    private buildDecorations() {
        const builder = new RangeSetBuilder<Decoration>();

        // Sort alerts by begin index as required by RangeSetBuilder
        const sortedAlerts = [...this.alerts].sort((a, b) => a.begin - b.begin);

        for (const alert of sortedAlerts) {
            let { begin, end } = alert;
            if (begin >= end) {
                end = begin + 1; // Fix zero-length ranges
            }

            // Ensure ranges are valid before building
            if (begin >= 0) {
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
                            'data-replacements': JSON.stringify(alert.replacements),
                            'data-begin': begin.toString(),
                            'data-end': end.toString()
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
