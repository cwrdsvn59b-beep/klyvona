# Диагностика: grantSource остаётся preserved_on_refresh

Дата проверки: 2026-10-12, 17:41 IDT.

Код, база Neon, токены, Meta и подключение Instagram не изменялись. Это только отчёт.

## Версия production

GitHub по-прежнему заканчивается отчётом `cbf7842`. Код приложения не менялся после `744322b`. В 17:41 IDT главная страница снова отдала те же файлы: `index-CdpE9emh.js` и `connect-CUiYYuzL.js`. В бандле есть кнопка «אישור עדכון ההרשאה». SHA процесса сервер не публикует, поэтому точный hash deployment остаётся неподтверждённым. Поля `grantSource` и `liveRecheck` совпадают с этим кодом.

## Что доказано кодом

`preserved_on_refresh` записывается в одном месте: `instagramRenewWrite()` в `src/lib/oauth/instagram-renew.ts`, строки 46–50. Это происходит только из `renewInstagram()` в `src/lib/oauth/instagram.server.ts`, строки 537–553. Вызовы идут с `/api/oauth/instagram/renew` и, для платформы `instagram`, с `/api/oauth/meta/renew` в `src/routes/api/oauth/meta/renew.ts`, строка 15.

Новый OAuth так не пишет. Callback на строках 321–326 всегда ставит `oauth_exchange` и кладёт результат в `oauth_pending_accounts`. Подтверждение на строках 429–446 `src/lib/oauth/meta.server.ts` копирует этот payload без смены источника. Кнопка подтверждения в `src/routes/connect.tsx`, строки 185–197, вызывает только `/api/oauth/meta/select`, затем перечитывает список. `renew` она не вызывает. Загрузка страницы тоже не вызывает: строки 71–73.

Проверка разрешений только читает `social_accounts` и возвращает сохранённый источник, строки 455–489 и 476. Она не меняет payload. Запасной текст интерфейса на строках 161–170 показывает «список не сохранён», но не ставит `grantSource`. Раз в ответе есть `preserved_on_refresh` и `liveRecheck: not_performed`, это успешный ответ API, а не запасной текст.

Следствие: в 17:28 в `social_accounts` лежал payload, который последним записал `renewInstagram()`. Успешное подтверждение нового OAuth заменило бы источник на `oauth_exchange`, даже если Meta не прислала `permissions` и статус остался `permissions_unknown`. Этого не произошло.

Поле `permissions` в обмене кода — строка внутри `data[0]`. Разбор в `src/lib/oauth/meta-guards.ts`, строки 155–189, для этой формы верен. Отсутствие поля даёт `permissions_unknown`, не `preserved_on_refresh`. Refresh это поле не возвращает, а `tokenResult()` на строках 112–118 его не читает, поэтому обновление токена не может восстановить список.

Гонки внутри одного запроса нет. Два разных запроса не блокируют друг друга: если `renew` завершится после `select`, он затрёт новый payload.

## Чего не хватает

Не доказано, был ли `renew` после подтверждения или подтверждение вообще не заменило прежний токен. Нужны только время и результат, без токенов и идентификаторов:

- `POST /api/oauth/meta/select`: время, `ok` или код ошибки, исчезла ли pending-запись.
- `POST /api/oauth/instagram/renew` и `POST /api/oauth/meta/renew`: был ли вызов после этого времени.
- `POST /api/oauth/instagram/permissions`: время относительно двух предыдущих.
- В callback: `permissionsPresent` и `grantStatus`, без списка прав и без Instagram ID.

Пока этих четырёх отметок нет, выбирать между «подтверждение не записалось» и «обновление токена прошло позже» нельзя.
