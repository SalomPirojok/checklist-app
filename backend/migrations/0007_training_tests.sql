-- Tests/exams attached to training materials (one test per material, MVP).
-- Single-correct-answer multiple choice only; unlimited retakes.

create table training_tests (
    id uuid primary key default gen_random_uuid(),
    material_id uuid not null unique references training_materials(id) on delete cascade,
    passing_score_percent int not null default 80,
    created_by uuid not null references users(id),
    created_at timestamptz not null default now()
);

create table training_test_questions (
    id uuid primary key default gen_random_uuid(),
    test_id uuid not null references training_tests(id) on delete cascade,
    question_text text not null,
    order_index int not null default 0
);

create index idx_training_test_questions_test_id on training_test_questions(test_id);

create table training_test_options (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null references training_test_questions(id) on delete cascade,
    option_text text not null,
    is_correct boolean not null default false,
    order_index int not null default 0
);

create index idx_training_test_options_question_id on training_test_options(question_id);

create table training_test_attempts (
    id uuid primary key default gen_random_uuid(),
    test_id uuid not null references training_tests(id) on delete cascade,
    user_id uuid not null references users(id),
    organization_id uuid not null references organizations(id) on delete cascade,
    score_percent int not null,
    passed boolean not null,
    created_at timestamptz not null default now()
);

create index idx_training_test_attempts_test_id on training_test_attempts(test_id);
create index idx_training_test_attempts_user_id on training_test_attempts(user_id);
create index idx_training_test_attempts_org_id on training_test_attempts(organization_id);

create table training_test_attempt_answers (
    id uuid primary key default gen_random_uuid(),
    attempt_id uuid not null references training_test_attempts(id) on delete cascade,
    question_id uuid not null references training_test_questions(id) on delete cascade,
    selected_option_id uuid references training_test_options(id),
    is_correct boolean not null
);

create index idx_training_test_attempt_answers_attempt_id on training_test_attempt_answers(attempt_id);
