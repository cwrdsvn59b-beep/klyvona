# Проверка коммита ec837ad

Код: [`ec837ad`](https://github.com/cwrdsvn59b-beep/klyvona/commit/ec837ad513c75ba92aeecfbe42516941a4a3a957)

Дата проверки: 2026-10-12

Файлы коммита сверены с рабочей копией. Во время проверки код, база, секреты и Meta API не изменялись. Deployment не выполнялся.

## Технология

Стек приложения не менялся: TanStack Start, серверный Instagram Login, AES-256-GCM и Neon PostgreSQL.

Instagram Login возвращает фактически выданные права только при обмене authorization code. Документация доступна: [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login). Поле `permissions` — строка через запятую внутри `data[0]`:

```json
{
  "data": [
    {
      "access_token": "...",
      "user_id": "1020...",
      "permissions": "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish"
    }
  ]
}
```

Долгоживущий обмен и refresh это поле не возвращают.

Разбор в `src/lib/oauth/meta-guards.ts` принимает только такую строку:

- `permissions_confirmed` — в строке есть `instagram_business_content_publish`;
- `permissions_missing` — строка разобрана, но права публикации в ней нет;
- `permissions_unknown` — поля нет, это массив или формат не совпадает с документацией.

Нормализованный список и источник (`oauth_exchange` или `preserved_on_refresh`) пишутся только в зашифрованный payload версии v2. Старый payload без этих полей остаётся `permissions_unknown` и не требует reconnect. Refresh копирует сохранённый список и помечает источник `preserved_on_refresh`. Это не новая проверка Meta.

`/api/oauth/instagram/permissions` отдаёт в браузер только статусы: `grantAtConnection`, `grantSource` и `liveRecheck: "not_performed"`. Токен и сырой список прав в ответ не входят. Историческая запись не превращается в онлайн-статус `permission_confirmed`.

Изменённые файлы коммита `ec837ad`:

- `src/lib/oauth/meta-guards.ts`
- `src/lib/oauth/meta-guards.test.ts`
- `src/lib/oauth/instagram-renew.ts`
- `src/lib/oauth/instagram-renew.test.ts`
- `src/lib/oauth/instagram.server.ts`
- `src/lib/oauth/instagram-permissions.integration.test.ts`
- `src/lib/oauth/connect-session.ts`
- `src/routes/connect.tsx`

Redirect URI и запрашиваемые scope не менялись. Make, Facebook, тарифы и данные клиентов не затрагивались.

## Результаты проверки

| Команда | Код выхода | Результат |
|---|---|---|
| `npm run typecheck` | 0 | Ошибок TypeScript нет |
| `npm run lint` | 0 | Замечаний ESLint нет |
| Целевые тесты Instagram | 0 | 36 из 36 прошли, 0 упали |
| `npm test` | 1 | 195 прошли, 13 упали |
| `npm run build:check` | 0 | Сборка завершилась. Миграция не запускалась |

Целевая команда:

```bash
node --experimental-strip-types --import ./scripts/register-alias.mjs --test \
  src/lib/oauth/meta-guards.test.ts \
  src/lib/oauth/instagram-renew.test.ts \
  src/lib/oauth/instagram-permissions.integration.test.ts \
  src/lib/oauth/instagram-identity.integration.test.ts \
  src/lib/oauth/instagram-verify.integration.test.ts
```

`npm test` запускает `scripts/**/*.test.mjs` и из-за `&&` не доходит до тестов `src/`, когда шаблонные проверки падают. Упавшие 13 проверок не относятся к Instagram:

- the build side resolves the template's shipped app-env
- platform chrome overwrites share-card metas and always sets og:title
- published grok.me slug is still a title fallback
- emits og:image for a public host and prefers a custom card
- placeholder og:image appends site.color when it is 6-digit hex
- document title entities are not double-escaped on og:title
- injects into documents with no head element
- streaming injector matches `</HEAD>` case-insensitively
- uses the app name in the injected title tag
- the auth schema ships outside the globbed directory
- the template ships auth off
- the wrapped command runs with the app env applied
- the CLI still runs when invoked through a symlinked path

`build:check` выводит предупреждения Rolldown о директиве `"use client"` в `@tanstack/react-router`. Код выхода при этом 0.

## Ограничение

Текущий токен @klyvona_business не содержит сохранённый список прав. До следующего входа после публикации `ec837ad` проверка покажет `permissions_unknown`. Даже `permissions_confirmed` означает только ответ Meta в момент подключения, а не повторную онлайн-проверку.
