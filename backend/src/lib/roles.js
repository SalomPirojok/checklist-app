// Who is allowed to create/edit/deactivate a user with a given target role.
// - owner accounts are never managed through the employees API (bootstrapped at signup only)
// - only an owner can manage manager accounts
// - owner or manager can manage employee accounts
export function canActOnRole(actorRole, targetRole) {
    if (targetRole === 'owner') return false;
    if (targetRole === 'manager') return actorRole === 'owner';
    if (targetRole === 'employee') return actorRole === 'owner' || actorRole === 'manager';
    return false;
}
