# Curl-запросы для ручной проверки (Postman)

Сервер: `make run-env`. В `.env` должно быть `DISABLE_PAYWALL=true` (оплата не нужна) и задан `LLM_API_KEY`; в логе `llm_mode=openai` или `anthropic`. Базовый адрес: `http://localhost:8080/api/v1`.

**Как использовать в Postman:** `Import` → `Raw text` → вставить один curl → `Import`. Куки `lovelab_session` Postman сохраняет сам, поэтому `-c/-b` не нужны. Все запросы выполняйте в одной вкладке/коллекции, иначе потеряется сессия. Значения в `<...>` подставляйте из предыдущих ответов. Данные хранятся только в памяти сервера и пропадают после его перезапуска.

## 1. Создать пару (партнёр A)

```bash
curl -X POST 'http://localhost:8080/api/v1/couples' -H 'Content-Type: application/json' -d '{"age":"30-34","relationshipStatus":"married","togetherDuration":"3-7","hasKids":"no","conflictStyle":"talk_now","repairNeed":"plan","fightTopics":["chores"],"goal":"understand_each_other"}'
```

## 2. Тест личности (необязательно, без LLM)

```bash
curl -X POST 'http://localhost:8080/api/v1/personality-tests' -H 'Content-Type: application/json' -d '{"answers":[3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3]}'
```

## 3. Старт сессии → из ответа взять `sessionId`

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions' -H 'Content-Type: application/json' -d '{}'
```

## 4. Ходы (`turnIndex` растёт с 0; берите его из `currentTurn.turnIndex`)

Этап `thermometer_start` (turnIndex 0):

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":0,"answerSource":"free_text","answerText":"8"}'
```

Этап `facts` (turnIndex 1, дальше вопрос генерирует ChatGPT):

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":1,"answerSource":"free_text","answerText":"We argued about doing the dishes again."}'
```

Этап `feelings` (turnIndex 2):

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":2,"answerSource":"free_text","answerText":"I felt alone with all the chores."}'
```

Этап `needs` (turnIndex 3):

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":3,"answerSource":"free_text","answerText":"I wanted us to agree on a plan."}'
```

## 5. Завершить сессию

Текущий вопрос (там же видно `stage` и `turnIndex`):

```bash
curl 'http://localhost:8080/api/v1/fight-sessions/<sessionId>'
```

Этап `partner_view` (turnIndex 4):

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":4,"answerSource":"free_text","answerText":"Maybe they were tired too."}'
```

Этап `thermometer_end` (turnIndex 5):

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":5,"answerSource":"free_text","answerText":"3"}'
```

Этап `ready` (turnIndex 6). После него сессия `completed` и генерируется итог:

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":6,"answerSource":"free_text","answerText":"I am ready to talk"}'
```

Если включён `ENABLE_REHEARSAL=true`, между `partner_view` и `thermometer_end` добавляется этап `rehearsal`, а индексы сдвигаются на 1.

## 6. Что создалось

Итог сессии (текст, сгенерированный ChatGPT):

```bash
curl 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/result'
```

Состояние сессии (после завершения история пуста):

```bash
curl 'http://localhost:8080/api/v1/fight-sessions/<sessionId>'
```

Пара и профиль:

```bash
curl 'http://localhost:8080/api/v1/couples/me'
```

Отчёт личности:

```bash
curl 'http://localhost:8080/api/v1/personality-tests/me'
```

Подписка:

```bash
curl 'http://localhost:8080/api/v1/subscriptions/me'
```

Журнал и статистика (записи появляются, только когда оба партнёра завершили раунд, см. разделы 7 и 8):

```bash
curl 'http://localhost:8080/api/v1/journal'
```

```bash
curl 'http://localhost:8080/api/v1/journal/stats'
```

## 7. Партнёр B и общий журнал

Условие: A уже прошёл сессию до конца (`ready`). Запросы B делайте **с другой кукой**: в Postman в отдельном окне или после очистки кук, в curl с отдельным файлом (`-c b.jar -b b.jar`). Иначе сервер примет вас за A. Токен приглашения берётся из `inviteUrl` (кука A): последняя часть адреса.

Получить `inviteUrl` (кука A):

```bash
curl 'http://localhost:8080/api/v1/couples/me'
```

Войти по приглашению (кука B). Ответ содержит `partnerRole: "B"` и нейтральную тему; кука B выставится автоматически:

```bash
curl -X POST 'http://localhost:8080/api/v1/invites/<inviteToken>/join' -H 'Content-Type: application/json' -d '{"age":"30-34","conflictStyle":"talk_now","repairNeed":"plan"}'
```

Начать сессию B (кука B). Из ответа взять `sessionId` B, он отличается от `sessionId` A:

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions' -H 'Content-Type: application/json' -d '{}'
```

Ходы B проходят так же, как у A (разделы 4 и 5): `POST /fight-sessions/<sessionIdB>/turns` с растущим `turnIndex` (0, 1, 2, …) до этапа `ready`. Пример хода:

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionIdB>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":0,"answerSource":"free_text","answerText":"6"}'
```

Итог B (кука B):

```bash
curl 'http://localhost:8080/api/v1/fight-sessions/<sessionIdB>/result'
```

## 8. Журнал, оценки и статистика

Когда оба партнёра ответили на `ready`, создаётся общая запись. Дальше запросы можно делать с любой из двух кук.

Журнал (в записи заполнен `bothReadyAt`; из него взять `id` записи как `fightRecordId`):

```bash
curl 'http://localhost:8080/api/v1/journal'
```

Оценка разговора: число от 1 до 10 (каждый партнёр ставит свою, со своей кукой):

```bash
curl -X POST 'http://localhost:8080/api/v1/journal/<fightRecordId>/rating' -H 'Content-Type: application/json' -d '{"rating":7}'
```

Или «мы ещё не говорили» (поле `rating` обязательно, `null` задаётся явно):

```bash
curl -X POST 'http://localhost:8080/api/v1/journal/<fightRecordId>/rating' -H 'Content-Type: application/json' -d '{"rating":null}'
```

Статистика: темы, динамика оценок, время до готовности обоих:

```bash
curl 'http://localhost:8080/api/v1/journal/stats'
```

Статус партнёра B виден у A в `GET /couples/me` (поле `partnerBStatus`) и в поле `partnerStatus` результата сессии.

## 9. Дополнительно

Вернуться на ход назад:

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/back' -H 'Content-Type: application/json' -d '{"turnIndex":2}'
```

Пропустить тему (стирает сырые ответы):

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/skip-topic' -H 'Content-Type: application/json' -d '{}'
```

Удалить пару со всеми данными:

```bash
curl -X DELETE 'http://localhost:8080/api/v1/couples/me'
```

## Ошибки

- `503 generation_unavailable`: OpenAI вернул ошибку (неверный ключ, лимит) или ответ не прошёл проверки; причина в stderr сервера.
- `409`: неверный `turnIndex` (устарел или повторён). Возьмите актуальный из `GET /fight-sessions/<sessionId>`.
- `404`: сессия не ваша или куки потеряны (создайте пару заново). Для B это также значит, что запрос ушёл с кукой A.
