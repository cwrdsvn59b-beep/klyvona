# KLYVONA Connect — аудит перед первой тестовой публикацией

Коммит исходников: [`db114d8`](https://github.com/cwrdsvn59b-beep/klyvona/commit/db114d82aba20331425d845c9cfff4f0601e1ad0)

Дата аудита: 2026-10-12

Режим: только чтение. Код приложения этим коммитом не меняется. База, токены, Meta API, Make и тесты не вызывались.

## A. Что подтверждено кодом

OAuth Instagram Login запрашивает ровно два scope: `instagram_business_basic` и `instagram_business_content_publish`.

```ts
// src/lib/oauth/meta-guards.ts:43
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;
```

Адрес авторизации собирается в `instagramAuthorizeUrl()` (`src/lib/oauth/meta-guards.ts:109`). Callback — `GET /api/oauth/instagram/callback` (`src/routes/api/oauth/$provider/callback.ts:10`), он вызывает `finishInstagramOAuth()`. State одноразовый, привязан к клиенту и cookie.

Обмен кода идёт на `https://api.instagram.com/oauth/access_token`, затем короткоживущий токен меняется на долгоживущий, после чего вызывается `GET graph.instagram.com/me?fields=user_id,username,account_type,id` (`src/lib/oauth/instagram.server.ts:121–171`). В `social_accounts` сохраняется профессиональный `user_id`, а не App ID: это решает `resolveInstagramAccount()` (`src/lib/oauth/meta-guards.ts:197`). Токен шифруется AES-256-GCM и лежит только в `token_ciphertext`. В браузер и в Make он не отдаётся.

Уже сохранённый payload — `{ v: 2, userToken, igUserId, username? }` (`src/lib/oauth/instagram-renew.ts:1–16`). Поля `permissions` в нём нет. `readInstagramShortToken()` читает только `access_token` и `user_id` и выбрасывает список прав, который Meta возвращает при обмене кода (`src/lib/oauth/meta-guards.ts:150–159`).

`grantedPermissions()` не делает сетевого запроса и всегда возвращает `{ documented: false }` (`src/lib/oauth/instagram.server.ts:173–178`). Поэтому живой `/api/oauth/instagram/permissions` не может вернуть `permission_confirmed`. Успешный `/me` в коде явно не считается правом публикации (`src/lib/oauth/meta-guards.ts:275` и `325–328`).

Создания контейнера, проверки `status_code` и `media_publish` в приложении нет. Единственное упоминание `media_publish` — проверка теста, что вызов не выполнялся.

`publishing_jobs` создана в `migrations/0002_klyvona.sql:87–96`. В `src/` есть только два `SELECT` в админке. Никто не вставляет задания.

## B. Чего не хватает

- Достоверного списка прав у уже сохранённого токена. Документация [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) отдаёт `permissions` только в ответе обмена кода. Повторного read-only метода нет, и этот ответ сейчас не сохраняется.
- Всех трёх вызовов публикации из [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing): `POST /<IG_ID>/media`, затем `GET /<IG_CONTAINER_ID>?fields=status_code`, затем `POST /<IG_ID>/media_publish`. Нужны публичный JPEG и `creation_id`.
- Защиты от повторного поста: у `publishing_jobs` нет ключа идемпотентности и поля контейнера.
- Отдельного разрешения на публикацию. Сейчас секрет подключения из браузера может вызывать connect-API. Этим же секретом публиковать нельзя.
- Подтверждения из репозитория, что Business Verification завершена и что @klyvona_business добавлен в приложение Meta. Это только состояние панели Meta.

## C. Make

В репозитории Make — одно исходящее уведомление после онбординга. `notifyMake()` шлёт `client_id`, `reference`, тариф, отрасль и статусы. Токена, почты и телефона в теле нет (`src/lib/integrations/make.server.ts:7–20`). Событие всегда `onboarding.completed`, `social_status` всегда `awaiting_setup`, платформа — только `instagram` (`src/lib/onboarding.functions.ts:191–204`). URL берётся из `MAKE_WEBHOOK_URL`, принимается только публичный HTTPS, редирект запрещён, таймаут 8 секунд. Результат пишется в `webhook_deliveries`.

Входящего обработчика Make нет. Сценарий не может получить токен и не может запустить публикацию через этот код.

Без доступа к Make и к production-секретам нельзя проверить, задан ли `MAKE_WEBHOOK_URL`, существует ли сценарий и не публикует ли он где-то отдельно. Строки `webhook_deliveries` в боевой базе тоже не смотрелись.

## D. Минимальный план

Публиковать должен сервер KLYVONA, не Make. Токен уже хранится только там. Make можно позже уведомить идентификатором задания и статусом, без токена.

1. В панели Meta, без изменения кода, проверить, что @klyvona_business — профессиональный аккаунт, добавлен в это приложение, и что выдано `instagram_business_content_publish`. Для своего аккаунта в документации указан Standard Access. Для чужих клиентов нужен Advanced Access. Пока Business Verification на рассмотрении, чужие аккаунты не подключать к публикации.
2. Перед следующим входом владельца сохранять строку `permissions` из ответа обмена кода внутри уже зашифрованного payload. Текущий токен из-за этого сам не изменится.
3. После отдельного подтверждения добавить одну админскую серверную функцию: повторно сверить `/me` с сохранённым ID, отказать при несовпадении, создать одно задание, отправить один заранее заданный публичный JPEG в `POST /<IG_ID>/media`, дождаться `FINISHED` и только затем вызвать `media_publish`. Повторный запрос не должен создавать второй контейнер. URL картинки не принимать из браузера.
4. Make на этом шаге не трогать.

## E. Один следующий шаг

Ничего не публиковать. Сначала в панели Meta посмотреть, выдано ли @klyvona_business право `instagram_business_content_publish`. Код это у текущего токена проверить не может: список прав при входе был отброшен, а безопасного повторного запроса нет.
