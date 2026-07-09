// Turns an ordered list of checklist items into display segments: consecutive
// items sharing the same category collapse into one section; items without a
// category stay as standalone entries, rendered exactly as before.
export function buildDisplaySegments(items, getCategory) {
    const segments = [];

    for (const item of items) {
        const category = getCategory(item);
        if (!category) {
            segments.push({ type: 'item', item });
            continue;
        }

        const last = segments[segments.length - 1];
        if (last && last.type === 'category' && last.name === category) {
            last.items.push(item);
        } else {
            segments.push({ type: 'category', name: category, items: [item] });
        }
    }

    return segments;
}
