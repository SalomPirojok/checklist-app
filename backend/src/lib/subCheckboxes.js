// A checklist_template_items.sub_checkboxes value of [{id, label}, ...] gets
// snapshotted onto the assignment item as sub_checkbox_results ([{id, checked:
// false}, ...]) at assignment-creation time, so later edits to the template
// don't retroactively change an in-flight assignment's checklist.
export function buildInitialSubCheckboxResults(subCheckboxes) {
    return Array.isArray(subCheckboxes) && subCheckboxes.length > 0
        ? subCheckboxes.map((sc) => ({ id: sc.id, checked: false }))
        : null;
}

export function allSubCheckboxesChecked(subCheckboxResults) {
    return !Array.isArray(subCheckboxResults) || subCheckboxResults.length === 0 || subCheckboxResults.every((r) => r.checked);
}
