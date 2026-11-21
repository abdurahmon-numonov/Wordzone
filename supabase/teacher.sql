-- Wordzone v2.56 — раздел «Для учителя»: домашки в аккаунте учителя и результаты учеников.
-- Запустить ОДИН раз: Supabase → проект Wordzone → SQL Editor → вставить весь файл → Run.
-- Повторный запуск ничего не ломает (всё через "if not exists" / "or replace").
-- Требует уже существующий schema.sql (аккаунты). Ничего из старых таблиц не меняет.
--
-- Что создаётся:
--   1. homework          — домашки учителя (видит и меняет только сам учитель).
--   2. homework_results  — результаты учеников (видит только учитель этой домашки).
--   3. submit_homework_result(...) — единственный способ для ученика отправить результат:
--      без регистрации, только в существующую домашку, с проверкой всех чисел.
--      Ученик НЕ может читать ни домашки, ни чужие результаты.

-- ---------- 1. Домашки ----------
create table if not exists public.homework (
  id          uuid        primary key,                       -- создаётся на сайте и зашит в ссылку
  teacher_id  uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  title       text        not null check (char_length(title) between 1 and 60),
  source      text        not null check (source ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  target      text        not null check (target ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  n           int         not null default 0 check (n between 0 and 300),   -- сколько слов
  due         date,                                                          -- «выучить до», можно пусто
  link        text        not null check (char_length(link) <= 9000),
  created_at  timestamptz not null default now()
);
create index if not exists homework_teacher_idx on public.homework (teacher_id, created_at desc);

alter table public.homework enable row level security;
drop policy if exists "homework: read own"   on public.homework;
drop policy if exists "homework: insert own" on public.homework;
drop policy if exists "homework: update own" on public.homework;
drop policy if exists "homework: delete own" on public.homework;
create policy "homework: read own"   on public.homework for select to authenticated using (teacher_id = auth.uid());
create policy "homework: insert own" on public.homework for insert to authenticated with check (teacher_id = auth.uid());
create policy "homework: update own" on public.homework for update to authenticated using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy "homework: delete own" on public.homework for delete to authenticated using (teacher_id = auth.uid());
revoke all on public.homework from anon;

-- ---------- 2. Результаты учеников ----------
-- Одна строка на ученика в домашке (ученика узнаём по случайному ключу его устройства).
-- Каждая тренировка прибавляет ответы, поэтому видно, сколько ученик реально занимался.
create table if not exists public.homework_results (
  homework_id  uuid        not null references public.homework (id) on delete cascade,
  student_key  text        not null check (student_key ~ '^[A-Za-z0-9-]{8,64}$'),
  student_name text        not null check (char_length(student_name) between 1 and 40),
  answered     int         not null default 0 check (answered >= 0),
  correct      int         not null default 0 check (correct between 0 and answered),
  words        int         not null default 0 check (words between 0 and 300),   -- больше всего слов за одну тренировку
  attempts     int         not null default 1 check (attempts >= 1),             -- сколько раз занимался
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  primary key (homework_id, student_key)
);

alter table public.homework_results enable row level security;
drop policy if exists "results: teacher reads"   on public.homework_results;
drop policy if exists "results: teacher deletes" on public.homework_results;
create policy "results: teacher reads" on public.homework_results for select to authenticated
  using (exists (select 1 from public.homework h where h.id = homework_id and h.teacher_id = auth.uid()));
create policy "results: teacher deletes" on public.homework_results for delete to authenticated
  using (exists (select 1 from public.homework h where h.id = homework_id and h.teacher_id = auth.uid()));
-- Писать напрямую не может никто: только через функцию ниже.
revoke insert, update on public.homework_results from anon, authenticated;
revoke all on public.homework_results from anon;

-- ---------- 3. Отправка результата учеником ----------
create or replace function public.submit_homework_result(
  p_homework uuid, p_student text, p_name text, p_answered int, p_correct int, p_words int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g'));
begin
  if not exists (select 1 from homework where id = p_homework) then
    raise exception 'unknown homework' using errcode = 'P0002';
  end if;
  if p_student is null or p_student !~ '^[A-Za-z0-9-]{8,64}$' then raise exception 'bad student' using errcode = '22023'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'bad name' using errcode = '22023'; end if;
  -- одна тренировка: не больше 2000 ответов, верных не больше, чем всего
  if p_answered is null or p_answered not between 1 and 2000 then raise exception 'bad answered' using errcode = '22023'; end if;
  if p_correct is null or p_correct not between 0 and p_answered then raise exception 'bad correct' using errcode = '22023'; end if;
  if p_words is null or p_words not between 0 and 300 then raise exception 'bad words' using errcode = '22023'; end if;
  -- защита от спама: не больше 500 учеников на одну домашку
  if (select count(*) from homework_results where homework_id = p_homework) >= 500
     and not exists (select 1 from homework_results where homework_id = p_homework and student_key = p_student) then
    raise exception 'homework is full' using errcode = '53400';
  end if;

  insert into homework_results (homework_id, student_key, student_name, answered, correct, words)
  values (p_homework, p_student, v_name, p_answered, p_correct, p_words)
  on conflict (homework_id, student_key) do update set
    student_name = excluded.student_name,
    answered     = least(homework_results.answered + excluded.answered, 1000000),
    correct      = least(homework_results.correct  + excluded.correct, least(homework_results.answered + excluded.answered, 1000000)),
    words        = greatest(homework_results.words, excluded.words),
    attempts     = homework_results.attempts + 1,
    last_at      = now();
end $$;

revoke all on function public.submit_homework_result(uuid, text, text, int, int, int) from public;
grant execute on function public.submit_homework_result(uuid, text, text, int, int, int) to anon, authenticated;
