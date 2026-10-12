# KLYVONA Connect — технический анализ

Дата проверки: 2026-10-12.  
Репозиторий: https://github.com/cwrdsvn59b-beep/klyvona  
База этого отчёта: коммит `a3af4a3f57c1e3b9585002a0181dd360f8f93afa`.  
Рабочий сайт https://spring-orbit-honey-baker.grok.me этим коммитом не обновлялся.

Секреты, строки подключения и токены в этот документ не включены.

## 1. Стек

Клиент и сервер собраны на TanStack Start и React. Маршруты лежат в `src/routes` и регистрируются в `src/routeTree.gen.ts`. Администратор входит через Better Auth. Данные клиентов хранятся в PostgreSQL: в опубликованном приложении это Neon при наличии `DATABASE_URL`, в локальной разработке без этой переменной используется временный PGLite. Пустая `DATABASE_URL` считается отсутствующей (`src/lib/db.ts`).

Токены социальных сетей шифруются на сервере AES-256-GCM и не отдаются в браузер. Клиентский чек заявки — это `reference` и `connectSecret` в `sessionStorage` ключа `klyvona-onboarding-receipt`. Пароль клиента и пароль Instagram приложение не запрашивает.

## 2. Что видит клиент

Интерфейс на иврите, `dir="rtl"`. На экране подключения клиенту доступен только Instagram.

- `src/routes/connect.tsx` — одна кнопка «התחברות עם Instagram», список одобренных аккаунтов, сохранение, продление и отключение с подтверждением «ביטול».
- `src/components/onboarding-wizard.tsx` — в шаге соцсетей тоже только Instagram.
- Кнопки Facebook в клиентском интерфейсе нет. Серверный код Facebook Login for Business в `src/lib/oauth/meta.server.ts` не удалён и клиентской кнопкой не вызывается.

Без чека в этом же браузере показывается точный текст: «המסך הזה זמין אחרי השלמת ההצטרפות באותו דפדפן.» Чек не переносится на другой телефон. Это не вход по паролю.

## 3. Маршруты

| Путь | Назначение |
|---|---|
| `/` | Заявка |
| `/connect` | Подключение Instagram |
| `/login` | Вход администратора |
| `/admin`, `/admin/clients/$clientId` | Кабинет KLYVONA |
| `/api/auth/$` | Better Auth |
| `/api/oauth/$provider/start` и `callback` | Старт и возврат OAuth |
| `/api/oauth/instagram/renew` | Продление только Instagram |
| `/api/oauth/meta/accounts` | Список ожидающих и сохранённых аккаунтов |
| `/api/oauth/meta/select` | Сохранение выбранного аккаунта |
| `/api/oauth/meta/disconnect` | Отключение |
| `/api/oauth/meta/renew` | Запасной разветвитель: Instagram уходит в `renewInstagram`, остальное в `renewMeta` |

## 4. Instagram OAuth

Старт: `startInstagramOAuth` в `src/lib/oauth/instagram.server.ts`.  
Адрес авторизации: `https://www.instagram.com/oauth/authorize`.  
Разрешения: `instagram_business_basic`, `instagram_business_content_publish`.  
Идентификатор приложения берётся из `INSTAGRAM_APP_ID`, секрет из `INSTAGRAM_APP_SECRET`. Значения `META_APP_ID` и `META_APP_SECRET` для Instagram не подставляются.

Callback: `/api/oauth/instagram/callback`. State одноразовый, сверяется с cookie, живёт 10 минут. Код обменивается на токен только на сервере. Короткий токен переводится в долгий и сохраняется в зашифрованном виде `{ v: 2, userToken, igUserId }`.

Пока нет `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` или постоянной базы, старт возвращает HTTP 503 и не имитирует подключение.

Публичный callback, который нужно держать в Meta:

`https://spring-orbit-honey-baker.grok.me/api/oauth/instagram/callback`

## 5. Продление Instagram

Подтверждённая ошибка коммита `c8a339b`: кнопка вызывала `/api/oauth/meta/renew`, а `renewMeta()` для платформы `instagram` возвращает отключение.

Исправление в `a3af4a3`:

- Кнопка вызывает `POST /api/oauth/instagram/renew`.
- Файл `src/routes/api/oauth/instagram/renew.ts` импортирует только `renewInstagram`.
- `renewTarget("instagram")` никогда не выбирает Meta.
- `instagramRenewWrite()` готовит полезную нагрузку версии 2 и срок `token_expires_at`. Если Instagram не прислал срок, пишется `null`.
- Ошибки 409 `reconnect_required` и 503 не считаются успехом.
- Реальный запрос обновления токена в Instagram этим исправлением не выполнялся.

`renewMeta()` оставлен для Facebook и по-прежнему отказывает Instagram. Клиентская кнопка его не вызывает.

## 6. Контракт ответов

`connectResultAccepted()` в `src/lib/oauth/connect-session.ts` не считает успехом ни плохой JSON, ни HTTP 200 с `{"ok": false}`.

| Действие | Успех |
|---|---|
| start | HTTP 2xx, `oauthActivated: true`, `authorizeUrl` начинается с `https://` |
| accounts | HTTP 2xx, массивы `accounts` и `connected`, без `ok: false` |
| select и disconnect | HTTP 2xx, `ok: true` и непустой `platform` |
| renew | HTTP 2xx и `ok: true` |

После сохранения, продления и отключения список запрашивается снова. Один Instagram Account ID показывается один раз. Уже сохранённый аккаунт скрывается из списка ожидания. Ошибка сети не помечается как выполненное действие.

## 7. База и изоляция тестов

Таблицы миграций 0001–0003 включают клиентов, профили, социальные аккаунты, `oauth_states`, `oauth_pending_accounts` и `clients.connect_secret_hash`. Этот коммит миграции не запускал и записи Neon не менял.

`scripts/browser-env.mjs` перед тестовым Vite подставляет пустую строку в `DATABASE_URL` и другие секретные ключи. Пустая строка важна: плагин TanStack Start делает `Object.assign(process.env, loadEnv(...))`, и удалённый ключ файл `.env` мог бы вернуть. В каталоге проекта на момент проверки не было `.env`, `.env.local` и `.env.production`.

Тестовый сервер браузерных проверок — `127.0.0.1:8099`, команда `npm run test:browser`. Обычный `npm test` этот сервер не поднимает.

`npm run build` по-прежнему вызывает миграцию. Для проверки сборки без базы используется `npm run build:check`.

## 8. Фактические результаты проверок

Проверено в среде сборки 2026-10-12. Это не проверка физического телефона и не боевой OAuth.

| Команда | Код выхода | Итог |
|---|---|---|
| `npm run typecheck` | 0 | PASS |
| `node --experimental-strip-types --test` для `instagram-renew.test.ts` и `connect-session.test.ts` | 0 | PASS, 14 из 14 |
| `node --test scripts/browser-env.test.mjs` | 0 | PASS, 1 из 1 |
| `npm run build:check` | 0 | PASS, строка `db:migrate` не выполнялась |
| Chromium, размеры 390×844, 412×915 и 1280×800 | 0 для этих трёх | PASS на прошлом прогоне `test:browser`. Это размеры окна, не iPhone и не Android |
| Firefox | 1 | FAIL: нет системных библиотек GTK, процесс не стартовал |
| WebKit | 1 | FAIL: нет GTK 4 и GStreamer, процесс не стартовал |
| `npm run lint` | 1 | FAIL: пустой `catch` в `src/lib/app-data/client.server.ts`; предупреждение зависимостей `useEffect` в `connect.tsx` |
| Полный `npm test` | 1 на прошлом полном прогоне | 194 прошло, 13 упало в шаблонных проверках карточек и `og:title`. Из-за `&&` набор `src/` тогда не стартовал |

## 9. Что не подтверждено

- Нажатие Allow в настоящем Instagram и возврат authorization code.
- Запись этого подключения в боевой Neon и отображение после обновления опубликованного сайта.
- Продление живого токена.
- Повторный вход после полного закрытия браузера: чек хранится в `sessionStorage` и пропадает вместе с сессией браузера.
- Физические iPhone Safari, Android Chrome, Samsung Internet и настольный Safari.
- Публикация постов, оплата и сценарии Make.com. Они этим коммитом не включались.

## 10. Ручная проверка после отдельной публикации сайта

Выполнять в одном браузере телефона, только после того как владелец опубликует этот коммит:

1. Открыть сайт, заполнить заявку и отправить её.
2. Нажать «התחברות עם Instagram» и разрешить доступ тестовому профессиональному аккаунту.
3. Вернуться в KLYVONA, сохранить одну карточку и обновить страницу. Должен остаться статус «מחובר», без дубликата.
4. Не закрывая браузер, снова открыть `/connect`. Аккаунт должен остаться.
5. Нажать «ניתוק Instagram», затем «ביטול». Аккаунт остаётся.
6. Повторить отключение и подтвердить его. После обновления страницы подключения быть не должно.
7. Для продления нажать «חידוש הרשאת Instagram» только на уже сохранённом аккаунте. Запрос должен идти на `/api/oauth/instagram/renew`, а не на `/api/oauth/meta/renew`.

Адрес с параметрами `code` или `state` никуда не отправлять.
