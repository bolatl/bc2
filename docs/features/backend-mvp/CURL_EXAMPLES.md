# Curl-запросы для ручной проверки (Postman)

Сервер: `make run-env` (в логе `llm_mode=openai`, если задан `LLM_API_KEY`). Базовый адрес: `http://localhost:8080/api/v1`.

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

Этап `needs` (turnIndex 3). После него придёт `paywall_required`, перейдите к шагу 5:

```bash
curl -X POST 'http://localhost:8080/api/v1/fight-sessions/<sessionId>/turns' -H 'Content-Type: application/json' -d '{"turnIndex":3,"answerSource":"free_text","answerText":"I wanted us to agree on a plan."}'
```

## 5. Демо-оплата (мок, без Stripe-ключа)

```bash
curl -X POST 'http://localhost:8080/api/v1/subscriptions/checkout' -H 'Content-Type: application/json' -d '{"plan":"monthly"}'
```

Из ответа взять `checkoutSessionId`:

```bash
curl -X POST 'http://localhost:8080/api/v1/subscriptions/confirm' -H 'Content-Type: application/json' -d '{"checkoutSessionId":"<checkoutSessionId>"}'
```

## 6. Продолжить сессию после оплаты

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

## 7. Что создалось

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

Журнал и статистика (записи появляются, только когда оба партнёра завершили раунд):

```bash
curl 'http://localhost:8080/api/v1/journal'
```

```bash
curl 'http://localhost:8080/api/v1/journal/stats'
```

## 8. Дополнительно

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
- `404`: сессия не ваша или куки потеряны (создайте пару заново).
