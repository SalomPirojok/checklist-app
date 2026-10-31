import { useModule } from '../context/ModuleContext';
import { hapticSelect } from '../lib/haptics';

// Segmented "Kontrolla | CRM" control in the header; renders nothing for
// users who only have Kontrolla.
export default function ModuleSwitcher() {
    const { crmAccess, mode, setMode } = useModule();
    if (!crmAccess) return null;

    function choose(next) {
        if (next === mode) return;
        hapticSelect();
        setMode(next);
    }

    return (
        <div className="module-switcher" role="tablist" aria-label="Модуль">
            <button
                type="button"
                role="tab"
                aria-selected={mode === 'kontrolla'}
                className={mode === 'kontrolla' ? 'module-switcher__item module-switcher__item--active' : 'module-switcher__item'}
                onClick={() => choose('kontrolla')}
            >
                Kontrolla
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={mode === 'crm'}
                className={mode === 'crm' ? 'module-switcher__item module-switcher__item--active' : 'module-switcher__item'}
                onClick={() => choose('crm')}
            >
                CRM
            </button>
        </div>
    );
}
