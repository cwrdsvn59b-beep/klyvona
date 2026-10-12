# KLYVONA — план сохранения разрешений Instagram OAuth

Коммит исходников на момент плана: [`2ef31e8`](https://github.com/cwrdsvn59b-beep/klyvona/commit/2ef31e88afc362384ba8dbcc2adfb4be080f8894)

Дата: 2026-10-12

Это этап 1. Файлы приложения этим коммитом не меняются. Коммита с исправлением OAuth, deployment и переподключения Instagram нет.

## Что подтверждено

Официальный обмен кода Instagram Login, `POST https://api.instagram.com/oauth/access_token`, возвращает `permissions` строкой через запятую внутри `data[0]`:

```json
{
  "data": [
    {
      "access_token": "...",
      "user_id": "1020...",
      "permissions": "instagram_business_basic,instagram_business_content_publish"
    }
  ]
}
```

Источник: [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login). Долгоживущий обмен и refresh этого поля не возвращают.

В коде `readInstagramShortToken()` оставляет только `access_token` и `user_id` (`src/lib/oauth/meta-guards.ts:150`). Зашифрованный payload v2 — `{ userToken, igUserId, username? }` (`src/lib/oauth/instagram-renew.ts:1`). Статус «Ready for testing» в панели Meta из репозитория не виден.

## Что нельзя проверить без нового входа

Уже сохранённый токен @klyvona_business поля `permissions` не содержит. Этот код сам его не допишет: список появится только при следующем OAuth после внедрения. Отсутствие поля у старого токена будет `permissions_unknown`, не отказом и не `reconnect`.

## План после подтверждения

1. `src/lib/oauth/meta-guards.ts` — разбор только строки `permissions`. Полный список с `instagram_business_content_publish` даёт `permissions_confirmed`. Строка есть, но права публикации нет — `permissions_missing`. Поля нет, это массив или иной формат — `permissions_unknown`.
2. `src/lib/oauth/instagram-renew.ts` и `src/lib/oauth/instagram.server.ts` — сохранять этот статус и нормализованный список только внутри AES-GCM payload. Версия остаётся v2. Refresh копирует старый список, потому что Meta его заново не присылает.
3. Проверка `/api/oauth/instagram/permissions` читает сохранённый результат и отдельно сообщает, что онлайн-повторной проверки не было. Историческая запись не становится `permission_confirmed`.
4. `src/routes/connect.tsx` и `src/lib/oauth/connect-session.ts` — иврит, RTL: «выдано при подключении» и «сейчас повторно не проверялось». В браузер уходят только статусы, не токен и не сырой список.

Не меняются redirect URI, названия scope, проверка Instagram ID, Make, Facebook, регистрация, тарифы и админка. `media_publish` не добавляется.

## Запланированные проверки

Тесты после подтверждения, только локально: полный список, отсутствие права публикации, отсутствие поля, повреждённый формат, старый v2, шифрование, отсутствие токена в ответе, текст статуса. Затем `npm run typecheck`, `npm run lint`, узкие тесты, `npm test` и `npm run build:check`. Боевые токены, Meta API и `npm run build` не используются.
