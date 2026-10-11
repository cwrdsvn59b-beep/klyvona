# KLYVONA Connect — полный технический анализ

Дата проверки: 11 октября 2026, около 16:18 UTC.

Исходники этой версии — коммит `a2198375f22e5f5154b351975ce3fc903115fc11`. После него код приложения не менялся. Этот документ фиксирует и устройство Meta OAuth, и результат проверки. Секреты и строки подключения не записаны. Новая публикация сайта из этой проверки не делалась.

## 1. Вердикт

| Проверка | Результат |
|---|---|
| Полный `npm test` | **FAIL** |
| Тесты приложения и Meta OAuth | **PASS**, 76 из 76 |
| `tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| Привязка клиента и повтор OAuth state | **PASS** |
| Миграция `0003` на боевой Neon | **UNVERIFIED** |
| Весь живой сайт побайтно равен `a219837` | **UNVERIFIED** |
| Без ключей OAuth не стартует | **PASS** |
| Выбор, отключение и обновление закрыты без секрета клиента | **PASS** |
| Можно сразу создавать приложение Meta | **Нет** |

## 2. Что это за программа

Портал онбординга на иврите, справа налево. Стек: React 19, TanStack Start, Vite, Nitro, пресет Vercel. Вход сотрудника — Better Auth через брокер Grok. База — Neon, если задан `DATABASE_URL`; в превью без него — память PGLite. В опубликованном процессе без `DATABASE_URL` память не открывается.

Цены не менялись: пробный план 0 ₪ и 22 фотопоста за 22 рабочих дня; платный план 600 ₪ в месяц с НДС и 44 фотопоста за 22 рабочих дня. Видео не входит.

Администратор назначается только сервером по `KLYVONA_ADMIN_EMAILS` и подтверждённой почте. Публичного самоназначения нет.

## 3. Meta OAuth в исходниках

Файлы: `src/lib/oauth/meta.server.ts`, `src/lib/oauth/meta-guards.ts`, `src/routes/api/oauth/$provider/start.ts`, `src/routes/api/oauth/$provider/callback.ts`, `src/routes/api/oauth/meta/accounts.ts`, `select.ts`, `disconnect.ts`, `renew.ts`, `src/routes/connect.tsx`, `migrations/0003_meta_oauth.sql`.

Graph API **v26.0**. Разрешения: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`. `business_management` не запрашивается.

Пока нет `META_APP_ID`, `META_APP_SECRET`, годного `TOKEN_ENCRYPTION_KEY`, а в проде ещё `DATABASE_URL` и публичного origin, старт отвечает HTTP 503 и `oauthActivated: false`. Успешное подключение не имитируется.

Callback:

- `https://spring-orbit-honey-baker.grok.me/api/oauth/facebook/callback`
- `https://spring-orbit-honey-baker.grok.me/api/oauth/instagram/callback`

Origin в проде берётся из `META_OAUTH_REDIRECT_ORIGIN` или `BETTER_AUTH_URL`, не из подменённого хоста запроса.

Клиент после онбординга получает длинный секрет. В базе лежит только SHA-256, в `clients.connect_secret_hash`. Номера заявки недостаточно. State живёт 10 минут, хранится как хэш, требует cookie `klyvona_meta_oauth` и помечается использованным до обмена кода. Токен шифруется AES-GCM и не уходит в браузер, логи и Make. TikTok остаётся на 503. Публикация постов и сценарии Make не включались.

Миграция `0003` только добавляет столбец и таблицы `oauth_states` и `oauth_pending_accounts` через `if not exists`. Команд удаления нет.

Допустима страница Facebook с задачей `CREATE_CONTENT`, `MANAGE`, `PROFILE_PLUS_CREATE_CONTENT` или `PROFILE_PLUS_FULL_CONTROL`, и Instagram Business или Creator, связанный с этой страницей. Личный Instagram сохраняется без токена и как недопустимый.

## 4. Результаты команд

`npm test` — код выхода 1. До тестов в `src/` выполнение не дошло: в команде стоит `&&`. 194 проверки прошли, 13 упали. Провалы в скриптах шаблона:

- `scripts/migration-plan.test.mjs` ждёт пустой каталог `migrations/`, а там `0001_auth.sql`, `0002_klyvona.sql` и `0003_meta_oauth.sql`.
- `scripts/with-app-env.test.mjs` ждёт `VITE_AUTH_ENABLED=false`. В `.grok/app-env.json` этого ключа нет, потому что вход сотрудника включён.
- Ещё девять падений в проверках OG и заголовков шаблона.

Отдельный запуск тестов `src/`, включая `src/lib/oauth/meta-guards.test.ts`: 76 пройдено, 0 провалено. Покрыты верный state, отсутствие cookie, просрочка, повтор state, чужой клиент, личный Instagram, неверный секрет, пустые ключи, прод без базы и шифрование токена.

`npx tsc --noEmit` — без ошибок.

`npm run build` — клиент и сервер собраны в `.vercel/output`. Затем мигратор написал: `DATABASE_URL not set — skipping`. Боевая база не изменялась.

## 5. Привязка и повтор

`clientForSecret` в `src/lib/oauth/meta.server.ts` сравнивает секрет с хэшем заявки. Список, выбор и отключение ограничены её `client_id`. Чужой `pendingId` получает `foreign` и HTTP 403 до обновления `social_accounts`.

Повтор callback закрыт условием `used_at is null`. Повтор самого секрета подключения не закрыт: секрет многоразовый и лежит в `sessionStorage`. Украденный секрет позволяет снова управлять только этой заявкой, не чужой. Старые заявки без хэша подключить нельзя.

## 6. Живой сайт

Проверен https://spring-orbit-honey-baker.grok.me без новой публикации.

`POST /api/oauth/facebook/start` с подставным секретом вернул HTTP 503 и текст: Meta OAuth is disabled until the app id, app secret, encryption key, and persistent database are configured. Перехода на Facebook не было.

| Адрес | Ответ |
|---|---|
| `POST /api/oauth/meta/accounts` | 503, без списка |
| `POST /api/oauth/meta/select` | 503, без записи |
| `POST /api/oauth/meta/renew` | 503, без обмена |
| `POST /api/oauth/meta/disconnect` | 401 `unauthorized` |

Страница `/connect` есть. Её файл `connect-BGjUR1Yk.js` совпал по имени с файлом локальной сборки этого исходника. `Last-Modified` этого файла: `Sun, 11 Oct 2026 16:15:30 GMT`. Коммит создан в `16:11:40Z`.

Входной файл сайта — `index-ClpuOK3H.js`. Локальная сборка дала `index-BaUU45jU.js`. SHA деплоя в заголовках нет, есть только `x-vercel-id` запроса. Поэтому совпадение экрана подключения доказано, а побайтное равенство всего деплоя коммиту — нет.

`DATABASE_URL` в среде проверки не задан. Список `_migrations` на Neon отсюда не читается. Ответ 503 до таблиц OAuth не доходит, так что применение `0003` на боевой базе не доказано и не опровергнуто.

## 7. Что блокирует приложение Meta

1. На публикации не подтверждены `META_APP_ID`, `META_APP_SECRET` и `TOKEN_ENCRYPTION_KEY`.
2. Не доказано, что у сайта есть `DATABASE_URL` и что миграция `0003` уже применена. Без `oauth_states` callback упадёт после включения ключей.
3. Не доказано, что `BETTER_AUTH_URL` равен `https://spring-orbit-honey-baker.grok.me`.
4. В приложении Meta нужно вписать оба callback и пройти проверку пяти разрешений.
5. У клиента должна быть страница Facebook и связанный профессиональный Instagram, плюс право публикации.
6. `KLYVONA_ADMIN_EMAILS` по-прежнему нужен отдельно для админки.
7. Полный `npm test` красный из-за тестов шаблона. Это не дыра OAuth, но набор целиком не зелёный.

Ключи TikTok и `MAKE_WEBHOOK_URL` для этого шага не нужны.

## 8. Проверка боевой базы, 11 октября 2026, около 16:30 UTC

Проверка была только на чтение. Данные не менялись, миграции не применялись, сайт не публиковался. Значения секретов не читались.

| Проверка | Где | Результат |
|---|---|---|
| Рабочий постоянный `DATABASE_URL` | Опубликованный сайт | **UNVERIFIED** |
| Миграции `0001`, `0002`, `0003` и таблицы OAuth | Опубликованный сайт | **UNVERIFIED** |
| Заявка `KV-J32PC5` лежит в постоянном PostgreSQL | Опубликованный сайт | **UNVERIFIED** |
| `BETTER_AUTH_URL` | Опубликованный сайт | **UNVERIFIED** |
| `KLYVONA_ADMIN_EMAILS` | Опубликованный сайт | **UNVERIFIED** |
| Те же переменные | Локальная рабочая копия | **FAIL**: не заданы |

`GET /api/auth/get-session` на https://spring-orbit-honey-baker.grok.me вернул HTTP 200 и `null`. Без cookie Better Auth заканчивает запрос до базы, поэтому это не доказательство Neon.

`POST /api/oauth/facebook/start` вернул HTTP 503 с общим текстом про ключи Meta, шифрование и постоянную базу. Код проверяет базу раньше, но наружу отдаёт одну фразу. По ней нельзя понять, чего именно не хватает.

Публичного чтения таблиц нет. Строки подключения в среде проверки нет, поэтому `_migrations`, `oauth_states`, `oauth_pending_accounts` и `clients.connect_secret_hash` на опубликованном PostgreSQL не проверялись.

Заявка `KV-J32PC5` создавалась на более ранней сборке, которая могла писать в память. Её присутствие в Neon не доказано.

Локально не заданы `DATABASE_URL`, `BETTER_AUTH_URL` и `KLYVONA_ADMIN_EMAILS`. Это не состояние опубликованного сайта.

В Publish > Secrets доказанно отсутствующих боевых значений нет. `DATABASE_URL` и `BETTER_AUTH_URL` должен подставить Grok, их не вводят вручную. `KLYVONA_ADMIN_EMAILS` платформа не задаёт: если строки нет, её добавляют вручную, но сейчас нельзя подтвердить, есть она или нет. `VITE_NEON_AUTH_URL` и `NEON_AUTH_BASE_URL` код не читает и PostgreSQL ими не подключается.

Код приложения в этом коммите не менялся относительно `a219837`.

## 9. Instagram OAuth, 11 октября 2026, около 19:10 UTC

Код приложения по-прежнему не менялся относительно `a219837`. Секреты в этот файл не входят. Сайт этим коммитом не публикуется.

После отдельной проверки администратором боевая база ответила, что это сетевой PostgreSQL и что миграция `0003_meta_oauth.sql` записана. Временный маршрут диагностики после этого удалён и в репозиторий не входит.

### Опубликованный сайт

`POST /api/oauth/instagram/start` с несуществующим клиентом вернул HTTP 401. `GET /api/oauth/instagram/callback` без кода вернул HTTP 303 на `/connect?error=state`. Прежний HTTP 503 из-за пустой конфигурации исчез. Обмен authorization code не запускался.

Сервер принимает конфигурацию только если непусты `META_APP_ID` и `META_APP_SECRET`, `TOKEN_ENCRYPTION_KEY` декодируется в 32 байта и задан `META_OAUTH_REDIRECT_ORIGIN` либо `BETTER_AUTH_URL`. Значения переменных не читались. Повторная публикация для уже применённых Secrets не требовалась.

`TOKEN_ENCRYPTION_KEY` — это base64 ровно 32 байт, ключ AES-256-GCM. Hex и обычная строка не подходят. Проверка стоит в `encryptionKeyReady` до старта OAuth.

Redirect URI текущего кода:

`https://spring-orbit-honey-baker.grok.me/api/oauth/instagram/callback`

Совпадение этого адреса с кабинетом Meta снаружи не подтверждено: сервер не возвращает сохранённый origin.

### Это Facebook Login, не Instagram Login

Instagram и Facebook идут в `https://www.facebook.com/v26.0/dialog/oauth` и `https://graph.facebook.com/v26.0/oauth/access_token`. Разрешения: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`. Аккаунт Instagram ищется только как профессиональный аккаунт страницы Facebook.

В коде нет `https://www.instagram.com/oauth/authorize`, `https://api.instagram.com/oauth/access_token` и разрешений `instagram_business_basic`, `instagram_business_content_publish`. Настроенный в Meta продукт Instagram API with Instagram Login опубликованному приложению не соответствует.

### Безопасный переход только Instagram

Таблицы `oauth_states`, `oauth_pending_accounts` и `social_accounts`, шифрование AES-GCM, секрет клиента и сценарии Make можно сохранить. Новую миграцию делать не нужно. Нельзя лишь подменить адрес в общем потоке Facebook.

Нужно отдельно для `instagram`:

- авторизация на `https://www.instagram.com/oauth/authorize`;
- обмен кода через `POST https://api.instagram.com/oauth/access_token`;
- длинный токен через `https://graph.instagram.com/access_token` и `grant_type=ig_exchange_token`;
- профиль через `https://graph.instagram.com/me`;
- разрешения `instagram_business_basic` и `instagram_business_content_publish`;
- одна ожидающая запись без токена страницы;
- продление через `ig_refresh_token`;
- отдельная кнопка Instagram на экране подключения.

`META_APP_ID` и `META_APP_SECRET` подходят для Instagram Login, только если это Instagram App ID и Instagram App Secret из кабинета. Если они отличаются от учётных данных Facebook, их нельзя перезаписывать: Facebook Login использует те же имена. Тогда для Instagram нужны отдельные переменные.

Токен в webhook Make по-прежнему не отправляется.

