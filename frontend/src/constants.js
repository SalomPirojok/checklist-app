export const ROLE_LABELS = {
    owner: 'Владелец',
    manager: 'Управляющий',
    employee: 'Сотрудник',
};

export const STATUS_META = {
    not_started: { label: 'Не начато' },
    in_progress: { label: 'В процессе' },
    completed: { label: 'Выполнено' },
    overdue: { label: 'Просрочено' },
};

// Mirrors backend/src/lib/roles.js canActOnRole — client-side is UX only,
// the server is the real authorization boundary.
export function canActOnRole(actorRole, targetRole) {
    if (targetRole === 'owner') return false;
    if (targetRole === 'manager') return actorRole === 'owner';
    if (targetRole === 'employee') return actorRole === 'owner' || actorRole === 'manager';
    return false;
}
