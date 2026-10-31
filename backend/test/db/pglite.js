import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

// A throwaway in-process Postgres with every migration applied in order --
// the same SQL that gets pasted into Supabase, so tests exercise the real
// schema, triggers and functions without touching the live database.
export async function createMigratedDb() {
    const db = new PGlite();
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
        try {
            await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        } catch (err) {
            throw new Error(`Migration ${file} failed: ${err.message}`);
        }
    }
    return db;
}

export async function one(db, sql, params = []) {
    const { rows } = await db.query(sql, params);
    return rows[0];
}

// Creates an organization with an owner, CRM reference data, and returns
// handy ids (accounts and categories by key).
export async function createCrmOrg(db, name = 'Kamo Autoservice') {
    const org = await one(db, 'insert into organizations (name) values ($1) returning id', [name]);
    const owner = await one(
        db,
        "insert into users (telegram_id, full_name, role, organization_id) values ($1, 'Owner', 'owner', $2) returning id",
        [Math.floor(Math.random() * 1e9), org.id]
    );
    await db.query('select crm_seed_organization($1)', [org.id]);

    const { rows: accounts } = await db.query('select id, name from crm_accounts where organization_id = $1', [org.id]);
    const { rows: categories } = await db.query('select id, key from crm_service_categories where organization_id = $1', [org.id]);
    const client = await one(
        db,
        "insert into crm_clients (organization_id, first_name, phone) values ($1, 'Азиз', '+998901234567') returning id",
        [org.id]
    );
    return {
        orgId: org.id,
        ownerId: owner.id,
        clientId: client.id,
        account: Object.fromEntries(accounts.map((a) => [a.name, a.id])),
        category: Object.fromEntries(categories.map((c) => [c.key, c.id])),
    };
}
