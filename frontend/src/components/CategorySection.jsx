import { useState } from 'react';

export default function CategorySection({ name, items, doneCount, renderItem }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <li className="category-section">
            <button type="button" className="category-section__header" onClick={() => setCollapsed((c) => !c)}>
                <span>
                    {collapsed ? '▸' : '▾'} {name}
                </span>
                {doneCount !== undefined && (
                    <span className="hint">
                        {doneCount} из {items.length}
                    </span>
                )}
            </button>
            {!collapsed && <ul className="checklist-items checklist-items--nested">{items.map(renderItem)}</ul>}
        </li>
    );
}
