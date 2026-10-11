# KLYVONA Connect — конструкция

Портал онбординга для израильского сервиса автоматизации соцсетей. Интерфейс на иврите, `dir="rtl"`. Клиент не вводит пароли соцсетей и не видит OAuth-токены.

Живой адрес: https://spring-orbit-honey-baker.grok.me

Этот репозиторий — исходники и описание сборки. Он не является деплоем. Последняя локальная сборка с дополнительными проверками продакшена на сайт ещё не выложена.

## Стек

| Слой | Реализация |
|---|---|
| UI | React 19, TanStack Router, файл-роуты в `src/routes` |
| Серверные функции | TanStack Start `createServerFn` |
| Сборка | Vite 8, Nitro, пресет `vercel` |
| Стили | Tailwind v4, шрифт Heebo, белый фон и фиолетовый акцент |
| Вход сотрудника | Better Auth, Google и X через брокер `https://auth.grok.me` |
| База | Neon Postgres, если задан `DATABASE_URL`. Иначе в превью — PGLite в памяти |
| Схема | `migrations/0001_auth.sql`, `migrations/0002_klyvona.sql` |

`npm run build` собирает клиент и сервер в `.vercel/output` и затем вызывает `scripts/migrate.mjs`. Миграции на Neon применяются только при наличии `DATABASE_URL`. Повторно уже применённые файлы не запускаются.

## Онбординг

Пять шагов в `src/components/onboarding-wizard.tsx`:

1. Приветствие. KLYVONA ведёт контент сама.
2. Бизнес: название, контакт, почта, телефон, отрасль, описание.
3. Facebook, Instagram, TikTok. До настройки разработчика статус «בקרוב» / «ממתין להגדרה». Пароль не запрашивается.
4. Аудитория, голос бренда, услуги, визуальный стиль.
5. Подтверждение и номер обращения.

Черновик и квитанция лежат в `sessionStorage` до отправки. Валидация общая: `src/lib/onboarding-schema.ts` (Zod). Запись делает только `src/lib/onboarding.functions.ts`. Клиент не передаёт свой `id`. Одна транзакция через CTE создаёт:

- `clients`
- `business_profiles`
- `client_subscriptions` (пробный план)
- `social_accounts` со статусом `awaiting_setup`
- `onboarding_events`

Планы в `src/lib/labels.ts` и в сиде миграции:

- пробный: 0 ₪, 22 фотопоста за 22 рабочих дня
- платный: 600 ₪ в месяц с НДС, 44 фотопоста за 22 рабочих дня
- видео в эти планы не входит

Публичная отправка не пишет в `staff_members` и не выдаёт права администратора.

## База в проде

`scripts/db-mode.mjs` считает процесс продакшеном, если задан `GROK_PROJECT_ID` или `VERCEL_ENV=production`.

В этом режиме без `DATABASE_URL` код не открывает PGLite. `src/lib/db.ts` и `scripts/migrate.mjs` сообщают об ошибке конфигурации. Превью и локальная разработка без этих признаков по-прежнему могут использовать память. Такая память не переживает перезапуск.

Таблицы приложения: `clients`, `business_profiles`, `social_accounts`, `subscription_plans`, `client_subscriptions`, `onboarding_events`, `publishing_jobs`, `webhook_deliveries`, `staff_members`. RLS не используется: соединение идёт от владельца базы, а пул Neon не хранит настройки сессии. Доступ режут серверные функции.

## Администратор

Экран `/admin`. Серверные функции в `src/lib/admin.functions.ts` все проходят `authMiddleware`.

Право выдаёт только `resolveAdminAccess` в `src/lib/admin-grant.server.ts`:

1. В проде запрос отклоняется, если авторизация выключена (`VITE_AUTH_ENABLED=false`), нет пары `GROK_AUTH_CLIENT_ID` / `GROK_AUTH_CLIENT_SECRET`, или идентификатор клиента равен превью-клиенту `grok_preview`.
2. Общий идентификатор `dev-user` никогда не становится администратором.
3. Список `KLYVONA_ADMIN_EMAILS` пуст — доступ закрыт у всех.
4. Почта берётся из строки Better Auth `user` по идентификатору сессии. Клиентский адрес не принимается.
5. Нужен `emailVerified = true` и точное совпадение со списком.
6. Только тогда сервер делает `insert into staff_members ... on conflict do nothing`.

Строка в `staff_members` сама по себе права не даёт. Публичной функции `claimAdminSeat` нет: первый вошедший Google-пользователь не назначает себя сам.

## Соцсети и Make

`src/lib/oauth/providers.ts` описывает Meta и TikTok. Старт и callback в `src/routes/api/oauth/$provider/` отвечают 503, пока интеграция отдельно не включена. Обмена кода на токен нет. Токены, если появятся, должны оставаться только в `token_ciphertext` и шифроваться на сервере (`src/lib/crypto/tokens.server.ts`).

`src/lib/integrations/make.server.ts` шлёт на Make только идентификатор клиента и статусы. Сырые токены и контактные поля в вебхук не входят. URL проверяется против SSRF.

## Переменные, которые задаёт платформа

Их нет в репозитории и нельзя подставлять в код:

- `DATABASE_URL` — Neon
- `KLYVONA_ADMIN_EMAILS` — подтверждённые адреса администраторов
- `GROK_AUTH_CLIENT_ID`, `GROK_AUTH_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `GROK_PROJECT_ID` — признак опубликованного приложения
- `MAKE_WEBHOOK_URL` — когда уведомление Make действительно нужно
- секреты Meta и TikTok — только когда OAuth отдельно включат

Секрет превью-клиента в этот репозиторий не входит. В `src/lib/auth/preview.ts` он заменён чтением `GROK_PREVIEW_CLIENT_SECRET`.
